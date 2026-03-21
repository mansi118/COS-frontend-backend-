"""Fireflies.ai integration — all operations proxied through OpenClaw gateway."""

import json
import re
from typing import Optional
from fastapi import APIRouter, Query
from pydantic import BaseModel
from routers.email import send_email
import cos_reader
import gateway

router = APIRouter(prefix="/api/fireflies", tags=["fireflies"])


# --- Helpers ---

def _to_lines(val) -> list[str]:
    """Normalize action_items/outline — could be a string or a list."""
    if not val:
        return []
    if isinstance(val, list):
        return [str(x) for x in val if x]
    if isinstance(val, str):
        return [line.strip() for line in val.split("\n") if line.strip()]
    return []


def _parse_json_from_result(result: dict) -> dict:
    """Extract JSON from OpenClaw's text response.

    Handles: raw JSON, JSON in code fences, JSON with surrounding text.
    """
    if not result.get("success"):
        return {"error": result.get("error", "Gateway request failed")}

    text = result.get("result", "")

    # Try 1: Direct JSON parse
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass

    # Try 2: Extract from ```json ... ``` or ``` ... ``` code fences
    fence_match = re.search(r'```(?:json)?\s*\n?([\s\S]*?)\n?```', text)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Try 3: Find first { ... } or [ ... ] block with proper brace matching
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start_idx = text.find(start_char)
        if start_idx == -1:
            continue
        depth = 0
        for i in range(start_idx, len(text)):
            if text[i] == start_char:
                depth += 1
            elif text[i] == end_char:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start_idx:i + 1])
                    except json.JSONDecodeError:
                        break

    # Fallback: return the raw text
    return {"raw_text": text, "parse_error": "Could not extract JSON from OpenClaw response"}


def _normalize_transcript(t: dict) -> dict:
    """Normalize transcript field names to match frontend expectations."""
    duration = t.get("duration_mins") or t.get("duration_minutes")
    if duration is None:
        raw = t.get("duration", 0)
        duration = raw // 60 if isinstance(raw, int) and raw > 100 else (raw or 0)

    attendees = t.get("attendees") or t.get("meeting_attendees") or []
    return {
        "id": t.get("id", ""),
        "title": t.get("title", "Untitled"),
        "date": t.get("date") or t.get("dateString", ""),
        "duration_mins": duration,
        "host": t.get("host") or t.get("host_email", ""),
        "attendees": [
            {
                "name": a.get("name") or a.get("displayName", ""),
                "email": a.get("email", ""),
            }
            for a in attendees
        ],
    }


def _normalize_transcript_detail(t: dict) -> dict:
    """Normalize full transcript detail including summary fields."""
    base = _normalize_transcript(t)
    summary = t.get("summary") or {}
    sentences = t.get("sentences") or []

    base.update({
        "url": t.get("url") or t.get("transcript_url", ""),
        "action_items": _to_lines(
            t.get("action_items") or summary.get("action_items")
        ),
        "outline": _to_lines(
            t.get("outline") or summary.get("outline")
        ),
        "keywords": (
            t.get("keywords") or summary.get("keywords") or []
        ),
        "bullet_summary": _to_lines(
            t.get("bullet_summary") or summary.get("shorthand_bullet")
        ),
        "sentences": [
            {
                "speaker": s.get("speaker") or s.get("speaker_name", ""),
                "text": s.get("text", ""),
                "start": s.get("start") or s.get("start_time"),
                "end": s.get("end") or s.get("end_time"),
            }
            for s in sentences[:200]
        ],
    })
    return base


# --- Endpoints ---

@router.get("/list")
async def list_transcripts(
    limit: int = Query(10, le=50),
    skip: int = Query(0),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
):
    """List recent transcripts via OpenClaw."""
    date_filter = ""
    if from_date:
        date_filter += f" from date {from_date}"
    if to_date:
        date_filter += f" to date {to_date}"

    instruction = (
        f"List the {limit} most recent Fireflies transcripts{date_filter} "
        f"using the fireflies-notetaker skill with --json flag. "
        f"Return the raw JSON output."
    )
    result = await gateway.execute(instruction)
    data = _parse_json_from_result(result)

    if "error" in data:
        return data
    if "parse_error" in data:
        return {"error": data["parse_error"], "raw": data.get("raw_text", "")[:500]}

    # Handle both flat list and nested formats
    transcripts = data if isinstance(data, list) else data.get("transcripts", [])
    return {
        "transcripts": [_normalize_transcript(t) for t in transcripts],
        "count": len(transcripts),
    }


@router.get("/transcript/{transcript_id}")
async def get_transcript(transcript_id: str):
    """Get full transcript with summary, action items, and sentences via OpenClaw."""
    instruction = (
        f"Get the full Fireflies transcript with ID {transcript_id} "
        f"using the fireflies-notetaker skill with --json flag. "
        f"Include summary, action items, outline, keywords, and sentences with speaker names. "
        f"Return the raw JSON output."
    )
    result = await gateway.execute(instruction)
    data = _parse_json_from_result(result)

    if "error" in data:
        return data
    if "parse_error" in data:
        return {"error": data["parse_error"]}

    # Could be nested under "transcript" key or flat
    t = data.get("transcript", data)
    return _normalize_transcript_detail(t)


