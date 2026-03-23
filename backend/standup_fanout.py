"""Standup Fanout — auto-create follow-ups and tasks from standup doing items,
suggest resolutions from done items, and create follow-ups from meeting action items."""

import re
import difflib
from datetime import datetime, timedelta
from typing import Optional

import cos_reader
import taskflow_local


# --- Priority keyword mapping ---

PRIORITY_KEYWORDS = {
    "P0": ["blocker", "blocked", "urgent", "critical", "emergency", "asap"],
    "P1": ["bug", "hotfix", "fix", "broken", "crash", "incident"],
    "P2": ["review", "pr", "approve", "feature", "build", "implement", "ship", "deploy"],
    "P3": ["research", "explore", "investigate", "spike", "prototype", "learn", "read"],
}


def _classify_priority(text: str) -> str:
    lower = text.lower()
    for priority, keywords in PRIORITY_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return priority
    return "P2"


def _highest_priority(items: list[dict]) -> str:
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    best = "P3"
    for item in items:
        p = item.get("priority", "P2")
        if order.get(p, 3) < order.get(best, 3):
            best = p
    return best


# --- Text parsing ---

def parse_doing_items(doing: str) -> list[dict]:
    """Split doing text into individual items with auto-classified priority."""
    if not doing or not doing.strip():
        return []

    lines = doing.strip().split("\n")
    items = []
    for line in lines:
        cleaned = re.sub(r"^[\s\-\*•\d\.]+", "", line).strip()
        if not cleaned or cleaned.lower() in ("none", "nothing", "n/a", "nothing specified"):
            continue
        items.append({"text": cleaned, "priority": _classify_priority(cleaned)})

    # If only one line with no newlines, try splitting on ". " (sentence boundaries)
    if len(items) <= 1 and items:
        text = items[0]["text"]
        sentences = [s.strip() for s in re.split(r"\.\s+", text) if s.strip()]
        if len(sentences) > 1:
            items = [{"text": s.rstrip("."), "priority": _classify_priority(s)} for s in sentences]

    return items


def _parse_done_items(done: str) -> list[str]:
    """Split done text into individual lines."""
    if not done or not done.strip():
        return []
    lines = done.strip().split("\n")
    items = []
    for line in lines:
        cleaned = re.sub(r"^[\s\-\*•\d\.]+", "", line).strip()
        if cleaned and cleaned.lower() not in ("none", "nothing", "n/a"):
            items.append(cleaned)
    # Also try sentence splitting for single-line input
    if len(items) == 1:
        sentences = [s.strip() for s in re.split(r"\.\s+", items[0]) if s.strip()]
        if len(sentences) > 1:
            items = [s.rstrip(".") for s in sentences]
    return items


# --- Follow-up creation ---

def create_followup_from_standup(
    person: str, date_str: str, doing: str, blockers: Optional[str], db
) -> Optional[str]:
    """Create ONE follow-up with checklist from standup doing items.
    Returns FU ID or None. Idempotent — skips if already exists for this person/date."""

    source_id = f"{person}/{date_str}"

    # Idempotency: check if FU already exists for this standup
    existing_fus = cos_reader.get_all_followups()
    for fu in existing_fus:
        if fu.get("source_id") == source_id and fu.get("source") == "standup":
            return fu.get("id")

    items = parse_doing_items(doing)
    if not items:
        return None

    # Add blocker as P0 checklist item
    if blockers and blockers.strip() and blockers.strip().lower() not in ("none", "n/a", ""):
        items.append({"text": f"BLOCKER: {blockers.strip()}", "priority": "P0"})

    checklist = [
        {"text": item["text"], "priority": item["priority"], "completed": False}
        for item in items
    ]

    name = cos_reader.get_team_roster()
    person_name = person
    if name:
        for r in name:
            if r.get("slug") == person:
                person_name = r.get("name", person)
                break

    fu_id_num = cos_reader.increment_followup_counter()
    fu_id = f"FU-{fu_id_num:04d}"
    now = datetime.utcnow().isoformat()

    cos_data = {
        "id": fu_id,
        "what": f"Daily commitments — {person_name}",
        "who": person,
        "due": date_str,
        "source": "standup",
        "source_id": source_id,
        "priority": _highest_priority(items),
        "status": "open",
        "notes": f"Auto-created from standup on {date_str}",
        "checklist_items": checklist,
        "created": now,
        "updated": now,
        "resolved_at": None,
        "reminders_sent": 0,
        "events": [{"timestamp": now, "action": "created", "actor": "standup-fanout"}],
    }
    cos_reader.write_followup(fu_id, cos_data)

    # Also write to DB if session available
    try:
        from models import Followup as FollowupModel
        from datetime import date as date_type

        fu_db = FollowupModel(
            fu_id=fu_id,
            what=f"Daily commitments — {person_name}",
            who=person,
            due=date_type.fromisoformat(date_str),
            priority=_highest_priority(items),
            status="open",
            source="standup",
            source_id=source_id,
            notes=f"Auto-created from standup on {date_str}",
            checklist=checklist,
        )
        db.add(fu_db)
        db.commit()
    except Exception:
        pass  # DB write is best-effort; CoS JSON is source of truth

    return fu_id


