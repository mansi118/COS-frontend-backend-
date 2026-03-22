from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import TeamMember, Followup, PerformanceSnapshot, BoardSnapshot
from datetime import date, timedelta
import json
import os
import cos_reader

COS_WORKSPACE = os.getenv("COS_WORKSPACE", "/home/mansigambhir/.openclaw/workspace")
PULSE_SNAPSHOTS_DIR = os.path.join(COS_WORKSPACE, "data", "pulse-snapshots")

router = APIRouter(prefix="/api/pulse", tags=["pulse"])


def get_person_health(reliability: int = 0, overdue_count: int = 0, active_count: int = 0) -> str:
    """Compute health from reliability if available, else derive from task state."""
    if reliability and reliability > 0:
        if reliability >= 85:
            return "green"
        elif reliability >= 70:
            return "yellow"
        elif reliability >= 55:
            return "orange"
        return "red"
    # No perf data — derive from overdue/active
    if overdue_count == 0 and active_count > 0:
        return "green"
    if overdue_count == 0:
        return "yellow"  # idle but nothing overdue
    if overdue_count <= 1:
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
                "health": get_person_health(reliability, len(overdue_fus), len(active_fus)),
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
            "health": get_person_health(reliability, len(overdue), len(active)),
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
            "health": get_person_health(perf.get("on_time_rate", 0) if perf else 0, len(overdue), len(active)),
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
        "health": get_person_health(db_perf.on_time_rate if db_perf else 0, len(overdue), len(active)),
    }


# --- Pulse Snapshots & Trends ---

def save_pulse_snapshot(db: Session = None):
    """Save today's aggregated stats to data/pulse-snapshots/YYYY-MM-DD.json"""
    os.makedirs(PULSE_SNAPSHOTS_DIR, exist_ok=True)
    today_str = str(date.today())
    path = os.path.join(PULSE_SNAPSHOTS_DIR, f"{today_str}.json")

    # Don't overwrite if already saved today
    if os.path.exists(path):
        return

    # Compute stats from CoS data
    followups = cos_reader.get_all_followups() or []
    active = [f for f in followups if f.get("status") in ("open", "in_progress")]
    overdue = [f for f in active if f.get("due") and f["due"] < today_str]
    done = [f for f in followups if f.get("status") == "resolved"]

    # Team health
    roster = cos_reader.get_team_roster() or []
    perf_data = cos_reader.get_performance_data() or []
    health_vals = {"green": 100, "yellow": 75, "orange": 50, "red": 25}
    healths = []
    for r in roster:
        slug = r.get("slug", "")
        person_fus = [f for f in followups if f.get("who") == slug]
        person_active = [f for f in person_fus if f.get("status") in ("open", "in_progress")]
        person_overdue = [f for f in person_active if f.get("due") and f["due"] < today_str]
        perf = next((p for p in perf_data if p.get("person") == slug), None)
        rel = perf.get("on_time_rate", 0) if perf else 0
        h = get_person_health(rel, len(person_overdue), len(person_active))
        healths.append(health_vals.get(h, 50))

    team_health = round(sum(healths) / len(healths)) if healths else 0

    snapshot = {
        "date": today_str,
        "active_tasks": len(active),
        "done_today": len(done),
        "overdue": len(overdue),
        "team_reliability": team_health,
    }

    with open(path, "w") as f:
        json.dump(snapshot, f, indent=2)


@router.get("/trends")
def get_pulse_trends(days: int = 7):
    """Return last N days of pulse stats for sparklines."""
    os.makedirs(PULSE_SNAPSHOTS_DIR, exist_ok=True)

    # Save today's snapshot if not already saved (lazy init)
    save_pulse_snapshot()

    today = date.today()
    active_tasks = []
    done_today = []
    overdue = []
    team_reliability = []
    dates = []

    for i in range(days - 1, -1, -1):  # oldest first
        d = today - timedelta(days=i)
        d_str = str(d)
        path = os.path.join(PULSE_SNAPSHOTS_DIR, f"{d_str}.json")
        try:
            with open(path, "r") as f:
                snap = json.load(f)
            active_tasks.append(snap.get("active_tasks", 0))
            done_today.append(snap.get("done_today", 0))
            overdue.append(snap.get("overdue", 0))
            team_reliability.append(snap.get("team_reliability", 0))
            dates.append(d_str)
        except (FileNotFoundError, json.JSONDecodeError):
            pass  # skip missing days

    return {
        "dates": dates,
        "active_tasks": active_tasks,
        "done_today": done_today,
        "overdue": overdue,
        "team_reliability": team_reliability,
        "data_points": len(dates),
    }


# --- Activity Feed ---

