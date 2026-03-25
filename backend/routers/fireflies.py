"""Meeting Intelligence — Vexa integration (replaces Fireflies).
Bot joins meetings, records, transcribes. Same API paths for frontend compatibility."""

import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Query
from pydantic import BaseModel
from routers.email import send_email
import cos_reader
import standup_fanout
import convex_db
import re

router = APIRouter(prefix="/api/fireflies", tags=["meetings"])

VEXA_API_URL = os.getenv("VEXA_API_URL", "https://api.cloud.vexa.ai")
VEXA_API_KEY = os.getenv("VEXA_API_KEY", "")


# --- Vexa REST client ---

def _vexa_api(method: str, path: str, data: dict = None) -> dict:
    """Call Vexa REST API."""
    if not VEXA_API_KEY:
        return {"error": "VEXA_API_KEY not configured"}
    url = f"{VEXA_API_URL}{path}"
    headers = {
        "X-API-Key": VEXA_API_KEY,
        "Content-Type": "application/json",
    }
    payload = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=payload, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            return body
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode()
        except Exception:
            pass
        return {"error": f"HTTP {e.code}: {error_body[:200]}"}
    except Exception as e:
        return {"error": str(e)}


# --- Helpers ---

def _normalize_meeting(m: dict) -> dict:
    """Normalize Vexa meeting to frontend Transcript shape."""
    duration = m.get("duration", 0) or 0
    duration_mins = duration // 60 if isinstance(duration, (int, float)) and duration > 100 else duration
    participants = m.get("participants") or []
    return {
        "id": str(m.get("id", "")),
        "title": m.get("title") or m.get("name") or "Untitled",
        "date": m.get("start_time") or m.get("created_at") or "",
        "duration_mins": duration_mins,
        "host": m.get("organizer") or m.get("host") or "",
        "attendees": [
            {"name": p if isinstance(p, str) else p.get("name", ""), "email": "" if isinstance(p, str) else p.get("email", "")}
            for p in participants
        ],
        "platform": m.get("platform", ""),
        "meeting_id": m.get("native_meeting_id") or m.get("meeting_id") or "",
        "status": m.get("status", ""),
    }


def _normalize_transcript_detail(m: dict, transcript_data: dict) -> dict:
    """Normalize Vexa meeting + transcript to frontend TranscriptDetail shape."""
    base = _normalize_meeting(m)
    segments = transcript_data.get("segments") or transcript_data.get("transcript") or []
    if isinstance(segments, str):
        # If transcript is plain text, split into sentences
        segments = [{"speaker": "", "text": s.strip()} for s in segments.split(". ") if s.strip()]

    sentences = []
    for seg in segments[:200]:
        if isinstance(seg, dict):
            sentences.append({
                "speaker": seg.get("speaker") or seg.get("speaker_name") or "",
                "text": seg.get("text") or seg.get("content") or "",
            })

    # Extract action items heuristically from transcript
    all_text = " ".join(s["text"] for s in sentences)
    action_keywords = ["will", "should", "need to", "going to", "action item", "todo", "by friday", "by end of", "deadline"]
    action_items = []
    for sent in sentences:
        if any(kw in sent["text"].lower() for kw in action_keywords):
            action_items.append(sent["text"].strip())

    base.update({
        "url": transcript_data.get("url") or "",
        "action_items": action_items[:20],
        "outline": [],
        "keywords": [],
        "bullet_summary": [],
        "sentences": sentences,
    })
    return base


def _extract_meeting_id(link: str) -> tuple:
    """Extract platform + meeting ID from a meeting URL."""
    # Google Meet: https://meet.google.com/abc-defg-hij
    gm = re.search(r'meet\.google\.com/([a-z\-]+)', link)
    if gm:
        return "google_meet", gm.group(1)

    # Zoom: https://zoom.us/j/12345678?pwd=xxx
    zm = re.search(r'zoom\.us/j/(\d+)', link)
    if zm:
        return "zoom", zm.group(1)

    # Teams: various formats
    tm = re.search(r'teams\.microsoft\.com.*meetup-join/([^/&?]+)', link)
    if tm:
        return "teams", tm.group(1)

    return "unknown", link


