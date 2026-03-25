"""Voice Updates — record, transcribe, store, route, and play back voice updates."""

import os
from datetime import datetime, date
from typing import Optional
from fastapi import APIRouter, Query, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
import cos_reader
import convex_db
from services.voice_storage import save_audio, get_audio_url, delete_audio, get_local_path, get_storage_mode

router = APIRouter(prefix="/api/voice", tags=["voice"])

# Resolve slugs to full names
_roster = cos_reader.get_team_roster() or []
_roster_map = {r["slug"]: r for r in _roster}


def _vu_to_api(vu: dict) -> dict:
    """Convert CoS JSON voice update to API response."""
    who = vu.get("who")
    who_name = _roster_map.get(who, {}).get("name", who) if who else None
    audio_key = vu.get("audio_url", "")
    return {
        "vu_id": vu.get("id", ""),
        "who": who,
        "who_name": who_name,
        "type": vu.get("type", "general"),
        "audio_url": get_audio_url(audio_key) if audio_key else None,
        "audio_format": vu.get("audio_format", "webm"),
        "duration_sec": vu.get("duration_sec"),
        "transcript": vu.get("transcript"),
        "summary": vu.get("summary"),
        "routed_to": vu.get("routed_to") or [],
        "listened_by": vu.get("listened_by") or [],
        "priority": vu.get("priority", "P2"),
        "tags": vu.get("tags") or [],
        "created_at": vu.get("created_at"),
    }


# --- Background transcription ---

def _transcribe_background(vu_id: str, audio_key: str, unused: str):
    """Background task: transcribe audio via OpenClaw and update the record."""
    import asyncio
    import gateway

    instruction = (
        f"Use the voice-transcriber skill to transcribe the voice recording at {audio_key}. "
        f"The audio file is stored locally at data/voice/audio/. "
        f"Run: python3 ~/.openclaw/workspace/scripts/voice/transcribe.py process --vu-id {vu_id} "
        f"Then return only the transcript text."
    )

    try:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(gateway.execute(instruction))
        loop.close()
        transcript = result.get("result", "") if result.get("success") else None
    except Exception:
        transcript = None

    if not transcript:
        return

    # Update CoS JSON
    vu = cos_reader.get_voice_update(vu_id)
    if vu:
        vu["transcript"] = transcript
        vu["summary"] = transcript[:100].strip() + ("..." if len(transcript) > 100 else "")
        vu["updated_at"] = datetime.utcnow().isoformat()
        cos_reader.write_voice_update(vu_id, vu)

    # Update Convex
    convex_db.update_voice_update(vu_id, {
        "transcript": transcript,
        "summary": transcript[:100].strip() + ("..." if len(transcript) > 100 else ""),
        "updated_at": datetime.utcnow().isoformat(),
    })

    # Auto-route based on voice update type
    try:
        from services.voice_router import auto_route
        auto_route(vu_id)
    except Exception:
        pass


# --- Endpoints ---

@router.get("/config")
def get_voice_config():
    """Voice feature configuration status."""
    return {
        "storage_mode": get_storage_mode(),
        "s3_configured": get_storage_mode() == "s3",
        "total_updates": len(cos_reader.get_all_voice_updates()),
    }


@router.get("/feed")
def get_voice_feed(
    who: str = Query(None),
    type: str = Query(None),
    date_str: str = Query(None, alias="date"),
    limit: int = Query(20, le=50),
):
    """Get voice feed — paginated, filterable."""
    updates = cos_reader.get_all_voice_updates()

    if who:
        updates = [v for v in updates if v.get("who") == who]
    if type:
        updates = [v for v in updates if v.get("type") == type]
    if date_str:
        updates = [v for v in updates if (v.get("created_at", "")[:10] or "") == date_str]

    updates.sort(key=lambda v: v.get("created_at", ""), reverse=True)
    updates = updates[:limit]

    return {
        "updates": [_vu_to_api(v) for v in updates],
        "count": len(updates),
        "storage_mode": get_storage_mode(),
    }


@router.get("/stats")
def get_voice_stats():
    """Voice update statistics."""
    updates = cos_reader.get_all_voice_updates()
    today_str = date.today().isoformat()

    today_updates = [v for v in updates if (v.get("created_at", "")[:10] or "") == today_str]
    unlistened = len([v for v in updates if not v.get("listened_by")])

    by_person = {}
    for v in updates:
        who = v.get("who", "unknown")
        by_person[who] = by_person.get(who, 0) + 1

    return {
        "total": len(updates),
        "today": len(today_updates),
        "unlistened": unlistened,
        "by_person": by_person,
        "by_type": {
            "standup": len([v for v in updates if v.get("type") == "standup"]),
            "meeting_note": len([v for v in updates if v.get("type") == "meeting_note"]),
            "blocker": len([v for v in updates if v.get("type") == "blocker"]),
            "general": len([v for v in updates if v.get("type") == "general"]),
        },
    }


