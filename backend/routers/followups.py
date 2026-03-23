from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
from models import Followup
from schemas import FollowupCreate, FollowupUpdate, FollowupOut
from datetime import date, datetime
import cos_reader
import standup_fanout

router = APIRouter(prefix="/api/followups", tags=["followups"])


def _cos_to_api(fu: dict, idx: int = 0) -> dict:
    """Convert CoS JSON follow-up to API response shape matching FollowupOut."""
    return {
        "id": idx,
        "fu_id": fu.get("id", ""),
        "what": fu.get("what", ""),
        "who": fu.get("who"),
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
    db: Session = Depends(get_db),
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
        # Sort by created desc
        results.sort(key=lambda f: f.get("created", ""), reverse=True)
        return [_cos_to_api(f, i + 1) for i, f in enumerate(results)]

    # Fallback to DB
    q = db.query(Followup)
    if status:
        q = q.filter(Followup.status == status)
    if who:
        q = q.filter(Followup.who == who)
    if priority:
        q = q.filter(Followup.priority == priority)
    return q.order_by(Followup.created_at.desc()).all()


@router.post("")
def create_followup(data: FollowupCreate, db: Session = Depends(get_db)):
    # Generate ID from CoS counter
    next_num = cos_reader.increment_followup_counter()
    fu_id = f"FU-{next_num:04d}"
    now = datetime.utcnow().isoformat()

    # Write to CoS workspace JSON
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
        "events": [
            {"timestamp": now, "action": "created", "actor": "dashboard"}
        ],
    }
    cos_reader.write_followup(fu_id, cos_data)

    # Also write to DB
    fu = Followup(
        fu_id=fu_id,
        what=data.what,
        who=data.who,
        due=data.due,
        priority=data.priority or "P2",
        status="open",
        source=data.source,
        source_id=data.source_id,
        notes=data.notes,
        checklist=data.checklist,
    )
    db.add(fu)
    db.commit()
    db.refresh(fu)
    return fu


@router.put("/{fu_id}/checklist/{item_index}/toggle")
def toggle_checklist_item(fu_id: str, item_index: int, db: Session = Depends(get_db)):
    """Toggle a checklist item (check ↔ uncheck). Auto-resolves if all done, un-resolves if unchecked."""
    return standup_fanout.confirm_checklist_resolution(fu_id, item_index, db)


@router.put("/{fu_id}")
def update_followup(fu_id: str, data: FollowupUpdate, db: Session = Depends(get_db)):
    now = datetime.utcnow().isoformat()
    updates = data.model_dump(exclude_unset=True)

    # Update CoS workspace JSON
    # Try fu_id as CoS ID first (e.g. FU-0001), then as DB int id
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
        return _cos_to_api(cos_fu)

    # Try as DB integer id
    try:
        db_id = int(fu_id)
    except ValueError:
        return {"error": "Not found"}

    fu = db.query(Followup).filter(Followup.id == db_id).first()
    if not fu:
        return {"error": "Not found"}
    for key, val in updates.items():
        setattr(fu, key, val)
    fu.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(fu)
    return fu


@router.put("/{fu_id}/resolve")
def resolve_followup(fu_id: str, db: Session = Depends(get_db)):
    now = datetime.utcnow().isoformat()

    # Update CoS workspace JSON
    cos_fu = cos_reader.get_followup(fu_id)
    if cos_fu:
        cos_fu["status"] = "resolved"
        cos_fu["resolved_at"] = now
        cos_fu["updated"] = now
        cos_fu.setdefault("events", []).append(
            {"timestamp": now, "action": "resolved", "actor": "dashboard"}
        )
        cos_reader.write_followup(fu_id, cos_fu)
        return _cos_to_api(cos_fu)

    # Try as DB integer id
    try:
        db_id = int(fu_id)
    except ValueError:
        return {"error": "Not found"}

    fu = db.query(Followup).filter(Followup.id == db_id).first()
    if not fu:
        return {"error": "Not found"}
    fu.status = "resolved"
    fu.resolved_at = datetime.utcnow()
    fu.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(fu)
    return fu


@router.get("/remind")
def get_reminders(db: Session = Depends(get_db)):
    today = str(date.today())

    # Primary: CoS workspace
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

    # Fallback to DB
    today_date = date.today()
    overdue = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"]),
        Followup.due < today_date,
    ).all()
    due_today = db.query(Followup).filter(
        Followup.status.in_(["open", "in_progress"]),
        Followup.due == today_date,
    ).all()
    return {
        "overdue": [{"fu_id": f.fu_id, "what": f.what, "who": f.who, "due": str(f.due)} for f in overdue],
        "due_today": [{"fu_id": f.fu_id, "what": f.what, "who": f.who} for f in due_today],
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
    }