# --- Endpoints ---

# Bot control (NEW — Vexa-specific)

class JoinMeetingRequest(BaseModel):
    meeting_link: str
    bot_name: Optional[str] = "NeuralEDGE Notetaker"


@router.post("/join")
def join_meeting(req: JoinMeetingRequest):
    """Send Vexa bot to join and record a meeting."""
    platform, meeting_id = _extract_meeting_id(req.meeting_link)
    if platform == "unknown":
        return {"error": "Could not detect meeting platform from URL"}

    bot_data = {
        "platform": platform,
        "native_meeting_id": meeting_id,
        "bot_name": req.bot_name,
        "recording_enabled": True,
        "transcribe_enabled": True,
    }
    result = _vexa_api("POST", "/bots", bot_data)
    if "error" in result:
        return result

    # Store in Convex
    convex_db.mutate("vexa_meetings:create", {
        "title": f"Meeting — {meeting_id}",
        "platform": platform,
        "meeting_id": meeting_id,
        "status": "joining",
        "start_time": datetime.utcnow().isoformat(),
        "created_at": datetime.utcnow().isoformat(),
    })

    return {
        "status": "joining",
        "platform": platform,
        "meeting_id": meeting_id,
        "bot_name": req.bot_name,
        "vexa_response": result,
    }


@router.delete("/leave/{platform}/{meeting_id}")
def leave_meeting(platform: str, meeting_id: str):
    """Remove Vexa bot from a meeting."""
    result = _vexa_api("DELETE", f"/bots/{platform}/{meeting_id}")
    return {"status": "left", "platform": platform, "meeting_id": meeting_id, "vexa_response": result}


@router.get("/active")
def get_active_bots():
    """List currently active meeting bots."""
    # Check Vexa for active meetings
    meetings = _vexa_api("GET", "/meetings")
    if "error" in meetings:
        return meetings
    active = [m for m in meetings.get("meetings", []) if m.get("status") in ("joining", "recording", "in_progress")]
    return {"active": [_normalize_meeting(m) for m in active], "count": len(active)}


# --- Existing endpoints (rewritten for Vexa) ---

@router.get("/list")
def list_transcripts(
    limit: int = Query(10, le=50),
    skip: int = Query(0),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
):
    """List recorded meetings from Vexa."""
    data = _vexa_api("GET", "/meetings")
    if "error" in data:
        return data

    meetings = data.get("meetings", [])

    # Filter by date if provided
    if from_date:
        meetings = [m for m in meetings if (m.get("start_time") or m.get("created_at") or "") >= from_date]
    if to_date:
        meetings = [m for m in meetings if (m.get("start_time") or m.get("created_at") or "") <= to_date]

    # Sort by date desc
    meetings.sort(key=lambda m: m.get("start_time") or m.get("created_at") or "", reverse=True)

    # Paginate
    meetings = meetings[skip:skip + limit]

    return {
        "transcripts": [_normalize_meeting(m) for m in meetings],
        "count": len(meetings),
    }


@router.get("/transcript/{transcript_id}")
def get_transcript(transcript_id: str):
    """Get full transcript for a meeting."""
    # First get the meeting to find platform + native_meeting_id
    meetings_data = _vexa_api("GET", "/meetings")
    if "error" in meetings_data:
        return meetings_data

    meeting = None
    for m in meetings_data.get("meetings", []):
        if str(m.get("id")) == transcript_id or m.get("native_meeting_id") == transcript_id:
            meeting = m
            break

    if not meeting:
        return {"error": "Meeting not found"}

    platform = meeting.get("platform", "google_meet")
    native_id = meeting.get("native_meeting_id") or transcript_id

    # Get transcript
    transcript_data = _vexa_api("GET", f"/transcripts/{platform}/{native_id}")
    if "error" in transcript_data:
        # Return meeting info without transcript
        return _normalize_meeting(meeting)

    return _normalize_transcript_detail(meeting, transcript_data)


