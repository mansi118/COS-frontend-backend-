from fastapi import APIRouter, BackgroundTasks
import convex_db
from schemas import SprintCreate, SprintUpdateCreate, SendUpdatesRequest
from datetime import date, datetime, timedelta
import smtplib
import os
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import standup_service as standup_local

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
        mood_emoji = {"great": "^", "good": "^", "neutral": "~", "struggling": "!", "blocked": "!!"}.get(update.get("mood", ""), "~")
        payload = {
            "text": f"*Weekly Sprint Update -- {member['name']}*\n"
                    f"*Week:* {update['week_label']}\n"
                    f"*Mood:* {mood_emoji} {update.get('mood', '')}\n\n"
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
  <p><strong>Mood:</strong> {update.get('mood', '')}</p>
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


def _do_send_updates(update_ids: list[str], channel: str):
    """Background task: send notifications for given sprint update Convex IDs."""
    try:
        members = convex_db.list_team_members() or []
        member_map = {m.get("slug"): m for m in members}
        all_emails = [m.get("email") for m in members if m.get("email")]

        for uid in update_ids:
            update = convex_db.get_sprint_update(uid)
            if not update:
                continue
            member = member_map.get(update.get("person"), {})
            if not member:
                continue

            update_dict = {
                "week_label": update.get("week_label", ""),
                "accomplished": update.get("accomplished", ""),
                "blockers": update.get("blockers"),
                "plan_next_week": update.get("plan_next_week"),
                "mood": update.get("mood"),
            }
            member_dict = {
                "name": member.get("name", ""),
                "emoji": member.get("emoji", ""),
                "role": member.get("role", ""),
                "email": member.get("email", ""),
            }

            if channel in ("slack", "all"):
                ok = send_slack_notification(update_dict, member_dict)
                if ok:
                    convex_db.patch_sprint_update(uid, {"notified_slack": True})
                    convex_db.insert_notification({
                        "channel": "slack",
                        "recipient": "team-channel",
                        "status": "sent",
                        "sent_at": datetime.utcnow().isoformat(),
                    })

            if channel in ("email", "all"):
                ok = send_email_notification(update_dict, member_dict, all_emails)
                if ok:
                    convex_db.patch_sprint_update(uid, {"notified_email": True})
                    convex_db.insert_notification({
                        "channel": "email",
                        "recipient": ", ".join(all_emails),
                        "status": "sent",
                        "sent_at": datetime.utcnow().isoformat(),
                    })
    except Exception as e:
        print(f"[sprint] _do_send_updates error: {e}")


# --- Sprint endpoints ---

@router.get("")
def get_current_sprint():
    today = date.today()

    # Primary: CoS workspace
    cos_sprint = convex_db.get_active_sprint()
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

        # Count tasks from CoS follow-ups created during sprint (filtered by date)
        followups = convex_db.list_followups() or []
        sprint_fus = [f for f in followups if (f.get("created_at", f.get("created", ""))[:10] or "") >= start_str]
        total_tasks = len(sprint_fus)
        done_tasks = len([f for f in sprint_fus if f.get("status") == "resolved"])
        open_tasks = len([f for f in sprint_fus if f.get("status") in ("open", "in_progress")])
        overdue_tasks = len([f for f in sprint_fus
            if f.get("status") in ("open", "in_progress")
            and (f.get("due") or "9999") < str(today)])
        done_pct = round((done_tasks / total_tasks) * 100) if total_tasks else 0

        # Checklist-level progress
        total_items = sum(len(f.get("checklist", f.get("checklist_items")) or []) for f in sprint_fus)
        done_items = sum(
            len([ci for ci in (f.get("checklist", f.get("checklist_items")) or []) if ci.get("completed")])
            for f in sprint_fus
        )
        items_pct = round((done_items / total_items) * 100) if total_items else 0

        # Velocity (tasks per week)
        elapsed_weeks = max(elapsed_days / 7, 0.1)
        velocity = round(done_tasks / elapsed_weeks, 1)

        return {
            "id": 1,
            "name": cos_sprint.get("name", ""),
            "start_date": start_str,
            "end_date": end_str,
            "goals": cos_sprint.get("goals", []),
            "status": cos_sprint.get("status", "active"),
            "total_tasks": total_tasks,
            "done_tasks": done_tasks,
            "open_tasks": open_tasks,
            "overdue_tasks": overdue_tasks,
            "done_pct": done_pct,
            "time_pct": time_pct,
            "elapsed_days": elapsed_days,
            "total_days": total_days,
            "total_items": total_items,
            "done_items": done_items,
            "items_pct": items_pct,
            "velocity": velocity,
        }

    # Fallback: Convex
    sprint = convex_db.get_active_sprint()
    if not sprint:
        return {"error": "No active sprint"}

    try:
        start_date = date.fromisoformat(sprint["start_date"])
        end_date = date.fromisoformat(sprint["end_date"])
    except (ValueError, TypeError, KeyError):
        return {"error": "Invalid sprint dates"}

    total_days = (end_date - start_date).days or 1
    elapsed_days = (today - start_date).days
    time_pct = min(round((elapsed_days / total_days) * 100), 100)
    fus = convex_db.list_followups() or []
    sprint_fus = [f for f in fus if (f.get("created_at", "")[:10] or "") >= sprint["start_date"]]
    total_tasks = len(sprint_fus)
    done_tasks = len([f for f in sprint_fus if f.get("status") == "resolved"])
    done_pct = round((done_tasks / total_tasks) * 100) if total_tasks else 0

    return {
        "id": 1,
        "name": sprint.get("name", ""),
        "start_date": sprint["start_date"],
        "end_date": sprint["end_date"],
        "goals": sprint.get("goals", []),
        "status": sprint.get("status", "active"),
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "done_pct": done_pct,
        "time_pct": time_pct,
        "elapsed_days": elapsed_days,
        "total_days": total_days,
    }


@router.get("/burndown")
def get_burndown():
    today = date.today()

    # Primary: CoS workspace
    cos_sprint = convex_db.get_active_sprint()
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
        elapsed_days = min((today - start_date).days, total_days)
        followups = convex_db.list_followups() or []
        sprint_fus = [f for f in followups if (f.get("created_at", f.get("created", ""))[:10] or "") >= start_str]
        total_tasks = len(sprint_fus)

        ideal = []
        actual = []
        for day in range(total_days + 1):
            ideal.append({
                "day": day,
                "remaining": round(total_tasks * (1 - day / total_days), 1),
            })

        # Real burndown: count FUs resolved by each day (from resolved_at timestamps)
        for day in range(elapsed_days + 1):
            current_date = (start_date + timedelta(days=day)).strftime("%Y-%m-%d")
            done_by = len([f for f in sprint_fus
                if f.get("status") == "resolved"
                and (f.get("resolved_at", "")[:10] or "") <= current_date])
            actual.append({"day": day, "remaining": total_tasks - done_by})

        return {
            "sprint": cos_sprint.get("name", ""),
            "total_tasks": total_tasks,
            "ideal": ideal,
            "actual": actual,
        }

    return {"error": "No active sprint", "ideal": [], "actual": []}


@router.get("/standup-activity")
def get_sprint_standup_activity():
    """Daily standup data for the current sprint — mood, highlights, blockers per day."""
    cos_sprint = convex_db.get_active_sprint()
    if not cos_sprint:
        return {"days": [], "mood_trend": []}

    start_str = cos_sprint.get("start", cos_sprint.get("start_date", ""))
    try:
        start_date = date.fromisoformat(start_str)
    except (ValueError, TypeError):
        return {"days": [], "mood_trend": []}

    today = date.today()
    elapsed_days = (today - start_date).days

    mood_values = {"great": 5, "good": 4, "neutral": 3, "struggling": 2, "blocked": 1}
    mood_names = {5: "great", 4: "good", 3: "neutral", 2: "struggling", 1: "blocked"}

    days = []
    mood_trend = []

    for d in range(elapsed_days + 1):
        current_date = (start_date + timedelta(days=d)).strftime("%Y-%m-%d")
        standups = standup_local.get_standups_by_date(current_date)

        posted = len(standups)
        roster = convex_db.list_team_members() or []
        total = len(roster)

        moods = [mood_values.get(s.get("mood", "neutral"), 3) for s in standups]
        avg_mood_score = round(sum(moods) / len(moods)) if moods else 3
        avg_mood = mood_names.get(avg_mood_score, "neutral")

        highlights = []
        for s in standups:
            highlights.extend(s.get("highlights", [])[:2])

        blockers = len([s for s in standups if s.get("blockers")])

        days.append({
            "date": current_date,
            "posted": posted,
            "total": total,
            "mood": avg_mood,
            "highlights": highlights[:4],
            "blockers": blockers,
        })

        mood_trend.append({
            "date": current_date,
            "mood": avg_mood,
            "score": avg_mood_score if posted > 0 else None,
        })

    return {"days": days, "mood_trend": mood_trend}


@router.post("/updates/auto-generate")
def auto_generate_weekly_updates():
    """Auto-generate weekly updates from daily standups for the current week."""
    # Try CoS first, then Convex
    cos_sprint = convex_db.get_active_sprint()
    sprint_id = None

    if cos_sprint:
        # Get or create Convex sprint record for storing updates
        cvx_sprint = convex_db.get_active_sprint()
        if cvx_sprint:
            sprint_id = cvx_sprint.get("_id")
        else:
            # Create sprint in Convex from CoS data
            sprint_id = convex_db.create_sprint({
                "name": cos_sprint.get("name", ""),
                "start_date": cos_sprint.get("start", cos_sprint.get("start_date", "")),
                "end_date": cos_sprint.get("end", cos_sprint.get("end_date", "")),
                "goals": cos_sprint.get("goals", []),
                "status": "active",
                "created_at": datetime.utcnow().isoformat(),
            })
    else:
        cvx_sprint = convex_db.get_active_sprint()
        if cvx_sprint:
            sprint_id = cvx_sprint.get("_id")

    if not sprint_id:
        return {"error": "No active sprint", "created": 0}

    today = date.today()
    week_num = today.isocalendar()[1]
    year = today.year
    week_label = f"W{week_num}-{year}"

    monday = today - timedelta(days=today.weekday())
    weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

    # Check who already has updates this week
    existing_updates = convex_db.list_sprint_updates(sprint_id=sprint_id, week_label=week_label) or []
    existing_persons = {u.get("person") for u in existing_updates}

    roster = convex_db.list_team_members() or []
    mood_values = {"great": 5, "good": 4, "neutral": 3, "struggling": 2, "blocked": 1}
    mood_names = {5: "great", 4: "good", 3: "neutral", 2: "struggling", 1: "blocked"}

    created = []
    skipped = []

    for member in roster:
        slug = member.get("slug")
        if not slug or slug in existing_persons:
            if slug in existing_persons:
                skipped.append(slug)
            continue

        # Aggregate standups for this week (Mon-Fri)
        accomplished_parts = []
        latest_blockers = None
        latest_doing = None
        moods = []

        for day_offset in range(min(5, (today - monday).days + 1)):
            day_date = (monday + timedelta(days=day_offset)).strftime("%Y-%m-%d")
            standup = standup_local.get_standup(slug, day_date)
            if not standup:
                continue

            day_label = weekdays[day_offset]
            done = standup.get("done", "").strip()
            if done:
                accomplished_parts.append(f"{day_label}: {done}")

            doing = standup.get("doing", "").strip()
            if doing:
                latest_doing = doing

            blockers = standup.get("blockers")
            if blockers and blockers.strip() and blockers.strip().lower() not in ("none", "n/a", ""):
                latest_blockers = blockers.strip()

            mood = standup.get("mood", "neutral")
            moods.append(mood_values.get(mood, 3))

        if not accomplished_parts:
            continue

        accomplished = "\n".join(accomplished_parts)
        avg_mood = round(sum(moods) / len(moods)) if moods else 3
        mood_str = mood_names.get(avg_mood, "neutral")

        update_data = {
            "sprint_id": sprint_id,
            "person": slug,
            "week_label": week_label,
            "accomplished": accomplished,
            "mood": mood_str,
            "created_at": datetime.utcnow().isoformat(),
        }
        if latest_blockers:
            update_data["blockers"] = latest_blockers
        if latest_doing:
            update_data["plan_next_week"] = latest_doing

        convex_db.insert_sprint_update(update_data)
        created.append(slug)

    return {
        "status": "generated",
        "week": week_label,
        "created": len(created),
        "created_for": created,
        "skipped": len(skipped),
        "skipped_persons": skipped,
    }


@router.post("")
def create_sprint(data: SprintCreate):
    now = datetime.utcnow().isoformat()

    sprint_data = {
        "name": data.name,
        "start_date": str(data.start_date),
        "end_date": str(data.end_date),
        "status": "active",
        "created_at": now,
    }
    if data.goals:
        sprint_data["goals"] = data.goals

    sprint_id = convex_db.create_sprint(sprint_data)

    return {
        "id": 1,
        "name": data.name,
        "start_date": str(data.start_date),
        "end_date": str(data.end_date),
        "goals": data.goals or [],
        "status": "active",
        "created_at": now,
        "_id": sprint_id,
    }


# --- Weekly Updates ---

@router.get("/updates")
def list_sprint_updates(week: str = None, person: str = None):
    sprint = convex_db.get_active_sprint()
    if not sprint:
        return []
    sprint_id = sprint.get("_id")
    updates = convex_db.list_sprint_updates(sprint_id=sprint_id, week_label=week, person=person) or []

    # Resolve names
    members = convex_db.list_team_members() or []
    member_map = {m.get("slug"): m for m in members}

    return [
        {
            "id": u.get("_id", ""),
            "person": u.get("person", ""),
            "name": member_map.get(u.get("person"), {}).get("name", u.get("person", "")),
            "week_label": u.get("week_label"),
            "accomplished": u.get("accomplished", ""),
            "blockers": u.get("blockers"),
            "plan_next_week": u.get("plan_next_week"),
            "mood": u.get("mood"),
            "notified_slack": u.get("notified_slack", False),
            "notified_email": u.get("notified_email", False),
            "created_at": u.get("created_at"),
        }
        for u in updates
    ]


@router.post("/updates")
def create_sprint_update(data: SprintUpdateCreate):
    sprint = convex_db.get_active_sprint()
    if not sprint:
        return {"error": "No active sprint"}

    week_label = data.week_label
    if not week_label:
        today = date.today()
        week_label = f"W{today.isocalendar()[1]}-{today.year}"

    update_data = {
        "sprint_id": sprint["_id"],
        "person": data.person,
        "week_label": week_label,
        "accomplished": data.accomplished,
        "mood": data.mood or "neutral",
        "created_at": datetime.utcnow().isoformat(),
    }
    if data.blockers:
        update_data["blockers"] = data.blockers
    if data.plan_next_week:
        update_data["plan_next_week"] = data.plan_next_week

    update_id = convex_db.insert_sprint_update(update_data)

    return {
        "id": update_id,
        "person": data.person,
        "week_label": week_label,
        "accomplished": data.accomplished,
        "blockers": data.blockers,
        "plan_next_week": data.plan_next_week,
        "mood": data.mood or "neutral",
        "created_at": update_data["created_at"],
    }


@router.get("/updates/by-week")
def get_updates_grouped_by_week():
    sprint = convex_db.get_active_sprint()
    if not sprint:
        return {"weeks": []}

    updates = convex_db.list_sprint_updates(sprint_id=sprint["_id"]) or []
    members = convex_db.list_team_members() or []
    member_map = {m.get("slug"): m for m in members}

    weeks: dict = {}
    for u in updates:
        wk = u.get("week_label") or "unknown"
        if wk not in weeks:
            weeks[wk] = []
        slug = u.get("person", "")
        m = member_map.get(slug, {})
        weeks[wk].append({
            "id": u.get("_id", ""),
            "person": slug,
            "name": m.get("name", slug),
            "emoji": m.get("emoji", ""),
            "role": m.get("role", ""),
            "accomplished": u.get("accomplished", ""),
            "blockers": u.get("blockers"),
            "plan_next_week": u.get("plan_next_week"),
            "mood": u.get("mood"),
            "notified_slack": u.get("notified_slack", False),
            "notified_email": u.get("notified_email", False),
            "created_at": u.get("created_at"),
        })

    return {"weeks": [{"week": wk, "updates": items} for wk, items in weeks.items()]}


# --- Auto-send notifications ---

@router.post("/updates/send")
def send_sprint_updates(req: SendUpdatesRequest, background_tasks: BackgroundTasks):
    """Send all updates for a given week (or latest) via Slack and/or email."""
    sprint = convex_db.get_active_sprint()
    if not sprint:
        return {"error": "No active sprint"}

    updates = convex_db.list_sprint_updates(sprint_id=sprint["_id"]) or []

    if req.week_label:
        updates = [u for u in updates if u.get("week_label") == req.week_label]
    elif updates:
        # Get latest week
        latest_week = updates[-1].get("week_label")
        updates = [u for u in updates if u.get("week_label") == latest_week]

    if not updates:
        return {"error": "No updates found to send", "sent": 0}

    update_ids = [u["_id"] for u in updates]
    background_tasks.add_task(_do_send_updates, update_ids, req.channel)

    return {
        "status": "sending",
        "channel": req.channel,
        "update_count": len(update_ids),
        "week": updates[0].get("week_label"),
        "message": f"Sending {len(update_ids)} updates via {req.channel}",
    }


@router.get("/updates/notifications")
def get_notification_history():
    """Get notification send history."""
    logs = convex_db.list_notifications(50) or []
    return [
        {
            "id": l.get("_id", ""),
            "channel": l.get("channel", ""),
            "recipient": l.get("recipient", ""),
            "status": l.get("status", ""),
            "sent_at": l.get("sent_at"),
        }
        for l in logs
    ]
