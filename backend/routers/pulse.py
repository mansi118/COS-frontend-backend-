from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import TeamMember, Followup, PerformanceSnapshot, BoardSnapshot
from datetime import date
import cos_reader

router = APIRouter(prefix="/api/pulse", tags=["pulse"])


def get_person_health(score: int) -> str:
    if score >= 85:
        return "green"
    elif score >= 70:
        return "yellow"
    elif score >= 55:
        return "orange"
    return "red"


@router.get("")
def get_pulse_board(db: Session = Depends(get_db)):
    today = date.today()

    # Try CoS workspace first
    board_snapshot = cos_reader.get_board_snapshot()
    followups = cos_reader.get_all_followups()
    perf_data = cos_reader.get_performance_data()
    roster = cos_reader.get_team_roster()

    if board_snapshot and roster:
        # Build from real CoS data
        team_board = board_snapshot.get("team", {})
        perf_by_person = {p["person"]: p for p in perf_data if "person" in p}

        # Build roster lookup
        roster_map = {r["slug"]: r for r in roster}

        # Build followup lookup by person
        fu_by_person = {}
        for fu in followups:
            who = fu.get("who", "")
            if who not in fu_by_person:
                fu_by_person[who] = []
            fu_by_person[who].append(fu)

        board = []
        total_active = 0
        total_done = 0
        total_overdue = 0
        reliability_scores = []

        # Iterate over team in board snapshot
        for slug, member_data in team_board.items():
            roster_info = roster_map.get(slug, {})
            perf = perf_by_person.get(slug)
            person_fus = fu_by_person.get(slug, [])

            active_fus = [f for f in person_fus if f.get("status") in ("open", "in_progress")]
            done_fus = [f for f in person_fus if f.get("status") == "resolved"]
            overdue_fus = [f for f in active_fus if f.get("due") and f["due"] < str(today)]

            reliability = member_data.get("reliability", 0)
            if perf:
                reliability = perf.get("on_time_rate", reliability)
            reliability_scores.append(reliability)

            score = perf.get("score") if perf else None
            rating = perf.get("rating") if perf else None

            total_active += len(active_fus)
            total_done += len(done_fus)
            total_overdue += len(overdue_fus)

            board.append({
                "slug": slug,
                "name": member_data.get("name", roster_info.get("name", slug)),
                "role": roster_info.get("role", ""),
                "emoji": "",
                "active_tasks": [
                    {
                        "fu_id": f.get("id", ""),
                        "what": f.get("what", ""),
                        "due": f.get("due"),
                        "priority": f.get("priority", "P2"),
                    }
                    for f in active_fus
                ],
                "active_count": len(active_fus),
                "done_count": len(done_fus),
                "overdue_count": len(overdue_fus),
                "open": member_data.get("open", 0),
                "in_progress": member_data.get("in_progress", 0),
                "completed_today": member_data.get("completed_today", 0),
                "workload": member_data.get("workload", "light"),
                "reliability": reliability,
                "health": get_person_health(reliability if reliability else 50),
                "score": score,
                "rating": rating,
            })

        avg_reliability = round(sum(reliability_scores) / len(reliability_scores)) if reliability_scores else 0

        return {
            "stats": {
                "active_tasks": total_active,
                "done_today": sum(m.get("completed_today", 0) for m in team_board.values()),
                "overdue": total_overdue,
                "team_reliability": avg_reliability,
            },
            "team": board,
            "date": board_snapshot.get("date", str(today)),
        }

    # Fallback to DB
    members = db.query(TeamMember).all()
    board = []
    total_active = 0
    total_done = 0
    total_overdue = 0
    reliability_scores = []

    for m in members:
        active = db.query(Followup).filter(
            Followup.who == m.slug, Followup.status.in_(["open", "in_progress"])
        ).all()
        done = db.query(Followup).filter(
            Followup.who == m.slug, Followup.status == "resolved"
        ).all()
        overdue = [f for f in active if f.due and f.due < today]

        perf = db.query(PerformanceSnapshot).filter(
            PerformanceSnapshot.person == m.slug
        ).order_by(PerformanceSnapshot.evaluated_at.desc()).first()

        reliability = perf.on_time_rate if perf else 80
        reliability_scores.append(reliability)

        total_active += len(active)
        total_done += len(done)
        total_overdue += len(overdue)

        board.append({
            "slug": m.slug,
            "name": m.name,
            "role": m.role,
            "emoji": m.emoji,
            "active_tasks": [{"fu_id": f.fu_id, "what": f.what, "due": str(f.due) if f.due else None, "priority": f.priority} for f in active],
            "active_count": len(active),
            "done_count": len(done),
            "overdue_count": len(overdue),
            "reliability": reliability,
            "health": get_person_health(reliability),
            "score": perf.score if perf else None,
            "rating": perf.rating if perf else None,
        })

    avg_reliability = round(sum(reliability_scores) / len(reliability_scores)) if reliability_scores else 0

    return {
        "stats": {
            "active_tasks": total_active,
            "done_today": total_done,
            "overdue": total_overdue,
            "team_reliability": avg_reliability,
        },
        "team": board,
        "date": str(today),
    }