@router.get("/actions")
def get_action_items(
    limit: int = Query(5, le=20),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
):
    """Get action items extracted from recent meetings."""
    meetings_data = _vexa_api("GET", "/meetings")
    if "error" in meetings_data:
        return meetings_data

    meetings = meetings_data.get("meetings", [])
    if from_date:
        meetings = [m for m in meetings if (m.get("start_time") or "") >= from_date]
    meetings = meetings[:limit]

    result_meetings = []
    for m in meetings:
        platform = m.get("platform", "google_meet")
        native_id = m.get("native_meeting_id", "")
        if not native_id:
            continue

        transcript_data = _vexa_api("GET", f"/transcripts/{platform}/{native_id}")
        if "error" in transcript_data:
            continue

        detail = _normalize_transcript_detail(m, transcript_data)
        if detail.get("action_items"):
            result_meetings.append({
                "id": str(m.get("id", "")),
                "title": detail["title"],
                "date": detail["date"],
                "action_items": detail["action_items"],
            })

    return {
        "meetings": result_meetings,
        "total_actions": sum(len(m["action_items"]) for m in result_meetings),
    }


@router.get("/search")
def search_transcripts(keyword: str = Query(...), limit: int = Query(10, le=50)):
    """Search meetings by keyword in title."""
    meetings_data = _vexa_api("GET", "/meetings")
    if "error" in meetings_data:
        return meetings_data

    meetings = meetings_data.get("meetings", [])
    keyword_lower = keyword.lower()
    matches = [m for m in meetings if keyword_lower in (m.get("title") or "").lower()]

    return {
        "results": [_normalize_meeting(m) for m in matches[:limit]],
        "keyword": keyword,
    }


# --- Auto-extract MOM → Follow-ups ---

@router.post("/auto-extract")
def auto_extract_mom(
    days: int = Query(7, le=90),
    limit: int = Query(10, le=20),
):
    """Auto-extract action items from recent Vexa meetings into follow-ups."""
    if not VEXA_API_KEY:
        return {"error": "VEXA_API_KEY not configured", "processed": 0}

    meetings_data = _vexa_api("GET", "/meetings")
    if "error" in meetings_data:
        return {"error": meetings_data["error"], "processed": 0}

    meetings = meetings_data.get("meetings", [])
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    meetings = [m for m in meetings if (m.get("start_time") or m.get("created_at") or "") >= cutoff]
    meetings = meetings[:limit]

    created = []
    skipped = 0

    for m in meetings:
        meeting_id = str(m.get("id", ""))
        platform = m.get("platform", "google_meet")
        native_id = m.get("native_meeting_id", "")
        if not native_id:
            skipped += 1
            continue

        # Get transcript
        transcript_data = _vexa_api("GET", f"/transcripts/{platform}/{native_id}")
        if "error" in transcript_data:
            skipped += 1
            continue

        detail = _normalize_transcript_detail(m, transcript_data)
        action_items = detail.get("action_items", [])
        if not action_items:
            skipped += 1
            continue

        fu_id = standup_fanout.create_followups_from_meeting(
            transcript_id=meeting_id,
            action_items=action_items,
            title=detail.get("title", "Untitled"),
            meeting_date=detail.get("date", ""),
            db=None,
        )
        if fu_id:
            created.append({"fu_id": fu_id, "transcript_id": meeting_id, "title": detail["title"], "items": len(action_items)})
        else:
            skipped += 1

    # Collect all extracted meeting IDs
    all_fus = cos_reader.get_all_followups()
    extracted_ids = [f.get("source_id") for f in all_fus if f.get("source") == "meeting" and f.get("source_id")]

    return {
        "processed": len(created),
        "skipped": skipped,
        "total_transcripts": len(meetings),
        "created_followups": created,
        "extracted_transcript_ids": extracted_ids,
    }


