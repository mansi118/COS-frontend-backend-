"""Daily standup updates — post, view, stats, reminders."""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional
import standup_local
import cos_reader

router = APIRouter(prefix="/api/standups", tags=["standups"])


class StandupPost(BaseModel):
    person: str
    done: str
    doing: Optional[str] = ""
    blockers: Optional[str] = None
    mood: Optional[str] = "neutral"
    linked_tasks: Optional[list[str]] = None


class StandupUpdate(BaseModel):
    done: Optional[str] = None
    doing: Optional[str] = None
    blockers: Optional[str] = None
    mood: Optional[str] = None
    linked_tasks: Optional[list[str]] = None


@router.post("")
def post_standup(data: StandupPost):
    standup = standup_local.post_standup(data.person, data.model_dump())
    return {"standup": standup}


@router.put("/{person}")
def update_standup(person: str, data: StandupUpdate):
    standup = standup_local.update_standup(person, data.model_dump(exclude_unset=True))
    if not standup:
        return {"error": "No standup found for today. Post one first."}
    return {"standup": standup}


@router.get("/today")
def get_today():
    return {"standups": standup_local.get_today_standups(), "date": standup_local._today_ist()}


@router.get("/summary")
def get_summary():
    return standup_local.get_standup_summary()


@router.get("/stats")
def get_stats(date: str = Query(None)):
    return standup_local.get_standup_stats(date)


@router.get("/person/{slug}")
def get_person_history(slug: str, days: int = Query(14)):
    history = standup_local.get_person_history(slug, days)
    return {"person": slug, "history": history, "count": len(history)}


@router.get("/{date_str}")
def get_by_date(date_str: str):
    return {"standups": standup_local.get_standups_by_date(date_str), "date": date_str}


@router.post("/remind")
def send_reminders():
    """Send standup reminders to missing members via Slack DM."""
    stats = standup_local.get_standup_stats()
    missing = stats.get("missing", [])

    if stats.get("is_weekend"):
        return {"status": "skipped", "reason": "weekend"}
    if not missing:
        return {"status": "all_posted", "missing": 0}

    results = []
    try:
        from routers.slack import _slack_api, _resolve_user
        for person in missing:
            user_id = _resolve_user(person)
            if user_id:
                r = _slack_api("chat.postMessage", {
                    "channel": user_id,
                    "text": f"Hey {person} 👋 You haven't posted your daily standup yet. Head to the PULSE dashboard → Updates page to post yours!"
                })
                results.append({"person": person, "sent": r.get("ok", False), "channel": "slack"})
            else:
                results.append({"person": person, "sent": False, "reason": "no slack_id"})
    except Exception as e:
        return {"status": "error", "error": str(e)}

    # Also try WhatsApp for those with phone numbers
    try:
        from routers.whatsapp import _send_whatsapp
        routes = cos_reader.get_notification_routes() or {}
        contacts = routes.get("contacts", {})
        for person in missing:
            phone = contacts.get(person, {}).get("whatsapp") or contacts.get(person, {}).get("phone")
            if phone:
                r = _send_whatsapp(phone, f"Hey {person} 👋 Daily standup reminder — please post your update!")
                results.append({"person": person, "sent": r.get("success", False), "channel": "whatsapp"})
    except Exception:
        pass

    sent = sum(1 for r in results if r.get("sent"))
    return {"status": "sent", "reminders_sent": sent, "missing_count": len(missing), "results": results}
