"""Voice auto-router — routes transcribed voice updates into existing pipelines."""

from datetime import datetime
from typing import Optional
import cos_reader


def auto_route(vu_id: str, db=None) -> list[dict]:
    """Auto-route a voice update based on its type. Call after transcription is done.
    Returns list of routes created: [{"type": "followup", "id": "FU-0042"}, ...]"""
    vu = cos_reader.get_voice_update(vu_id)
    if not vu:
        return []

    transcript = vu.get("transcript")
    if not transcript:
        return []

    update_type = vu.get("type", "general")
    who = vu.get("who", "unknown")
    routes = []

    if update_type == "standup":
        routes = _route_standup(vu_id, who, transcript, db)
    elif update_type == "blocker":
        routes = _route_blocker(vu_id, who, transcript, db)
    elif update_type == "meeting_note":
        routes = _route_meeting_note(vu_id, who, transcript, db)
    # "general" type = no routing, voice feed only

    # Save routes back to voice update
    if routes:
        vu["routed_to"] = (vu.get("routed_to") or []) + routes
        vu["updated_at"] = datetime.utcnow().isoformat()
        vu.setdefault("events", []).append({
            "timestamp": datetime.utcnow().isoformat(),
            "action": f"auto_routed_{update_type}",
            "actor": "voice-router",
        })
        cos_reader.write_voice_update(vu_id, vu)

        # Update DB
        try:
            from models import VoiceUpdate as VoiceUpdateModel
            db_vu = db.query(VoiceUpdateModel).filter(VoiceUpdateModel.vu_id == vu_id).first()
            if db_vu:
                db_vu.routed_to = vu["routed_to"]
                db.commit()
        except Exception:
            pass

    return routes


def _route_standup(vu_id: str, who: str, transcript: str, db) -> list[dict]:
    """Route voice standup → create follow-up + task via standup_fanout."""
    import standup_fanout

    today = datetime.utcnow().strftime("%Y-%m-%d")
    routes = []

    # Use transcript as "doing" text — fanout will parse into checklist items
    fu_id = standup_fanout.create_followup_from_standup(
        person=who,
        date_str=today,
        doing=transcript,
        blockers=None,
        db=db,
    )
    if fu_id:
        routes.append({"type": "followup", "id": fu_id})

    task_id = standup_fanout.create_task_from_standup(
        person=who,
        date_str=today,
        doing=transcript,
    )
    if task_id:
        routes.append({"type": "task", "id": task_id})

    # Also create a standup entry so it appears on /updates page
    try:
        import standup_local
        standup_local.post_standup(who, {
            "done": "",
            "doing": transcript,
            "blockers": None,
            "mood": "neutral",
            "source": "voice",
            "source_id": vu_id,
        })
    except Exception:
        pass

    return routes


def _route_blocker(vu_id: str, who: str, transcript: str, db) -> list[dict]:
    """Route voice blocker → create P0 follow-up."""
    routes = []

    # Extract first sentence as the blocker title
    first_sentence = transcript.split(".")[0].strip()[:80] if transcript else "Voice blocker"

    fu_num = cos_reader.increment_followup_counter()
    fu_id = f"FU-{fu_num:04d}"
    now = datetime.utcnow().isoformat()

    cos_data = {
        "id": fu_id,
        "what": f"BLOCKER: {first_sentence}",
        "who": who,
        "due": datetime.utcnow().strftime("%Y-%m-%d"),
        "source": "voice",
        "source_id": vu_id,
        "priority": "P0",
        "status": "open",
        "notes": transcript,
        "checklist_items": None,
        "created": now,
        "updated": now,
        "resolved_at": None,
        "reminders_sent": 0,
        "events": [{"timestamp": now, "action": "created", "actor": "voice-router"}],
    }
    cos_reader.write_followup(fu_id, cos_data)

    # DB write
    try:
        from models import Followup
        fu_db = Followup(
            fu_id=fu_id,
            what=f"BLOCKER: {first_sentence}",
            who=who,
            due=datetime.utcnow().date(),
            priority="P0",
            status="open",
            source="voice",
            source_id=vu_id,
            notes=transcript,
        )
        db.add(fu_db)
        db.commit()
    except Exception:
        pass

    routes.append({"type": "followup", "id": fu_id})
    return routes


def _route_meeting_note(vu_id: str, who: str, transcript: str, db) -> list[dict]:
    """Route voice meeting note → create follow-up with transcript as content."""
    routes = []

    first_sentence = transcript.split(".")[0].strip()[:60] if transcript else "Voice meeting note"

    # Split transcript into sentences for checklist
    sentences = [s.strip() for s in transcript.replace("\n", ". ").split(". ") if s.strip() and len(s.strip()) > 5]
    checklist = [{"text": s[:100], "priority": "P2", "completed": False} for s in sentences[:10]]

    fu_num = cos_reader.increment_followup_counter()
    fu_id = f"FU-{fu_num:04d}"
    now = datetime.utcnow().isoformat()

    cos_data = {
        "id": fu_id,
        "what": f"Voice note — {first_sentence}",
        "who": who,
        "due": datetime.utcnow().strftime("%Y-%m-%d"),
        "source": "voice",
        "source_id": vu_id,
        "priority": "P2",
        "status": "open",
        "notes": transcript,
        "checklist_items": checklist if checklist else None,
        "created": now,
        "updated": now,
        "resolved_at": None,
        "reminders_sent": 0,
        "events": [{"timestamp": now, "action": "created", "actor": "voice-router"}],
    }
    cos_reader.write_followup(fu_id, cos_data)

    # DB write
    try:
        from models import Followup
        fu_db = Followup(
            fu_id=fu_id,
            what=f"Voice note — {first_sentence}",
            who=who,
            due=datetime.utcnow().date(),
            priority="P2",
            status="open",
            source="voice",
            source_id=vu_id,
            notes=transcript,
            checklist=checklist if checklist else None,
        )
        db.add(fu_db)
        db.commit()
    except Exception:
        pass

    routes.append({"type": "followup", "id": fu_id})
    return routes
