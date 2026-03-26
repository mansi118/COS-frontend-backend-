from fastapi import APIRouter, Query
from schemas import FollowupCreate, FollowupUpdate
from datetime import date, datetime
import standup_fanout
import convex_db

router = APIRouter(prefix="/api/followups", tags=["followups"])

# Lazy-loaded roster for name resolution
_roster_cache = None

def _get_roster_map():
    global _roster_cache
    if _roster_cache is None:
        members = convex_db.list_team_members() or []
        _roster_cache = {m.get("slug"): m for m in members}
    return _roster_cache


def _to_api(fu: dict, idx: int = 0) -> dict:
    """Normalize Convex follow-up to API response shape."""
    who = fu.get("who")
    roster = _get_roster_map()
    who_name = roster.get(who, {}).get("name", who) if who else None
    return {
        "id": idx,
        "fu_id": fu.get("fu_id", fu.get("id", "")),
        "what": fu.get("what", ""),
        "who": who,
        "who_name": who_name,
        "due": fu.get("due"),
        "priority": fu.get("priority"),
        "status": fu.get("status", "open"),
        "source": fu.get("source"),
        "source_id": fu.get("source_id"),
        "notes": fu.get("notes"),
        "checklist": fu.get("checklist", fu.get("checklist_items")),
        "created_at": fu.get("created_at", fu.get("created")),
        "updated_at": fu.get("updated_at", fu.get("updated")),
        "resolved_at": fu.get("resolved_at"),
    }


@router.get("")
def list_followups(
    status: str = Query(None),
    who: str = Query(None),
    priority: str = Query(None),
    source: str = Query(None),
):
    fus = convex_db.list_followups(status=status, who=who, priority=priority, source=source) or []
    fus.sort(key=lambda f: f.get("created_at", ""), reverse=True)
    return [_to_api(f, i + 1) for i, f in enumerate(fus)]


@router.post("")
def create_followup(data: FollowupCreate):
    num = convex_db.increment_counter("followup")
    if not num:
        num = 1
    fu_id = f"FU-{int(num):04d}"
    now = datetime.utcnow().isoformat()

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

    return _to_api({**cvx_data, "id": fu_id}, 1)


@router.put("/{fu_id}/checklist/{item_index}/toggle")
def toggle_checklist_item(fu_id: str, item_index: int):
    """Toggle a checklist item. Auto-resolves if all done, un-resolves if unchecked."""
    return standup_fanout.confirm_checklist_resolution(fu_id, item_index)


@router.put("/{fu_id}")
def update_followup(fu_id: str, data: FollowupUpdate):
    now = datetime.utcnow().isoformat()
    updates = data.model_dump(exclude_unset=True)

    # Convert date objects to strings
    cvx_updates = {}
    for key, val in updates.items():
        if isinstance(val, date):
            cvx_updates[key] = str(val)
        elif val is not None:
            cvx_updates[key] = val
    cvx_updates["updated_at"] = now

    convex_db.update_followup(fu_id, cvx_updates)

    # Return updated
    fu = convex_db.get_followup(fu_id)
    if fu:
        return _to_api(fu)
    return {"updated": True, "fu_id": fu_id}


@router.put("/{fu_id}/resolve")
def resolve_followup(fu_id: str):
    now = datetime.utcnow().isoformat()
    convex_db.update_followup(fu_id, {"status": "resolved", "resolved_at": now, "updated_at": now})
    fu = convex_db.get_followup(fu_id)
    if fu:
        return _to_api(fu)
    return {"resolved": True, "fu_id": fu_id}


@router.delete("/{fu_id}")
def delete_followup(fu_id: str):
    convex_db.delete_followup(fu_id)
    return {"deleted": True, "fu_id": fu_id}


@router.get("/remind")
def get_reminders():
    today = str(date.today())
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
