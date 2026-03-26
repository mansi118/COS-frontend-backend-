from fastapi import APIRouter, Query
from schemas import FollowupCreate, FollowupUpdate, FollowupOut
from datetime import date, datetime
import os
import cos_reader
import standup_fanout
import convex_db

router = APIRouter(prefix="/api/followups", tags=["followups"])

# Resolve slugs to full names
_roster = cos_reader.get_team_roster() or []
_roster_map = {r["slug"]: r for r in _roster}


def _cos_to_api(fu: dict, idx: int = 0) -> dict:
    """Convert CoS JSON follow-up to API response shape."""
    who = fu.get("who")
    who_name = _roster_map.get(who, {}).get("name", who) if who else None
    return {
        "id": idx,
        "fu_id": fu.get("id", ""),
        "what": fu.get("what", ""),
        "who": who,
        "who_name": who_name,
        "due": fu.get("due"),
        "priority": fu.get("priority"),
        "status": fu.get("status", "open"),
        "source": fu.get("source"),
        "source_id": fu.get("source_id"),
        "notes": fu.get("notes"),
        "checklist": fu.get("checklist_items"),
        "created_at": fu.get("created"),
        "updated_at": fu.get("updated"),
        "resolved_at": fu.get("resolved_at"),
    }


@router.get("")
def list_followups(
    status: str = Query(None),
    who: str = Query(None),
    priority: str = Query(None),
    source: str = Query(None),
):
    # Primary: read from CoS workspace
    cos_fus = cos_reader.get_all_followups()
    if cos_fus:
        results = cos_fus
        if status:
            results = [f for f in results if f.get("status") == status]
        if who:
            results = [f for f in results if f.get("who") == who]
        if priority:
            results = [f for f in results if f.get("priority") == priority]
        if source:
            results = [f for f in results if f.get("source") == source]
        results.sort(key=lambda f: f.get("created", ""), reverse=True)
        return [_cos_to_api(f, i + 1) for i, f in enumerate(results)]

    # Fallback to Convex
    result = convex_db.list_followups(status=status, who=who, priority=priority, source=source)
    if result:
        return result
    return []


@router.post("")
def create_followup(data: FollowupCreate):
    next_num = cos_reader.increment_followup_counter()
    fu_id = f"FU-{next_num:04d}"
    now = datetime.utcnow().isoformat()

    cos_data = {
        "id": fu_id,
        "what": data.what,
        "who": data.who,
        "due": str(data.due) if data.due else None,
        "source": data.source,
        "source_id": data.source_id,
        "priority": data.priority or "P2",
        "status": "open",
        "notes": data.notes or "",
        "checklist_items": data.checklist,
        "created": now,
        "updated": now,
        "resolved_at": None,
        "reminders_sent": 0,
        "events": [{"timestamp": now, "action": "created", "actor": "dashboard"}],
    }
    cos_reader.write_followup(fu_id, cos_data)

    # Also write to Convex (strip None values — Convex rejects null for optional fields)
    cvx_data = {
        "fu_id": fu_id,
        "what": data.what,
        "who": data.who,
        "priority": data.priority or "P2",
        "status": "open",
        "created_at": now,
        "updated_at": now,
    }
    if data.due:
        cvx_data["due"] = str(data.due)
    if data.source:
        cvx_data["source"] = data.source
    if data.source_id:
        cvx_data["source_id"] = data.source_id
    if data.notes:
        cvx_data["notes"] = data.notes
    if data.checklist:
        cvx_data["checklist"] = data.checklist
    convex_db.insert_followup(cvx_data)

    return _cos_to_api(cos_data, 1)


@router.put("/{fu_id}/checklist/{item_index}/toggle")
def toggle_checklist_item(fu_id: str, item_index: int):
    """Toggle a checklist item. Auto-resolves if all done, un-resolves if unchecked."""
    return standup_fanout.confirm_checklist_resolution(fu_id, item_index)


@router.put("/{fu_id}")
def update_followup(fu_id: str, data: FollowupUpdate):
    now = datetime.utcnow().isoformat()
    updates = data.model_dump(exclude_unset=True)

    cos_fu = cos_reader.get_followup(fu_id)
    if cos_fu:
        for key, val in updates.items():
            if key == "due" and val is not None:
                cos_fu[key] = str(val)
            else:
                cos_fu[key] = val
        cos_fu["updated"] = now
        cos_fu.setdefault("events", []).append(
            {"timestamp": now, "action": "updated", "actor": "dashboard"}
        )
        cos_reader.write_followup(fu_id, cos_fu)

        # Also update Convex
        convex_db.update_followup(fu_id, {k: str(v) if isinstance(v, date) else v for k, v in updates.items()})

        return _cos_to_api(cos_fu)

    # Fallback: try Convex
    convex_db.update_followup(fu_id, updates)
    return {"updated": True, "fu_id": fu_id}


@router.put("/{fu_id}/resolve")
def resolve_followup(fu_id: str):
    now = datetime.utcnow().isoformat()

    cos_fu = cos_reader.get_followup(fu_id)
    if cos_fu:
        cos_fu["status"] = "resolved"
        cos_fu["resolved_at"] = now
        cos_fu["updated"] = now
        cos_fu.setdefault("events", []).append(
            {"timestamp": now, "action": "resolved", "actor": "dashboard"}
        )
        cos_reader.write_followup(fu_id, cos_fu)

        convex_db.update_followup(fu_id, {"status": "resolved", "resolved_at": now, "updated_at": now})

        return _cos_to_api(cos_fu)

    # Fallback: try Convex
    convex_db.update_followup(fu_id, {"status": "resolved", "resolved_at": now})
    return {"resolved": True, "fu_id": fu_id}


@router.delete("/{fu_id}")
def delete_followup(fu_id: str):
    """Delete a follow-up permanently from CoS JSON and Convex."""
    cos_path = os.path.join(
        os.getenv("COS_WORKSPACE", os.path.expanduser("~/.openclaw/workspace")),
        "data", "follow-ups", f"{fu_id}.json"
    )
    if os.path.exists(cos_path):
        os.remove(cos_path)

    convex_db.delete_followup(fu_id)

    return {"deleted": True, "fu_id": fu_id}


@router.get("/remind")
def get_reminders():
    today = str(date.today())

    cos_fus = cos_reader.get_all_followups()
    if cos_fus:
        active = [f for f in cos_fus if f.get("status") in ("open", "in_progress")]
        overdue = [f for f in active if f.get("due") and f["due"] < today]
        due_today = [f for f in active if f.get("due") == today]
        return {
            "overdue": [{"fu_id": f.get("id"), "what": f.get("what"), "who": f.get("who"), "due": f.get("due")} for f in overdue],
            "due_today": [{"fu_id": f.get("id"), "what": f.get("what"), "who": f.get("who")} for f in due_today],
            "overdue_count": len(overdue),
            "due_today_count": len(due_today),
        }

    # Fallback to Convex
    fus = convex_db.list_followups() or []
    active = [f for f in fus if f.get("status") in ("open", "in_progress")]
    overdue = [f for f in active if f.get("due") and f["due"] < today]
    due_today = [f for f in active if f.get("due") == today]
    return {
        "overdue": [{"fu_id": f.get("fu_id"), "what": f.get("what"), "who": f.get("who"), "due": f.get("due")} for f in overdue],
        "due_today": [{"fu_id": f.get("fu_id"), "what": f.get("what"), "who": f.get("who")} for f in due_today],
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
    }