@router.get("/actions")
async def get_action_items(
    limit: int = Query(5, le=20),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
):
    """Get action items from recent transcripts via OpenClaw."""
    date_filter = ""
    if from_date:
        date_filter += f" from date {from_date}"
    if to_date:
        date_filter += f" to date {to_date}"

    instruction = (
        f"Get action items from the {limit} most recent Fireflies transcripts{date_filter} "
        f"using the fireflies-notetaker skill with --json flag. "
        f"Return the raw JSON output."
    )
    result = await gateway.execute(instruction)
    data = _parse_json_from_result(result)

    if "error" in data:
        return data
    if "parse_error" in data:
        return {"error": data["parse_error"]}

    meetings_raw = data if isinstance(data, list) else data.get("meetings", [])
    meetings = []
    for m in meetings_raw:
        items = _to_lines(m.get("action_items"))
        if items:
            meetings.append({
                "id": m.get("id", ""),
                "title": m.get("title", "Untitled"),
                "date": m.get("date") or m.get("dateString", ""),
                "action_items": items,
            })

    return {
        "meetings": meetings,
        "total_actions": sum(len(m["action_items"]) for m in meetings),
    }


@router.get("/search")
async def search_transcripts(keyword: str = Query(...), limit: int = Query(10, le=50)):
    """Search transcripts by keyword via OpenClaw."""
    instruction = (
        f"Search Fireflies transcripts for the keyword '{keyword}' "
        f"using the fireflies-notetaker skill with --json flag. "
        f"Return up to {limit} results as raw JSON."
    )
    result = await gateway.execute(instruction)
    data = _parse_json_from_result(result)

    if "error" in data:
        return data
    if "parse_error" in data:
        return {"error": data["parse_error"]}

    results = data if isinstance(data, list) else data.get("results") or data.get("transcripts", [])
    return {
        "results": [_normalize_transcript(t) for t in results],
        "keyword": keyword,
    }


@router.get("/intelligence/{transcript_id}")
async def get_intelligence(transcript_id: str):
    """Analyze a transcript using OpenClaw's AI capabilities."""
    instruction = (
        f"Fetch the Fireflies transcript with ID {transcript_id} and analyze it thoroughly. "
        f"Return a JSON object with these exact keys: "
        f'"decisions" (array of strings — key decisions made), '
        f'"risks" (array of strings — risks or concerns raised), '
        f'"sentiment" (string — "positive", "neutral", "negative", or "mixed"), '
        f'"sentiment_score" (number 1-10), '
        f'"notable_quotes" (array of objects with "speaker" and "quote" fields), '
        f'"executive_summary" (string — 2-3 sentence summary). '
        f"Return ONLY the JSON object."
    )
    result = await gateway.execute(instruction)
    data = _parse_json_from_result(result)

    if "error" in data:
        return data
    if "parse_error" in data:
        return {"error": data["parse_error"]}

    return data


# --- Send Notes (fallback endpoints — frontend uses /api/execute) ---

class SendNotesRequest(BaseModel):
    transcript_id: str
    to: list[str]
    include_actions: bool = True
    include_outline: bool = True
    include_transcript: bool = False


@router.post("/send-notes")
async def send_meeting_notes(req: SendNotesRequest):
    """Fetch transcript via OpenClaw and email meeting notes."""
    detail = await get_transcript(req.transcript_id)
    if "error" in detail:
        return detail

    lines = [
        f"# Meeting Notes — {detail['title']}",
        "",
        f"**Date:** {detail.get('date', 'N/A')}",
        f"**Duration:** {detail.get('duration_mins', '?')} minutes",
        f"**Host:** {detail.get('host', 'N/A')}",
    ]

    attendees = detail.get("attendees", [])
    if attendees:
        names = ", ".join(a["name"] or a["email"] for a in attendees)
        lines.append(f"**Attendees:** {names}")

    if detail.get("url"):
        lines.append(f"**Full Transcript:** {detail['url']}")

    lines.append("")

    if req.include_actions and detail.get("action_items"):
        lines.extend(["---", "## Action Items", ""])
        for item in detail["action_items"]:
            lines.append(f"- [ ] {item}")
        lines.append("")

    if req.include_outline and detail.get("outline"):
        lines.extend(["---", "## Outline", ""])
        for item in detail["outline"]:
            lines.append(f"- {item}")
        lines.append("")

    if detail.get("keywords"):
        lines.extend(["---", f"**Keywords:** {', '.join(detail['keywords'])}", ""])

    if req.include_transcript and detail.get("sentences"):
        lines.extend(["---", "## Transcript", ""])
        for s in detail["sentences"][:50]:
            lines.append(f"**{s['speaker']}:** {s['text']}")
        if len(detail["sentences"]) > 50:
            lines.append(f"*... and {len(detail['sentences']) - 50} more lines*")

    body = "\n".join(lines)
    subject = f"Meeting Notes — {detail['title']} — {detail.get('date', '')}"

    results = []
    for recipient in req.to:
        r = send_email(to=recipient, subject=subject, body=body)
        results.append({"to": recipient, **r})

    sent = sum(1 for r in results if r.get("success"))
    return {
        "status": "sent" if sent == len(req.to) else "partial" if sent > 0 else "failed",
        "meeting": detail["title"],
        "sent": sent,
        "total": len(req.to),
        "results": results,
    }


@router.post("/send-notes-to-team")
async def send_notes_to_team(transcript_id: str = Query(...)):
    """Fetch transcript via OpenClaw and email notes to all team members."""
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"error": "notification-routes.json not found"}

    contacts = routes.get("contacts", {})
    team_emails = [c["email"] for c in contacts.values() if c.get("email")]

    if not team_emails:
        return {"error": "No team members with email addresses"}

    req = SendNotesRequest(
        transcript_id=transcript_id,
        to=team_emails,
        include_actions=True,
        include_outline=True,
        include_transcript=False,
    )
    return await send_meeting_notes(req)


@router.get("/config")
async def get_fireflies_config():
    """Check if OpenClaw gateway is connected (replaces FIREFLIES_API_KEY check)."""
    health = await gateway.health()
    return {
        "configured": health.get("connected", False),
        "gateway": health,
    }
