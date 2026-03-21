from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import Followup, TeamMember, Client, Sprint, PerformanceSnapshot
from datetime import date
import cos_reader

router = APIRouter(prefix="/api/briefing", tags=["briefing"])


@router.get("/morning")
def morning_briefing(db: Session = Depends(get_db)):
    today = date.today()
    today_str = today.isoformat()

    # Primary: CoS workspace
    followups = cos_reader.get_all_followups()
    meetings = cos_reader.get_meetings(today_str)
    board = cos_reader.get_board_snapshot()
    perf_data = cos_reader.get_performance_data()
    cos_sprint = cos_reader.get_active_sprint()
    clients = cos_reader.get_all_clients()

    if followups is not None:
        active_fus = [f for f in followups if f.get("status") in ("open", "in_progress")]
        overdue = [f for f in active_fus if f.get("due") and f["due"] < today_str]
        due_today = [f for f in active_fus if f.get("due") == today_str]

        # At-risk clients
        at_risk_clients = 0
        if clients:
            at_risk_clients = len([c for c in clients if (c.get("health", c.get("health_score", 100)) or 100) < 60])

        # Sprint info
        sprint_info = None
        if cos_sprint:
            start_str = cos_sprint.get("start", cos_sprint.get("start_date", ""))
            end_str = cos_sprint.get("end", cos_sprint.get("end_date", ""))
            try:
                start_date = date.fromisoformat(start_str)
                end_date = date.fromisoformat(end_str)
                total_days = (end_date - start_date).days or 1
                elapsed = (today - start_date).days
                sprint_info = {
                    "name": cos_sprint.get("name", ""),
                    "days_remaining": max(0, total_days - elapsed),
                    "time_pct": min(round((elapsed / total_days) * 100), 100),
                }
            except (ValueError, TypeError):
                pass

        # Flagged performers
        flagged = []
        for p in perf_data:
            if (p.get("score") or 100) < 65:
                flagged.append({
                    "name": p.get("name", p.get("person", "")),
                    "score": p.get("score"),
                })

        # Meetings
        meeting_list = []
        if meetings:
            for m in meetings.get("meetings", meetings.get("events", [])):
                meeting_list.append({
                    "title": m.get("summary", m.get("title", "")),
                    "start": m.get("start", ""),
                    "end": m.get("end", ""),
                    "meet_link": m.get("hangoutLink", m.get("meet_link", "")),
                    "organizer": m.get("organizer", ""),
                    "attendees": m.get("attendees", []),
                })

        # Overdue details
        overdue_details = [
            {
                "fu_id": f.get("id"),
                "what": f.get("what"),
                "who": f.get("who"),
                "due": f.get("due"),
                "priority": f.get("priority"),
            }
            for f in overdue
        ]

        return {
            "date": today_str,
            "greeting": f"Good morning! Here's your briefing for {today.strftime('%A, %B %d')}.",
            "overdue_tasks": len(overdue),
            "overdue_details": overdue_details,
            "due_today": len(due_today),
            "active_tasks": len(active_fus),
            "at_risk_clients": at_risk_clients,
            "sprint": sprint_info,
            "flagged_performers": flagged,
            "meetings": meeting_list,
            "meetings_count": len(meeting_list),
        }

    # Fallback to DB
    overdue = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"]),
        Followup.due < today,
    ).count()
    due_today = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"]),
        Followup.due == today,
    ).count()
    active = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"])
    ).count()

    at_risk_clients = db.query(Client).filter(Client.health_score < 60).count()

    sprint = db.query(Sprint).filter(Sprint.status == "active").first()
    sprint_info = None
    if sprint:
        total_days = (sprint.end_date - sprint.start_date).days or 1
        elapsed = (today - sprint.start_date).days
        sprint_info = {
            "name": sprint.name,
            "days_remaining": max(0, total_days - elapsed),
            "time_pct": min(round((elapsed / total_days) * 100), 100),
        }

    flagged = []
    for m in db.query(TeamMember).all():
        snap = db.query(PerformanceSnapshot).filter(
            PerformanceSnapshot.person == m.slug
        ).order_by(PerformanceSnapshot.evaluated_at.desc()).first()
        if snap and snap.score < 65:
            flagged.append({"name": m.name, "score": snap.score})

    return {
        "date": str(today),
        "greeting": f"Good morning! Here's your briefing for {today.strftime('%A, %B %d')}.",
        "overdue_tasks": overdue,
        "due_today": due_today,
        "active_tasks": active,
        "at_risk_clients": at_risk_clients,
        "sprint": sprint_info,
        "flagged_performers": flagged,
        "meetings": [],
        "meetings_count": 0,
    }


@router.get("/eod")
def eod_summary(db: Session = Depends(get_db)):
    today = date.today()
    today_str = today.isoformat()

    # Primary: CoS workspace EOD snapshot
    eod = cos_reader.get_eod_snapshot()
    followups = cos_reader.get_all_followups()

    if eod:
        summary = eod.get("summary", {})
        critical = eod.get("critical", {})
        return {
            "date": eod.get("date", today_str),
            "time": eod.get("time", ""),
            "resolved_today": summary.get("completed_today", 0),
            "still_open": summary.get("total_follow_ups", 0) - summary.get("completed_today", 0),
            "overdue": summary.get("overdue_items", 0),
            "p0_incidents": summary.get("p0_incidents", 0),
            "on_track": summary.get("on_track", 0),
            "at_risk": summary.get("at_risk", 0),
            "critical": critical,
            "team": eod.get("team", {}),
            "trends": eod.get("trends", {}),
            "configuration_blockers": eod.get("configuration_blockers", []),
            "summary": f"Today: {summary.get('completed_today', 0)} resolved, "
                       f"{summary.get('total_follow_ups', 0)} total follow-ups, "
                       f"{summary.get('overdue_items', 0)} overdue.",
        }

    if followups is not None:
        active = [f for f in followups if f.get("status") in ("open", "in_progress")]
        resolved = [f for f in followups if f.get("status") == "resolved"]
        overdue = [f for f in active if f.get("due") and f["due"] < today_str]
        return {
            "date": today_str,
            "resolved_today": len(resolved),
            "still_open": len(active),
            "overdue": len(overdue),
            "summary": f"Today: {len(resolved)} resolved, {len(active)} still open, {len(overdue)} overdue.",
        }

    # Fallback to DB
    resolved_today = db.query(Followup).filter(
        Followup.status == "resolved",
        Followup.resolved_at != None,
    ).count()
    still_open = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"])
    ).count()
    overdue = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"]),
        Followup.due < today,
    ).count()

    return {
        "date": str(today),
        "resolved_today": resolved_today,
        "still_open": still_open,
        "overdue": overdue,
        "summary": f"Today: {resolved_today} resolved, {still_open} still open, {overdue} overdue.",
    }