def _parse_ts(ts) -> str:
    """Normalize various timestamp formats to sortable ISO string."""
    if not ts:
        return ""
    s = str(ts)
    # Already ISO-ish — just ensure it has time component
    if "T" in s:
        return s[:26]  # trim timezone/microseconds for consistent sorting
    # Date only: 2026-03-19
    if len(s) == 10:
        return f"{s}T00:00:00"
    return s[:26]


@router.get("/activity")
def get_activity_feed(limit: int = 15):
    """Aggregate recent events from follow-ups, tasks, standups."""
    events = []

    # Follow-ups
    followups = cos_reader.get_all_followups() or []
    for fu in followups:
        fu_id = fu.get("id", "")
        who = fu.get("who", "system")
        what_text = fu.get("what", "")[:50]

        # Created event
        created = _parse_ts(fu.get("created"))
        if created:
            events.append({
                "type": "followup_created",
                "icon": "➕",
                "who": who,
                "what": f"{fu_id}: {what_text}",
                "timestamp": created,
            })

        # Resolved event
        resolved = _parse_ts(fu.get("resolved_at"))
        if resolved:
            events.append({
                "type": "followup_resolved",
                "icon": "✅",
                "who": who,
                "what": f"{fu_id} resolved: {what_text}",
                "timestamp": resolved,
            })

    # Tasks
    import taskflow_local
    tasks = taskflow_local._read_all_tasks()
    for t in tasks:
        task_id = t.get("id", "")
        owner = t.get("assigned_to") or t.get("owner") or "system"
        title = t.get("title", "")[:50]

        created = _parse_ts(t.get("created"))
        if created:
            events.append({
                "type": "task_created",
                "icon": "📋",
                "who": owner,
                "what": f"{task_id}: {title}",
                "timestamp": created,
            })

        completed = _parse_ts(t.get("completed_at"))
        if completed:
            events.append({
                "type": "task_completed",
                "icon": "☑",
                "who": owner,
                "what": f"{task_id} done: {title}",
                "timestamp": completed,
            })

    # Standups (today + yesterday)
    import standup_local
    for days_ago in range(2):
        d = str(date.today() - timedelta(days=days_ago))
        standups = standup_local.get_standups_by_date(d)
        for s in standups:
            ts = _parse_ts(s.get("created_at"))
            if ts:
                events.append({
                    "type": "standup_posted",
                    "icon": "📝",
                    "who": s.get("person", ""),
                    "what": f"posted standup ({s.get('mood', 'neutral')})",
                    "timestamp": ts,
                })

    # Sort by timestamp descending (most recent first)
    events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)

    return {"events": events[:limit], "total": len(events)}


# --- Alerts ---

@router.get("/alerts")
def get_pulse_alerts():
    """Aggregate critical + warning alerts from all systems."""
    today_str = str(date.today())
    critical = []
    warnings = []

    # Overdue follow-ups
    followups = cos_reader.get_all_followups() or []
    for fu in followups:
        if fu.get("status") not in ("open", "in_progress"):
            continue
        due = fu.get("due")
        if not due or due >= today_str:
            continue
        fu_id = fu.get("id", "")
        pri = fu.get("priority", "P2")
        what = fu.get("what", "")[:60]
        who = fu.get("who", "")
        days_over = (date.today() - date.fromisoformat(due)).days
        item = {"source": "followup", "id": fu_id, "message": f"{fu_id}: {what}", "who": who, "days_overdue": days_over, "link": "/followups"}
        if pri in ("P0",):
            critical.append({**item, "severity": "critical", "reason": f"P0 overdue by {days_over}d"})
        elif pri in ("P1",):
            critical.append({**item, "severity": "critical", "reason": f"P1 overdue by {days_over}d"})
        else:
            warnings.append({**item, "severity": "warning", "reason": f"{pri} overdue by {days_over}d"})

    # TaskFlow blocked/overdue tasks
    import taskflow_local
    all_tasks = taskflow_local._read_all_tasks()
    for t in all_tasks:
        if not taskflow_local._is_active(t):
            continue
        task_id = t.get("id", "")
        title = t.get("title", "")[:60]
        status = t.get("status", "")
        dl = t.get("when_date") or t.get("deadline")

        if status == "blocked":
            critical.append({"source": "task", "id": task_id, "severity": "critical", "message": f"{task_id}: {title}", "reason": "Task blocked", "link": "/taskflow"})
        elif dl and dl < today_str:
            days = (date.today() - date.fromisoformat(dl)).days
            warnings.append({"source": "task", "id": task_id, "severity": "warning", "message": f"{task_id}: {title}", "reason": f"Overdue by {days}d", "link": "/taskflow"})

    # At-risk clients
    clients = cos_reader.get_all_clients() or []
    for c in clients:
        health = c.get("health", c.get("health_score", 100)) or 100
        if health < 40:
            critical.append({"source": "client", "id": c.get("slug"), "severity": "critical", "message": f"{c.get('name')}: health {health}%", "reason": "Critical health", "link": "/clients"})
        elif health < 60:
            warnings.append({"source": "client", "id": c.get("slug"), "severity": "warning", "message": f"{c.get('name')}: health {health}%", "reason": "At-risk", "link": "/clients"})

    # Standup blockers
    import standup_local
    summary = standup_local.get_standup_summary()
    for b in summary.get("blockers", []):
        if b.get("blocker"):
            warnings.append({"source": "standup", "id": b["person"], "severity": "warning", "message": f"{b['person']}: {b['blocker'][:50]}", "reason": "Blocker reported", "link": "/updates"})

    return {
        "critical": critical,
        "warnings": warnings,
        "critical_count": len(critical),
        "warning_count": len(warnings),
        "total": len(critical) + len(warnings),
    }


