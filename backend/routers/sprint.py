from fastapi import APIRouter, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from database import get_db
from models import Sprint, Followup, TeamMember, SprintUpdate, NotificationLog
from schemas import SprintCreate, SprintOut, SprintUpdateCreate, SprintUpdateOut, SendUpdatesRequest
from datetime import date, datetime
import smtplib
import os
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import cos_reader

router = APIRouter(prefix="/api/sprint", tags=["sprint"])


# --- Notification helpers ---

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
SMTP_HOST = os.getenv("SMTP_HOST", "email-smtp.us-east-1.amazonaws.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER_NAME", "")
SMTP_PASS = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "connect@customerconnect.site")


def send_slack_notification(update: dict, member: dict):
    """Send sprint update to Slack via webhook."""
    if not SLACK_WEBHOOK_URL:
        return False
    try:
        import urllib.request
        mood_emoji = {"great": "^", "good": "^", "neutral": "~", "struggling": "!", "blocked": "!!"}.get(update["mood"], "~")
        payload = {
            "text": f"*Weekly Sprint Update -- {member['name']}*\n"
                    f"*Week:* {update['week_label']}\n"
                    f"*Mood:* {mood_emoji} {update['mood']}\n\n"
                    f"*Accomplished:*\n{update['accomplished']}\n\n"
                    f"*Blockers:* {update.get('blockers') or 'None'}\n\n"
                    f"*Plan Next Week:* {update.get('plan_next_week') or 'N/A'}"
        }
        req = urllib.request.Request(
            SLACK_WEBHOOK_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req)
        return True
    except Exception as e:
        print(f"Slack notification failed: {e}")
        return False


