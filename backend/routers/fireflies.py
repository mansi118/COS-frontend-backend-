"""Fireflies.ai integration — direct GraphQL API (fast) + OpenClaw gateway for AI features."""

import json
import os
import re
import urllib.request
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Query
from pydantic import BaseModel
import convex_db
from routers.email import send_email
import cos_reader
import standup_fanout

router = APIRouter(prefix="/api/fireflies", tags=["fireflies"])

API_URL = "https://api.fireflies.ai/graphql"
API_KEY = os.getenv("FIREFLIES_API_KEY", "")


# --- Direct GraphQL client (fast, 2-3s) ---

def _graphql(query: str, variables: dict = None) -> dict:
    if not API_KEY:
        return {"error": "FIREFLIES_API_KEY not configured"}
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        API_URL, data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            if "errors" in data:
                return {"error": data["errors"]}
            return data.get("data", {})
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"error": f"HTTP {e.code}: {body[:200]}"}
    except Exception as e:
        return {"error": str(e)}


# --- Helpers ---

def _to_lines(val) -> list[str]:
    if not val:
        return []
    if isinstance(val, list):
        return [str(x) for x in val if x]
    if isinstance(val, str):
        return [line.strip() for line in val.split("\n") if line.strip()]
    return []


def _normalize_transcript(t: dict) -> dict:
    duration = t.get("duration") or 0
    duration_mins = duration // 60 if isinstance(duration, int) and duration > 100 else (duration or 0)
    attendees = t.get("meeting_attendees") or []
    return {
        "id": t.get("id", ""),
        "title": t.get("title", "Untitled"),
        "date": t.get("dateString", ""),
        "duration_mins": duration_mins,
        "host": t.get("host_email") or "",
        "attendees": [
            {"name": a.get("displayName") or "", "email": a.get("email", "")}
            for a in attendees
        ],
    }


def _normalize_detail(t: dict) -> dict:
    base = _normalize_transcript(t)
    summary = t.get("summary") or {}
    base.update({
        "url": t.get("transcript_url") or "",
        "action_items": _to_lines(summary.get("action_items")),
        "outline": _to_lines(summary.get("outline")),
        "keywords": summary.get("keywords") or [],
        "bullet_summary": _to_lines(summary.get("shorthand_bullet")),
        "sentences": [
            {"speaker": s.get("speaker_name", ""), "text": s.get("text", "")}
            for s in (t.get("sentences") or [])[:200]
        ],
    })
    return base


# --- Endpoints ---

@router.get("/list")
def list_transcripts(
    limit: int = Query(10, le=50),
    skip: int = Query(0),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
):
    query = """
    query Transcripts($limit: Int, $skip: Int, $fromDate: DateTime, $toDate: DateTime) {
      transcripts(limit: $limit, skip: $skip, fromDate: $fromDate, toDate: $toDate) {
        id title dateString duration host_email
        meeting_attendees { displayName email }
      }
    }
    """
    variables = {"limit": limit, "skip": skip}
    if from_date:
        variables["fromDate"] = from_date
    if to_date:
        variables["toDate"] = to_date

    data = _graphql(query, variables)
    if "error" in data:
        return data

    transcripts = data.get("transcripts", [])
    return {
        "transcripts": [_normalize_transcript(t) for t in transcripts],
        "count": len(transcripts),
    }


@router.get("/transcript/{transcript_id}")
def get_transcript(transcript_id: str):
    query = """
    query Transcript($transcriptId: String!) {
      transcript(id: $transcriptId) {
        id title dateString duration host_email transcript_url
        meeting_attendees { displayName email }
        summary { keywords action_items outline shorthand_bullet }
        sentences { text speaker_name }
      }
    }
    """
    data = _graphql(query, {"transcriptId": transcript_id})
    if "error" in data:
        return data

    t = data.get("transcript")
    if not t:
        return {"error": "Transcript not found"}
    return _normalize_detail(t)


@router.get("/actions")
def get_action_items(
    limit: int = Query(5, le=20),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
):
    query = """
    query Transcripts($limit: Int, $fromDate: DateTime, $toDate: DateTime) {
      transcripts(limit: $limit, fromDate: $fromDate, toDate: $toDate) {
        id title dateString
        summary { action_items }
      }
    }
    """
    variables = {"limit": limit}
    if from_date:
        variables["fromDate"] = from_date
    if to_date:
        variables["toDate"] = to_date

    data = _graphql(query, variables)
    if "error" in data:
        return data

    meetings = []
    for t in data.get("transcripts", []):
        items = _to_lines((t.get("summary") or {}).get("action_items"))
        if items:
            meetings.append({
                "id": t["id"],
                "title": t.get("title", "Untitled"),
                "date": t.get("dateString"),
                "action_items": items,
            })
    return {"meetings": meetings, "total_actions": sum(len(m["action_items"]) for m in meetings)}