@router.post("/upload")
async def upload_voice(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    who: str = Form(...),
    type: str = Form("general"),
    tags: str = Form(""),
):
    """Upload voice recording → save audio → create record → background transcribe."""
    vu_num = cos_reader.increment_voice_counter()
    vu_id = f"VU-{vu_num:04d}"
    now = datetime.utcnow().isoformat()

    ext = "webm"
    if audio.content_type:
        if "mp3" in audio.content_type or "mpeg" in audio.content_type:
            ext = "mp3"
        elif "wav" in audio.content_type:
            ext = "wav"
        elif "ogg" in audio.content_type:
            ext = "ogg"

    audio_data = await audio.read()
    audio_key = await save_audio(audio_data, who, type, ext)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    vu_data = {
        "id": vu_id,
        "who": who,
        "type": type,
        "audio_url": audio_key,
        "audio_format": ext,
        "duration_sec": None,
        "transcript": None,
        "summary": None,
        "routed_to": [],
        "listened_by": [],
        "priority": "P2",
        "tags": tag_list,
        "created_at": now,
        "updated_at": now,
        "events": [{"timestamp": now, "action": "recorded", "actor": who}],
    }
    cos_reader.write_voice_update(vu_id, vu_data)

    # Write to Convex
    convex_db.insert_voice_update({
        "vu_id": vu_id,
        "who": who,
        "type": type,
        "audio_url": audio_key,
        "audio_format": ext,
        "priority": "P2",
        "tags": tag_list,
        "created_at": now,
        "updated_at": now,
    })

    background_tasks.add_task(_transcribe_background, vu_id, audio_key, "")

    return {
        "vu_id": vu_id,
        "status": "uploaded",
        "transcribing": True,
        "audio_url": get_audio_url(audio_key),
        "storage_mode": get_storage_mode(),
    }


@router.get("/{vu_id}")
def get_voice_update(vu_id: str):
    """Get single voice update with audio URL."""
    vu = cos_reader.get_voice_update(vu_id)
    if not vu:
        return {"error": "Voice update not found"}
    return _vu_to_api(vu)


@router.get("/stream/{path:path}")
def stream_audio(path: str):
    """Stream local audio file (fallback when S3 not configured)."""
    local_path = get_local_path(f"voice/{path}")
    if not local_path:
        return {"error": "Audio file not found"}
    media_type = "audio/webm"
    if path.endswith(".mp3"):
        media_type = "audio/mpeg"
    elif path.endswith(".wav"):
        media_type = "audio/wav"
    return FileResponse(local_path, media_type=media_type)


@router.patch("/{vu_id}/listened")
def mark_listened(vu_id: str, user: str = Query(...)):
    """Mark voice update as listened by a user."""
    vu = cos_reader.get_voice_update(vu_id)
    if not vu:
        return {"error": "Not found"}

    listened = vu.get("listened_by") or []
    if user not in listened:
        listened.append(user)
        vu["listened_by"] = listened
        vu["updated_at"] = datetime.utcnow().isoformat()
        vu.setdefault("events", []).append({
            "timestamp": datetime.utcnow().isoformat(),
            "action": f"listened_by_{user}",
            "actor": user,
        })
        cos_reader.write_voice_update(vu_id, vu)

    convex_db.update_voice_update(vu_id, {"listened_by": listened, "updated_at": datetime.utcnow().isoformat()})

    return {"vu_id": vu_id, "listened_by": listened}


@router.post("/{vu_id}/route")
def route_voice_update(vu_id: str, target_type: str = Form(...)):
    """Manually route a voice update to a follow-up or task."""
    vu = cos_reader.get_voice_update(vu_id)
    if not vu:
        return {"error": "Not found"}

    transcript = vu.get("transcript", "")
    if not transcript:
        return {"error": "No transcript available yet — wait for transcription to complete"}

    routed = vu.get("routed_to") or []

    if target_type == "followup":
        import standup_fanout
        fu_id = standup_fanout.create_followup_from_standup(
            vu.get("who", "unknown"),
            datetime.utcnow().strftime("%Y-%m-%d"),
            transcript, None, None,
        )
        if fu_id:
            routed.append({"type": "followup", "id": fu_id})

    elif target_type == "task":
        import taskflow_local
        task = taskflow_local.create_task({
            "title": vu.get("summary") or transcript[:60],
            "owner": vu.get("who"),
            "source": "voice",
            "notes": transcript,
            "tags": ["voice", vu_id],
        })
        if task:
            routed.append({"type": "task", "id": task.get("id")})

    vu["routed_to"] = routed
    vu["updated_at"] = datetime.utcnow().isoformat()
    cos_reader.write_voice_update(vu_id, vu)

    convex_db.update_voice_update(vu_id, {"routed_to": routed, "updated_at": datetime.utcnow().isoformat()})

    return {"vu_id": vu_id, "routed_to": routed}


@router.delete("/{vu_id}")
def delete_voice_update(vu_id: str):
    """Delete voice update + audio file."""
    vu = cos_reader.get_voice_update(vu_id)

    if vu and vu.get("audio_url"):
        delete_audio(vu["audio_url"])

    vu_path = os.path.join(
        os.getenv("COS_WORKSPACE", os.path.expanduser("~/.openclaw/workspace")),
        "data", "voice", f"{vu_id}.json"
    )
    if os.path.exists(vu_path):
        os.remove(vu_path)

    convex_db.delete_voice_update(vu_id)

    return {"deleted": True, "vu_id": vu_id}
