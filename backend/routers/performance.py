from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from models import PerformanceSnapshot, TeamMember
from schemas import PerformanceOut
import cos_reader

router = APIRouter(prefix="/api/performance", tags=["performance"])


@router.get("/report")
def get_performance_report(
    period: str = Query("biweekly"),
    db: Session = Depends(get_db),
):
    # Primary: CoS workspace
    perf_data = cos_reader.get_performance_data()
    roster = cos_reader.get_team_roster()

    if perf_data and roster:
        roster_map = {r["slug"]: r for r in roster}
        report = []
        for p in perf_data:
            slug = p.get("person", "")
            member = roster_map.get(slug, {})
            report.append({
                "name": p.get("name", member.get("name", slug)),
                "slug": slug,
                "emoji": "",
                "score": p.get("score"),
                "rating": p.get("rating"),
                "total_assigned": p.get("total_assigned"),
                "total_completed": p.get("total_completed"),
                "completion_rate": p.get("completion_rate"),
                "on_time_rate": p.get("on_time_rate"),
                "overdue_count": p.get("overdue_count"),
                "period_days": p.get("period_days"),
                "open_count": p.get("open_count"),
                "carry_rate": p.get("carry_rate"),
            })
        report.sort(key=lambda x: x.get("score") or 0, reverse=True)
        return {"period": period, "team": report}

    # Fallback to DB
    members = db.query(TeamMember).all()
    report = []
    for m in members:
        snap = db.query(PerformanceSnapshot).filter(
            PerformanceSnapshot.person == m.slug,
            PerformanceSnapshot.period == period,
        ).order_by(PerformanceSnapshot.evaluated_at.desc()).first()
        if snap:
            report.append({
                "name": m.name,
                "slug": m.slug,
                "emoji": m.emoji,
                "score": snap.score,
                "rating": snap.rating,
                "total_assigned": snap.total_assigned,
                "total_completed": snap.total_completed,
                "completion_rate": snap.completion_rate,
                "on_time_rate": snap.on_time_rate,
                "overdue_count": snap.overdue_count,
            })
    report.sort(key=lambda x: x["score"], reverse=True)
    return {"period": period, "team": report}


@router.get("/flag")
def get_flagged_performers(db: Session = Depends(get_db)):
    # Primary: CoS workspace
    perf_data = cos_reader.get_performance_data()
    roster = cos_reader.get_team_roster()

    if perf_data and roster:
        roster_map = {r["slug"]: r for r in roster}
        flagged = []
        for p in perf_data:
            if (p.get("score") or 100) < 65:
                slug = p.get("person", "")
                member = roster_map.get(slug, {})
                flagged.append({
                    "name": p.get("name", member.get("name", slug)),
                    "slug": slug,
                    "score": p.get("score"),
                    "rating": p.get("rating"),
                    "on_time_rate": p.get("on_time_rate"),
                    "overdue_count": p.get("overdue_count"),
                })
        return {"flagged": flagged}

    # Fallback to DB
    flagged = []
    members = db.query(TeamMember).all()
    for m in members:
        snap = db.query(PerformanceSnapshot).filter(
            PerformanceSnapshot.person == m.slug
        ).order_by(PerformanceSnapshot.evaluated_at.desc()).first()
        if snap and snap.score < 65:
            flagged.append({
                "name": m.name,
                "slug": m.slug,
                "score": snap.score,
                "rating": snap.rating,
                "on_time_rate": snap.on_time_rate,
                "overdue_count": snap.overdue_count,
            })
    return {"flagged": flagged}


@router.get("/{person}")
def get_person_performance(person: str, db: Session = Depends(get_db)):
    # Primary: CoS workspace
    perf = cos_reader.get_person_performance(person)
    roster = cos_reader.get_team_roster()

    if perf:
        roster_map = {r["slug"]: r for r in roster} if roster else {}
        member = roster_map.get(person, {})
        return {
            "name": perf.get("name", member.get("name", person)),
            "slug": person,
            "emoji": "",
            "role": member.get("role", ""),
            "score": perf.get("score"),
            "rating": perf.get("rating"),
            "total_assigned": perf.get("total_assigned"),
            "total_completed": perf.get("total_completed"),
            "completion_rate": perf.get("completion_rate"),
            "on_time_rate": perf.get("on_time_rate"),
            "overdue_count": perf.get("overdue_count"),
            "period": f"{perf.get('period_days', 14)} days",
            "period_days": perf.get("period_days"),
            "open_count": perf.get("open_count"),
            "carry_rate": perf.get("carry_rate"),
            "evaluated_at": perf.get("evaluated_at"),
        }

    # Fallback to DB
    member_db = db.query(TeamMember).filter(TeamMember.slug == person).first()
    if not member_db:
        return {"error": "Person not found"}
    snap = db.query(PerformanceSnapshot).filter(
        PerformanceSnapshot.person == person
    ).order_by(PerformanceSnapshot.evaluated_at.desc()).first()
    if not snap:
        return {"error": "No performance data"}
    return {
        "name": member_db.name,
        "slug": member_db.slug,
        "emoji": member_db.emoji,
        "role": member_db.role,
        "score": snap.score,
        "rating": snap.rating,
        "total_assigned": snap.total_assigned,
        "total_completed": snap.total_completed,
        "completion_rate": snap.completion_rate,
        "on_time_rate": snap.on_time_rate,
        "overdue_count": snap.overdue_count,
        "period": snap.period,
    }


@router.get("/{person}/history")
def get_person_history(person: str, db: Session = Depends(get_db)):
    # Primary: CoS workspace — collect all evaluation files for this person
    perf = cos_reader.get_person_performance(person)
    if perf:
        # Currently one snapshot per person; return as single-item history
        return {
            "person": person,
            "history": [
                {
                    "date": perf.get("evaluated_at", "")[:10] if perf.get("evaluated_at") else None,
                    "score": perf.get("score"),
                    "completion_rate": perf.get("completion_rate"),
                    "on_time_rate": perf.get("on_time_rate"),
                    "overdue_count": perf.get("overdue_count"),
                    "period": f"{perf.get('period_days', 14)} days",
                }
            ],
        }

    # Fallback to DB
    snaps = db.query(PerformanceSnapshot).filter(
        PerformanceSnapshot.person == person
    ).order_by(PerformanceSnapshot.evaluated_at.asc()).all()
    return {
        "person": person,
        "history": [
            {
                "date": str(s.evaluated_at.date()) if s.evaluated_at else None,
                "score": s.score,
                "completion_rate": s.completion_rate,
                "on_time_rate": s.on_time_rate,
                "overdue_count": s.overdue_count,
                "period": s.period,
            }
            for s in snaps
        ],
    }