# --- Task creation ---

def create_task_from_standup(person: str, date_str: str, doing: str) -> Optional[str]:
    """Create ONE task with checklist from standup doing items.
    Returns task ID or None. Idempotent."""

    tag_key = f"standup-{person}-{date_str}"

    # Idempotency: check if task already exists
    existing = taskflow_local.list_tasks(view="today")
    for t in existing:
        if tag_key in (t.get("tags") or []):
            return t.get("id")

    items = parse_doing_items(doing)
    if not items:
        return None

    checklist = [{"title": item["text"], "is_completed": False} for item in items]

    task = taskflow_local.create_task({
        "title": f"Standup commitments — {person}",
        "owner": person,
        "source": "standup",
        "when_date": date_str,
        "priority_hint": _highest_priority(items),
        "tags": ["standup", date_str, tag_key],
        "checklist_items": checklist,
    })

    return task.get("id") if task else None


# --- Resolution suggestions ---

def suggest_resolutions(person: str, done: str, db=None) -> list[dict]:
    """Fuzzy-match done items against open follow-ups to suggest resolutions."""
    done_items = _parse_done_items(done)
    if not done_items:
        return []

    # Get all open follow-ups for this person
    all_fus = cos_reader.get_all_followups()
    open_fus = [
        f for f in all_fus
        if f.get("who") == person and f.get("status") in ("open", "in_progress")
    ]

    suggestions = []
    for done_text in done_items:
        for fu in open_fus:
            # Match against main "what" text
            score = difflib.SequenceMatcher(
                None, done_text.lower(), fu.get("what", "").lower()
            ).ratio()
            if score > 0.5:
                suggestions.append({
                    "fu_id": fu.get("id"),
                    "fu_what": fu.get("what"),
                    "matched_item": fu.get("what"),
                    "done_text": done_text,
                    "match_score": round(score, 2),
                    "item_index": -1,
                })

            # Match against checklist items
            for idx, ci in enumerate(fu.get("checklist_items") or []):
                if ci.get("completed"):
                    continue
                ci_score = difflib.SequenceMatcher(
                    None, done_text.lower(), ci.get("text", "").lower()
                ).ratio()
                if ci_score > 0.5:
                    suggestions.append({
                        "fu_id": fu.get("id"),
                        "fu_what": fu.get("what"),
                        "matched_item": ci.get("text"),
                        "done_text": done_text,
                        "match_score": round(ci_score, 2),
                        "item_index": idx,
                    })

    # Deduplicate: keep highest score per fu_id+item_index pair
    seen = {}
    for s in suggestions:
        key = (s["fu_id"], s["item_index"])
        if key not in seen or s["match_score"] > seen[key]["match_score"]:
            seen[key] = s

    result = sorted(seen.values(), key=lambda x: x["match_score"], reverse=True)
    return result[:10]  # Cap at 10 suggestions


# --- Meeting MOM extraction ---