# --- AI Intelligence ---

@router.get("/intelligence/{transcript_id}")
async def get_intelligence(transcript_id: str):
    """AI analysis of a meeting transcript via OpenClaw."""
    # Get transcript first
    detail = get_transcript(transcript_id)
    if "error" in detail:
        return detail

    sentences = detail.get("sentences", [])
    if not sentences:
        return {"error": "No transcript available for analysis"}

    transcript_text = "\n".join(f"{s['speaker']}: {s['text']}" for s in sentences[:100])

    try:
        import gateway
        instruction = (
            f"Analyze this meeting transcript and return JSON with: "
            f"decisions (array), risks (array), sentiment (string), "
            f"sentiment_score (1-10), notable_quotes (array), executive_summary (string).\n\n"
            f"Transcript:\n{transcript_text}"
        )
        result = await gateway.execute(instruction)
        if result.get("success"):
            try:
                return json.loads(result.get("result", "{}"))
            except json.JSONDecodeError:
                return {"raw": result.get("result", "")[:500]}
        return {"error": result.get("error", "Gateway failed")}
    except ImportError:
        return {"error": "OpenClaw gateway not available"}


# --- Send Notes ---

class SendNotesRequest(BaseModel):
    transcript_id: str
    to: list[str]
    include_actions: bool = True
    include_transcript: bool = False


@router.post("/send-notes")
def send_meeting_notes(req: SendNotesRequest):
    """Email meeting notes."""
    detail = get_transcript(req.transcript_id)
    if "error" in detail:
        return detail

    lines = [
        f"# Meeting Notes — {detail.get('title', 'Meeting')}",
        "",
        f"**Date:** {detail.get('date', 'N/A')}",
        f"**Duration:** {detail.get('duration_mins', '?')} minutes",
        f"**Host:** {detail.get('host', 'N/A')}",
    ]

    attendees = detail.get("attendees", [])
    if attendees:
        names = ", ".join(a.get("name") or a.get("email") or "?" for a in attendees)
        lines.append(f"**Attendees:** {names}")
    lines.append("")

    if req.include_actions and detail.get("action_items"):
        lines.extend(["---", "## Action Items", ""])
        for item in detail["action_items"]:
            lines.append(f"- [ ] {item}")
        lines.append("")

    if req.include_transcript and detail.get("sentences"):
        lines.extend(["---", "## Transcript", ""])
        for s in detail["sentences"][:50]:
            lines.append(f"**{s['speaker']}:** {s['text']}")

    body = "\n".join(lines)
    subject = f"Meeting Notes — {detail.get('title', 'Meeting')} — {detail.get('date', '')}"

    results = []
    for recipient in req.to:
        r = send_email(to=recipient, subject=subject, body=body)
        results.append({"to": recipient, **r})

    sent = sum(1 for r in results if r.get("success"))
    return {
        "status": "sent" if sent == len(req.to) else "partial" if sent > 0 else "failed",
        "meeting": detail.get("title", ""),
        "sent": sent,
        "total": len(req.to),
        "results": results,
    }


@router.post("/send-notes-to-team")
def send_notes_to_team(transcript_id: str = Query(...)):
    """Email notes to all team members."""
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"error": "notification-routes.json not found"}
    contacts = routes.get("contacts", {})
    team_emails = [c["email"] for c in contacts.values() if c.get("email")]
    if not team_emails:
        return {"error": "No team members with email addresses"}
    req = SendNotesRequest(transcript_id=transcript_id, to=team_emails, include_actions=True, include_transcript=False)
    return send_meeting_notes(req)


@router.get("/config")
def get_config():
    """Meeting intelligence configuration status."""
    return {
        "configured": bool(VEXA_API_KEY),
        "api_url": VEXA_API_URL,
        "provider": "vexa",
    }