@router.get("/summary")
def get_pulse_summary(db: Session = Depends(get_db)):
    # Try CoS workspace first
    followups = cos_reader.get_all_followups()
    roster = cos_reader.get_team_roster()
    today = str(date.today())

    if followups is not None and roster:
        active = [f for f in followups if f.get("status") in ("open", "in_progress")]
        overdue = [f for f in active if f.get("due") and f["due"] < today]
        return {
            "summary": f"{len(roster)} team members, {len(active)} active tasks, {len(overdue)} overdue",
            "active": len(active),
            "overdue": len(overdue),
            "team_size": len(roster),
        }

    # Fallback to DB
    members = db.query(TeamMember).count()
    active = db.query(Followup).filter(Followup.status.in_(["open", "in_progress"])).count()
    overdue = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"]),
        Followup.due < date.today()
    ).count()
    return {
        "summary": f"{members} team members, {active} active tasks, {overdue} overdue",
        "active": active,
        "overdue": overdue,
        "team_size": members,
    }


@router.get("/person/{slug}")
def get_person_detail(slug: str, db: Session = Depends(get_db)):
    today = str(date.today())

    # Try CoS workspace first
    roster = cos_reader.get_team_roster()
    roster_map = {r["slug"]: r for r in roster} if roster else {}
    person_info = roster_map.get(slug)
    perf = cos_reader.get_person_performance(slug)
    followups = cos_reader.get_all_followups()

    if person_info and followups is not None:
        person_fus = [f for f in followups if f.get("who") == slug]
        active = [f for f in person_fus if f.get("status") in ("open", "in_progress")]
        resolved = [f for f in person_fus if f.get("status") == "resolved"]
        overdue = [f for f in active if f.get("due") and f["due"] < today]

        return {
            "member": {
                "slug": slug,
                "name": person_info.get("name", slug),
                "role": person_info.get("role", ""),
                "emoji": "",
                "email": person_info.get("email"),
            },
            "tasks": {
                "active": [{"fu_id": f.get("id", ""), "what": f.get("what", ""), "due": f.get("due"), "priority": f.get("priority"), "status": f.get("status")} for f in active],
                "resolved": [{"fu_id": f.get("id", ""), "what": f.get("what", ""), "resolved_at": f.get("resolved_at")} for f in resolved],
                "overdue": [{"fu_id": f.get("id", ""), "what": f.get("what", ""), "due": f.get("due")} for f in overdue],
            },
            "performance": {
                "score": perf.get("score") if perf else None,
                "rating": perf.get("rating") if perf else None,
                "completion_rate": perf.get("completion_rate") if perf else None,
                "on_time_rate": perf.get("on_time_rate") if perf else None,
            },
            "health": get_person_health(perf.get("on_time_rate", 50) if perf else 80),
        }

    # Fallback to DB
    member = db.query(TeamMember).filter(TeamMember.slug == slug).first()
    if not member:
        return {"error": "Person not found"}

    today_date = date.today()
    tasks = db.query(Followup).filter(Followup.who == slug).all()
    active = [f for f in tasks if f.status in ("open", "in_progress")]
    resolved = [f for f in tasks if f.status == "resolved"]
    overdue = [f for f in active if f.due and f.due < today_date]

    db_perf = db.query(PerformanceSnapshot).filter(
        PerformanceSnapshot.person == slug
    ).order_by(PerformanceSnapshot.evaluated_at.desc()).first()

    return {
        "member": {
            "slug": member.slug,
            "name": member.name,
            "role": member.role,
            "emoji": member.emoji,
            "email": member.email,
        },
        "tasks": {
            "active": [{"fu_id": f.fu_id, "what": f.what, "due": str(f.due) if f.due else None, "priority": f.priority, "status": f.status} for f in active],
            "resolved": [{"fu_id": f.fu_id, "what": f.what, "resolved_at": str(f.resolved_at) if f.resolved_at else None} for f in resolved],
            "overdue": [{"fu_id": f.fu_id, "what": f.what, "due": str(f.due)} for f in overdue],
        },
        "performance": {
            "score": db_perf.score if db_perf else None,
            "rating": db_perf.rating if db_perf else None,
            "completion_rate": db_perf.completion_rate if db_perf else None,
            "on_time_rate": db_perf.on_time_rate if db_perf else None,
        },
        "health": get_person_health(db_perf.on_time_rate if db_perf else 80),
    }