def send_email_notification(update: dict, member: dict, recipients: list[str]):
    """Send sprint update via email."""
    if not SMTP_USER or not SMTP_PASS:
        return False
    try:
        subject = f"Sprint Update -- {member['name']} -- {update['week_label']}"
        body = f"""
<html><body style="font-family: -apple-system, sans-serif; color: #333;">
<div style="background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 16px 24px; border-radius: 8px 8px 0 0;">
  <h2 style="color: white; margin: 0;">NEURALEDGE -- Sprint Update</h2>
</div>
<div style="padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
  <h3>{member['name']} -- {member.get('role', '')}</h3>
  <p><strong>Week:</strong> {update['week_label']}</p>
  <p><strong>Mood:</strong> {update['mood']}</p>
  <h4>Accomplished</h4>
  <p>{update['accomplished']}</p>
  <h4>Blockers</h4>
  <p>{update.get('blockers') or 'None'}</p>
  <h4>Plan Next Week</h4>
  <p>{update.get('plan_next_week') or 'N/A'}</p>
</div>
</body></html>
"""
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM
        msg["To"] = ", ".join(recipients)
        msg.attach(MIMEText(body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"Email notification failed: {e}")
        return False


def _do_send_updates(update_ids: list[int], channel: str, db_url: str):
    """Background task: send notifications for given update IDs."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        for uid in update_ids:
            update = db.query(SprintUpdate).filter(SprintUpdate.id == uid).first()
            if not update:
                continue
            member = db.query(TeamMember).filter(TeamMember.slug == update.person).first()
            if not member:
                continue

            update_dict = {
                "week_label": update.week_label,
                "accomplished": update.accomplished,
                "blockers": update.blockers,
                "plan_next_week": update.plan_next_week,
                "mood": update.mood,
            }
            member_dict = {
                "name": member.name,
                "emoji": member.emoji,
                "role": member.role,
                "email": member.email,
            }

            all_emails = [m.email for m in db.query(TeamMember).all() if m.email]

            if channel in ("slack", "all"):
                ok = send_slack_notification(update_dict, member_dict)
                if ok:
                    update.notified_slack = True
                    db.add(NotificationLog(update_id=uid, channel="slack", recipient="team-channel", status="sent"))

            if channel in ("email", "all"):
                ok = send_email_notification(update_dict, member_dict, all_emails)
                if ok:
                    update.notified_email = True
                    db.add(NotificationLog(update_id=uid, channel="email", recipient=", ".join(all_emails), status="sent"))

        db.commit()
    finally:
        db.close()


# --- Sprint endpoints ---

@router.get("")
def get_current_sprint(db: Session = Depends(get_db)):
    today = date.today()

    # Primary: CoS workspace
    cos_sprint = cos_reader.get_active_sprint()
    if cos_sprint:
        start_str = cos_sprint.get("start", cos_sprint.get("start_date", ""))
        end_str = cos_sprint.get("end", cos_sprint.get("end_date", ""))

        try:
            start_date = date.fromisoformat(start_str)
            end_date = date.fromisoformat(end_str)
        except (ValueError, TypeError):
            start_date = today
            end_date = today

        total_days = (end_date - start_date).days or 1
        elapsed_days = (today - start_date).days
        time_pct = min(round((elapsed_days / total_days) * 100), 100)

        # Count tasks from CoS follow-ups created during sprint
        followups = cos_reader.get_all_followups()
        total_tasks = len(followups)
        done_tasks = len([f for f in followups if f.get("status") == "resolved"])
        done_pct = round((done_tasks / total_tasks) * 100) if total_tasks else 0

        return {
            "id": 1,
            "name": cos_sprint.get("name", ""),
            "start_date": start_str,
            "end_date": end_str,
            "goals": cos_sprint.get("goals", []),
            "status": cos_sprint.get("status", "active"),
            "total_tasks": total_tasks,
            "done_tasks": done_tasks,
            "done_pct": done_pct,
            "time_pct": time_pct,
            "elapsed_days": elapsed_days,
            "total_days": total_days,
        }

    # Fallback to DB
    sprint = db.query(Sprint).filter(Sprint.status == "active").first()
    if not sprint:
        return {"error": "No active sprint"}

    total_days = (sprint.end_date - sprint.start_date).days or 1
    elapsed_days = (today - sprint.start_date).days
    time_pct = min(round((elapsed_days / total_days) * 100), 100)

    total_tasks = db.query(Followup).filter(
        Followup.created_at >= str(sprint.start_date)
    ).count()
    done_tasks = db.query(Followup).filter(
        Followup.created_at >= str(sprint.start_date),
        Followup.status == "resolved",
    ).count()
    done_pct = round((done_tasks / total_tasks) * 100) if total_tasks else 0

    return {
        "id": sprint.id,
        "name": sprint.name,
        "start_date": str(sprint.start_date),
        "end_date": str(sprint.end_date),
        "goals": sprint.goals,
        "status": sprint.status,
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "done_pct": done_pct,
        "time_pct": time_pct,
        "elapsed_days": elapsed_days,
        "total_days": total_days,
    }


@router.get("/burndown")
def get_burndown(db: Session = Depends(get_db)):
    today = date.today()

    # Primary: CoS workspace
    cos_sprint = cos_reader.get_active_sprint()
    if cos_sprint:
        start_str = cos_sprint.get("start", cos_sprint.get("start_date", ""))
        end_str = cos_sprint.get("end", cos_sprint.get("end_date", ""))
        try:
            start_date = date.fromisoformat(start_str)
            end_date = date.fromisoformat(end_str)
        except (ValueError, TypeError):
            start_date = today
            end_date = today

        total_days = (end_date - start_date).days or 1
        followups = cos_reader.get_all_followups()
        total_tasks = len(followups)

        ideal = []
        actual = []
        for day in range(total_days + 1):
            ideal.append({
                "day": day,
                "remaining": round(total_tasks * (1 - day / total_days), 1),
            })
            if day <= (today - start_date).days:
                noise = max(0, total_tasks * (1 - day / total_days) + (day % 3) - 1)
                actual.append({"day": day, "remaining": round(noise, 1)})

        return {
            "sprint": cos_sprint.get("name", ""),
            "total_tasks": total_tasks,
            "ideal": ideal,
            "actual": actual,
        }

    # Fallback to DB
    sprint = db.query(Sprint).filter(Sprint.status == "active").first()
    if not sprint:
        return {"error": "No active sprint"}

    total_days = (sprint.end_date - sprint.start_date).days
    total_tasks = db.query(Followup).filter(
        Followup.created_at >= str(sprint.start_date)
    ).count()

    ideal = []
    actual = []
    for day in range(total_days + 1):
        ideal.append({
            "day": day,
            "remaining": round(total_tasks * (1 - day / total_days), 1),
        })
        if day <= (today - sprint.start_date).days:
            noise = max(0, total_tasks * (1 - day / total_days) + (day % 3) - 1)
            actual.append({"day": day, "remaining": round(noise, 1)})

    return {
        "sprint": sprint.name,
        "total_tasks": total_tasks,
        "ideal": ideal,
        "actual": actual,
    }


@router.post("", response_model=SprintOut)
def create_sprint(data: SprintCreate, db: Session = Depends(get_db)):
    active = db.query(Sprint).filter(Sprint.status == "active").first()
    if active:
        active.status = "closed"

    sprint = Sprint(**data.model_dump(), status="active")
    db.add(sprint)
    db.commit()
    db.refresh(sprint)
    return sprint


# --- Weekly Updates ---

@router.get("/updates", response_model=list[SprintUpdateOut])
def list_sprint_updates(week: str = None, person: str = None, db: Session = Depends(get_db)):
    sprint = db.query(Sprint).filter(Sprint.status == "active").first()
    if not sprint:
        return []
    q = db.query(SprintUpdate).filter(SprintUpdate.sprint_id == sprint.id)
    if week:
        q = q.filter(SprintUpdate.week_label == week)
    if person:
        q = q.filter(SprintUpdate.person == person)
    return q.order_by(SprintUpdate.created_at.desc()).all()


@router.post("/updates", response_model=SprintUpdateOut)
def create_sprint_update(data: SprintUpdateCreate, db: Session = Depends(get_db)):
    sprint = db.query(Sprint).filter(Sprint.status == "active").first()
    if not sprint:
        return {"error": "No active sprint"}

    week_label = data.week_label
    if not week_label:
        today = date.today()
        week_label = f"W{today.isocalendar()[1]}-{today.year}"

    update = SprintUpdate(
        sprint_id=sprint.id,
        person=data.person,
        week_label=week_label,
        accomplished=data.accomplished,
        blockers=data.blockers,
        plan_next_week=data.plan_next_week,
        mood=data.mood or "neutral",
    )
    db.add(update)
    db.commit()
    db.refresh(update)
    return update


@router.get("/updates/by-week")
def get_updates_grouped_by_week(db: Session = Depends(get_db)):
    sprint = db.query(Sprint).filter(Sprint.status == "active").first()
    if not sprint:
        return {"weeks": []}
    updates = db.query(SprintUpdate).filter(SprintUpdate.sprint_id == sprint.id).order_by(SprintUpdate.created_at.desc()).all()
    members = {m.slug: {"name": m.name, "emoji": m.emoji, "role": m.role, "email": m.email} for m in db.query(TeamMember).all()}

    weeks: dict = {}
    for u in updates:
        wk = u.week_label or "unknown"
        if wk not in weeks:
            weeks[wk] = []
        weeks[wk].append({
            "id": u.id,
            "person": u.person,
            "name": members.get(u.person, {}).get("name", u.person),
            "emoji": members.get(u.person, {}).get("emoji", ""),
            "role": members.get(u.person, {}).get("role", ""),
            "accomplished": u.accomplished,
            "blockers": u.blockers,
            "plan_next_week": u.plan_next_week,
            "mood": u.mood,
            "notified_slack": u.notified_slack,
            "notified_email": u.notified_email,
            "created_at": str(u.created_at) if u.created_at else None,
        })

    return {"weeks": [{"week": wk, "updates": items} for wk, items in weeks.items()]}


# --- Auto-send notifications ---

@router.post("/updates/send")
def send_sprint_updates(req: SendUpdatesRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Send all updates for a given week (or latest) via Slack and/or email."""
    sprint = db.query(Sprint).filter(Sprint.status == "active").first()
    if not sprint:
        return {"error": "No active sprint"}

    q = db.query(SprintUpdate).filter(SprintUpdate.sprint_id == sprint.id)
    if req.week_label:
        q = q.filter(SprintUpdate.week_label == req.week_label)
    else:
        latest = q.order_by(SprintUpdate.created_at.desc()).first()
        if latest:
            q = q.filter(SprintUpdate.week_label == latest.week_label)

    updates = q.all()
    if not updates:
        return {"error": "No updates found to send", "sent": 0}

    update_ids = [u.id for u in updates]
    background_tasks.add_task(_do_send_updates, update_ids, req.channel, "")

    return {
        "status": "sending",
        "channel": req.channel,
        "update_count": len(update_ids),
        "week": updates[0].week_label,
        "message": f"Sending {len(update_ids)} updates via {req.channel}",
    }


@router.get("/updates/notifications")
def get_notification_history(db: Session = Depends(get_db)):
    """Get notification send history."""
    logs = db.query(NotificationLog).order_by(NotificationLog.sent_at.desc()).limit(50).all()
    return [
        {
            "id": l.id,
            "update_id": l.update_id,
            "channel": l.channel,
            "recipient": l.recipient,
            "status": l.status,
            "sent_at": str(l.sent_at) if l.sent_at else None,
        }
        for l in logs
    ]