def create_followups_from_meeting(
    transcript_id: str, action_items: list[str], title: str, meeting_date: str, db
) -> Optional[str]:
    """Create ONE follow-up with checklist from meeting action items.
    Returns FU ID or None. Idempotent."""

    # Idempotency
    existing_fus = cos_reader.get_all_followups()
    for fu in existing_fus:
        if fu.get("source_id") == transcript_id and fu.get("source") == "meeting":
            return fu.get("id")

    if not action_items:
        return None

    checklist = [
        {"text": item.strip(), "priority": _classify_priority(item), "completed": False}
        for item in action_items if item.strip()
    ]

    if not checklist:
        return None

    fu_id_num = cos_reader.increment_followup_counter()
    fu_id = f"FU-{fu_id_num:04d}"
    now = datetime.utcnow().isoformat()
    due = (datetime.utcnow() + timedelta(days=3)).strftime("%Y-%m-%d")

    cos_data = {
        "id": fu_id,
        "what": f"Meeting action items — {title}",
        "who": None,
        "due": due,
        "source": "meeting",
        "source_id": transcript_id,
        "priority": _highest_priority(checklist),
        "status": "open",
        "notes": f"Auto-extracted from meeting on {meeting_date}",
        "checklist_items": checklist,
        "created": now,
        "updated": now,
        "resolved_at": None,
        "reminders_sent": 0,
        "events": [{"timestamp": now, "action": "created", "actor": "meeting-extract"}],
    }
    cos_reader.write_followup(fu_id, cos_data)

    # DB write
    try:
        from models import Followup as FollowupModel
        from datetime import date as date_type

        fu_db = FollowupModel(
            fu_id=fu_id,
            what=f"Meeting action items — {title}",
            who=None,
            due=date_type.fromisoformat(due),
            priority=_highest_priority(checklist),
            status="open",
            source="meeting",
            source_id=transcript_id,
            notes=f"Auto-extracted from meeting on {meeting_date}",
            checklist=checklist,
        )
        db.add(fu_db)
        db.commit()
    except Exception:
        pass

    # Also create task in TaskFlow
    try:
        taskflow_local.create_task({
            "title": f"Meeting action items — {title}",
            "source": "meeting",
            "when_date": due,
            "priority_hint": _highest_priority(checklist),
            "tags": ["meeting", meeting_date, transcript_id],
            "checklist_items": [{"title": ci["text"], "is_completed": False} for ci in checklist],
        })
    except Exception:
        pass

    return fu_id


# --- Resolve confirmation ---

def confirm_checklist_resolution(fu_id: str, item_index: int, db=None) -> dict:
    """Toggle a checklist item (check ↔ uncheck). If all done, auto-resolve. If unchecked, un-resolve."""
    fu = cos_reader.get_followup(fu_id)
    if not fu:
        return {"error": "Follow-up not found"}

    checklist = fu.get("checklist_items") or []
    if item_index < 0 or item_index >= len(checklist):
        # item_index == -1 means resolve the whole FU
        if item_index == -1:
            fu["status"] = "resolved"
            fu["resolved_at"] = datetime.utcnow().isoformat()
            fu["updated"] = datetime.utcnow().isoformat()
            fu.setdefault("events", []).append({
                "timestamp": datetime.utcnow().isoformat(),
                "action": "resolved",
                "actor": "user-confirm",
            })
            cos_reader.write_followup(fu_id, fu)
            return {"resolved": True, "fu_id": fu_id}
        return {"error": "Invalid item index"}

    # Toggle: if completed → uncheck, if not → check
    was_completed = checklist[item_index].get("completed", False)
    checklist[item_index]["completed"] = not was_completed
    fu["checklist_items"] = checklist
    fu["updated"] = datetime.utcnow().isoformat()

    action = f"checklist_item_{item_index}_{'uncompleted' if was_completed else 'completed'}"
    fu.setdefault("events", []).append({
        "timestamp": datetime.utcnow().isoformat(),
        "action": action,
        "actor": "user-confirm",
    })

    all_done = all(ci.get("completed") for ci in checklist)

    if all_done:
        fu["status"] = "resolved"
        fu["resolved_at"] = datetime.utcnow().isoformat()
        fu["events"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "action": "resolved (all checklist items completed)",
            "actor": "standup-fanout",
        })
    elif was_completed and fu.get("status") == "resolved":
        # Unchecking an item → un-resolve the FU
        fu["status"] = "open"
        fu["resolved_at"] = None
        fu["events"].append({
            "timestamp": datetime.utcnow().isoformat(),
            "action": "reopened (checklist item unchecked)",
            "actor": "user-confirm",
        })

    cos_reader.write_followup(fu_id, fu)

    # Update DB too
    try:
        from models import Followup as FollowupModel
        db_fu = db.query(FollowupModel).filter(FollowupModel.fu_id == fu_id).first()
        if db_fu:
            db_fu.checklist = checklist
            if all_done:
                db_fu.status = "resolved"
                db_fu.resolved_at = datetime.utcnow()
            elif was_completed:
                db_fu.status = "open"
                db_fu.resolved_at = None
            db.commit()
    except Exception:
        pass

    now_completed = not was_completed
    return {
        "fu_id": fu_id,
        "item_index": item_index,
        "item_completed": now_completed,
        "all_completed": all_done,
        "resolved": all_done,
    }