@router.get("/search")
def search_transcripts(keyword: str = Query(...), limit: int = Query(10, le=50)):
    query = """
    query Transcripts($keyword: String!, $limit: Int) {
      transcripts(keyword: $keyword, limit: $limit) {
        id title dateString duration host_email
      }
    }
    """
    data = _graphql(query, {"keyword": keyword, "limit": limit})
    if "error" in data:
        return data

    return {
        "results": [
            {"id": t["id"], "title": t.get("title", "Untitled"), "date": t.get("dateString"), "duration_mins": (t.get("duration") or 0) // 60, "host": t.get("host_email")}
            for t in data.get("transcripts", [])
        ],
        "keyword": keyword,
    }


# --- Auto-extract MOM → Follow-ups ---

@router.post("/auto-extract")
def auto_extract_mom(
    days: int = Query(7, le=90),
    limit: int = Query(10, le=20),
):
    """Auto-extract action items from recent Fireflies transcripts into follow-ups.
    Idempotent — skips transcripts that have already been processed."""
    if not API_KEY:
        return {"error": "FIREFLIES_API_KEY not configured", "processed": 0}

    from_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%dT00:00:00Z")

    query = """
    query Transcripts($limit: Int, $fromDate: DateTime) {
      transcripts(limit: $limit, fromDate: $fromDate) {
        id title dateString
        summary { action_items }
      }
    }
    """
    data = _graphql(query, {"limit": limit, "fromDate": from_date})
    if "error" in data:
        return {"error": data["error"], "processed": 0}

    transcripts = data.get("transcripts", [])
    created = []
    skipped = 0

    for t in transcripts:
        transcript_id = t.get("id", "")
        action_items = _to_lines((t.get("summary") or {}).get("action_items"))
        if not action_items:
            skipped += 1
            continue

        fu_id = standup_fanout.create_followups_from_meeting(
            transcript_id=transcript_id,
            action_items=action_items,
            title=t.get("title", "Untitled"),
            meeting_date=t.get("dateString", ""),
            db=db,
        )
        if fu_id:
            created.append({"fu_id": fu_id, "transcript_id": transcript_id, "title": t.get("title"), "items": len(action_items)})
        else:
            skipped += 1

    # Collect ALL extracted transcript IDs (both new and previously extracted)
    all_fus = cos_reader.get_all_followups()
    extracted_ids = [f.get("source_id") for f in all_fus if f.get("source") == "meeting" and f.get("source_id")]

    return {
        "processed": len(created),
        "skipped": skipped,
        "total_transcripts": len(transcripts),
        "created_followups": created,
        "extracted_transcript_ids": extracted_ids,
    }


# --- AI Intelligence (uses OpenClaw gateway if available) ---

@router.get("/intelligence/{transcript_id}")
async def get_intelligence(transcript_id: str):
    try:
        import gateway
        instruction = (
            f"Fetch the Fireflies transcript with ID {transcript_id} and analyze it. "
            f"Return JSON with: decisions (array), risks (array), sentiment (string), "
            f"sentiment_score (1-10), notable_quotes (array), executive_summary (string)."
        )
        result = await gateway.execute(instruction)
        if result.get("success"):
            try:
                return json.loads(result.get("result", "{}"))
            except json.JSONDecodeError:
                return {"raw": result.get("result", "")[:500]}
        return {"error": result.get("error", "Gateway failed")}
    except ImportError:
        return {"error": "OpenClaw gateway not available for AI analysis"}


# --- Send Notes ---

class SendNotesRequest(BaseModel):
    transcript_id: str
    to: list[str]
    include_actions: bool = True
    include_outline: bool = True
    include_transcript: bool = False


@router.post("/send-notes")
def send_meeting_notes(req: SendNotesRequest):
    detail = get_transcript(req.transcript_id)
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
def send_notes_to_team(transcript_id: str = Query(...)):
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"error": "notification-routes.json not found"}

    contacts = routes.get("contacts", {})
    team_emails = [c["email"] for c in contacts.values() if c.get("email")]
    if not team_emails:
        return {"error": "No team members with email addresses"}

    req = SendNotesRequest(
        transcript_id=transcript_id, to=team_emails,
        include_actions=True, include_outline=True, include_transcript=False,
    )
    return send_meeting_notes(req)


@router.get("/config")
def get_fireflies_config():
    return {
        "configured": bool(API_KEY),
        "api_url": API_URL,
    }