# --- CEO Summary ---

@router.get("/ceo-summary")
def get_ceo_summary():
    """Single aggregated summary for CEO — all key metrics in one response."""
    today_str = str(date.today())
    import taskflow_local
    import standup_local

    # Follow-ups
    followups = cos_reader.get_all_followups() or []
    active_fus = [f for f in followups if f.get("status") in ("open", "in_progress")]
    overdue_fus = [f for f in active_fus if f.get("due") and f["due"] < today_str]

    # Tasks
    tf_summary = taskflow_local.get_summary()

    # Sprint
    sprint = cos_reader.get_active_sprint()
    sprint_pct = 0
    sprint_name = ""
    if sprint:
        start = sprint.get("start", sprint.get("start_date", ""))
        end = sprint.get("end", sprint.get("end_date", ""))
        try:
            total = (date.fromisoformat(end) - date.fromisoformat(start)).days or 1
            done_count = len([f for f in followups if f.get("status") == "resolved"])
            sprint_pct = round((done_count / max(len(followups), 1)) * 100)
            sprint_name = sprint.get("name", "")
        except (ValueError, TypeError):
            pass

    # Standups
    standup_stats = standup_local.get_standup_stats()

    # Clients
    clients = cos_reader.get_all_clients() or []
    at_risk = len([c for c in clients if (c.get("health", c.get("health_score", 100)) or 100) < 60])

    # Meetings
    meetings = cos_reader.get_meetings(today_str)
    meeting_count = len((meetings or {}).get("events", (meetings or {}).get("meetings", [])))

    # Team health (from person health colors)
    roster = cos_reader.get_team_roster() or []
    perf_data = cos_reader.get_performance_data() or []
    perf_map = {p.get("person"): p for p in perf_data}
    health_vals = {"green": 100, "yellow": 75, "orange": 50, "red": 25}
    healths = []
    for r in roster:
        slug = r.get("slug", "")
        person_fus = [f for f in followups if f.get("who") == slug]
        person_active = [f for f in person_fus if f.get("status") in ("open", "in_progress")]
        person_overdue = [f for f in person_active if f.get("due") and f["due"] < today_str]
        perf = perf_map.get(slug)
        rel = perf.get("on_time_rate", 0) if perf else 0
        h = get_person_health(rel, len(person_overdue), len(person_active))
        healths.append(health_vals.get(h, 50))
    team_health = round(sum(healths) / len(healths)) if healths else 0

    # Alerts count
    alerts_data = get_pulse_alerts()

    metrics = {
        "overdue": len(overdue_fus),
        "critical_alerts": alerts_data["critical_count"],
        "warning_alerts": alerts_data["warning_count"],
        "sprint_pct": sprint_pct,
        "sprint_name": sprint_name,
        "standups_posted": standup_stats["posted_count"],
        "standups_total": standup_stats["total_team"],
        "team_health": team_health,
        "at_risk_clients": at_risk,
        "meetings": meeting_count,
        "active_tasks": len(active_fus),
        "tf_overdue": tf_summary.get("overdue", 0),
    }

    # Build one-liner
    parts = []
    if metrics["overdue"]:
        parts.append(f"{metrics['overdue']} overdue")
    if metrics["critical_alerts"]:
        parts.append(f"{metrics['critical_alerts']} critical")
    if metrics["sprint_name"]:
        parts.append(f"sprint {metrics['sprint_pct']}%")
    parts.append(f"{metrics['standups_posted']}/{metrics['standups_total']} standups")
    parts.append(f"health {metrics['team_health']}%")
    if metrics["at_risk_clients"]:
        parts.append(f"{metrics['at_risk_clients']} at-risk")
    if metrics["meetings"]:
        parts.append(f"{metrics['meetings']} meeting{'s' if metrics['meetings'] > 1 else ''}")

    all_clear = metrics["overdue"] == 0 and metrics["critical_alerts"] == 0 and metrics["at_risk_clients"] == 0 and metrics["team_health"] >= 75

    return {
        "one_liner": " · ".join(parts),
        "all_clear": all_clear,
        "metrics": metrics,
    }
