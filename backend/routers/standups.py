"""Daily standup updates — post, view, stats, reminders."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
import standup_local
import standup_fanout
import cos_reader
from database import get_db

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
def post_standup(data: StandupPost, db: Session = Depends(get_db)):
    standup = standup_local.post_standup(data.person, data.model_dump())

    # Fanout: create follow-up + task from doing items
    fu_id = standup_fanout.create_followup_from_standup(
        data.person, standup["date"], data.doing or "", data.blockers, db
    )
    task_id = standup_fanout.create_task_from_standup(
        data.person, standup["date"], data.doing or ""
    )

    # Suggest resolutions from done items
    suggestions = standup_fanout.suggest_resolutions(data.person, data.done, db)

    # Link created FU/task IDs back to standup
    linked = [x for x in [fu_id, task_id] if x]
    if linked:
        standup_local.update_standup(data.person, {"linked_tasks": linked})
        standup["linked_tasks"] = linked

    return {
        "standup": standup,
        "linked_followup": fu_id,
        "linked_task": task_id,
        "suggested_resolutions": suggestions,
    }


@router.put("/{person}")
def update_standup(person: str, data: StandupUpdate):
    standup = standup_local.update_standup(person, data.model_dump(exclude_unset=True))
    if not standup:
        return {"error": "No standup found for today. Post one first."}
    return {"standup": standup}


@router.get("/suggestions/{person}")
def get_suggestions(person: str, db: Session = Depends(get_db)):
    """Get pending resolution suggestions for a person's latest done text."""
    standup = standup_local.get_standup(person)
    if not standup:
        return {"suggestions": []}
    return {"suggestions": standup_fanout.suggest_resolutions(person, standup.get("done", ""), db)}


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


class PriorityUpdate(BaseModel):
    priorities: dict  # {0: "P1", 1: "P0", 2: "P3"}


@router.put("/{person}/priorities")
def update_priorities(person: str, data: PriorityUpdate, db: Session = Depends(get_db)):
    """Update priorities of doing items in linked follow-up and task."""
    standup = standup_local.get_standup(person)
    if not standup:
        return {"error": "No standup found for today"}

    linked = standup.get("linked_tasks") or []
    results = {"updated_fus": [], "updated_tasks": []}

    for item_id in linked:
        if item_id.startswith("FU-"):
            fu = cos_reader.get_followup(item_id)
            if fu and fu.get("checklist_items"):
                for idx_str, priority in data.priorities.items():
                    idx = int(idx_str)
                    if 0 <= idx < len(fu["checklist_items"]):
                        fu["checklist_items"][idx]["priority"] = priority
                fu["priority"] = standup_fanout._highest_priority(
                    [{"priority": ci["priority"]} for ci in fu["checklist_items"]]
                )
                fu["updated"] = standup_fanout.datetime.utcnow().isoformat()
                cos_reader.write_followup(item_id, fu)
                results["updated_fus"].append(item_id)

    # Store priorities in standup
    standup_local.update_standup(person, {"doing_priorities": data.priorities})

    return results


class ResolveSuggestion(BaseModel):
    fu_id: str
    item_index: int  # -1 to resolve whole FU


@router.post("/resolve-suggestion")
def confirm_resolution(data: ResolveSuggestion, db: Session = Depends(get_db)):
    """Confirm a suggested resolution — mark checklist item or whole FU as resolved."""
    return standup_fanout.confirm_checklist_resolution(data.fu_id, data.item_index, db)


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
