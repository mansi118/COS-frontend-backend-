"""Slack integration via Slack Web API (Bot Token)."""

import json
import os
import re
import urllib.request
from typing import Optional
from fastapi import APIRouter, Query
from pydantic import BaseModel
import convex_db
import taskflow_service as taskflow_local

router = APIRouter(prefix="/api/slack", tags=["slack"])

SLACK_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_API = "https://slack.com/api"


def _is_configured() -> bool:
    return bool(SLACK_TOKEN)


def _slack_api(method: str, payload: dict) -> dict:
    """Call Slack Web API."""
    if not _is_configured():
        return {"ok": False, "error": "SLACK_BOT_TOKEN not configured"}

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{SLACK_API}/{method}",
        data=data,
        headers={
            "Authorization": f"Bearer {SLACK_TOKEN}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"ok": False, "error": f"HTTP {e.code}: {body[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def markdown_to_slack(text: str) -> str:
    """Convert standard markdown to Slack mrkdwn format."""
    # Headers → bold
    text = re.sub(r'^#{1,3}\s+(.+)$', r'*\1*', text, flags=re.MULTILINE)
    # Bold: **text** → *text*
    text = re.sub(r'\*\*(.+?)\*\*', r'*\1*', text)
    # Checklists: - [ ] → ☐, - [x] → ✅
    text = re.sub(r'^- \[ \] ', '☐ ', text, flags=re.MULTILINE)
    text = re.sub(r'^- \[x\] ', '✅ ', text, flags=re.MULTILINE)
    # Horizontal rule
    text = re.sub(r'^---+$', '─' * 30, text, flags=re.MULTILINE)
    return text


def _resolve_channel(channel: str) -> str:
    """Resolve channel name to ID using notification-routes.json."""
    routes = convex_db.get_notification_routes()
    if routes:
        channels = routes.get("slack", {}).get("channels", {})
        # Try exact match first
        if channel in channels:
            return channels[channel]
        # Try without # prefix
        clean = channel.lstrip("#")
        if clean in channels:
            return channels[clean]
    return channel  # return as-is (might be a raw channel ID)


def _resolve_user(person: str) -> Optional[str]:
    """Resolve person slug to Slack user ID."""
    routes = convex_db.get_notification_routes()
    if routes:
        contacts = routes.get("contacts", {})
        contact = contacts.get(person, {})
        return contact.get("slack_id")
    return None


# --- Schemas ---

class SendRequest(BaseModel):
    channel: str  # channel name, ID, or slug from notification-routes
    message: str
    blocks: Optional[list] = None  # Block Kit blocks (optional)


class DmRequest(BaseModel):
    user: str  # slack user ID or person slug (e.g. "yatharth")
    message: str


class CardRequest(BaseModel):
    channel: str
    title: str
    body: str
    footer: Optional[str] = None


# --- Endpoints ---

@router.get("/config")
def slack_config():
    return {
        "configured": _is_configured(),
        "provider": "slack-web-api",
    }


@router.post("/send")
def send_message(req: SendRequest):
    """Send a message to a Slack channel."""
    channel_id = _resolve_channel(req.channel)
    payload = {
        "channel": channel_id,
        "text": markdown_to_slack(req.message),
    }
    if req.blocks:
        payload["blocks"] = req.blocks
    result = _slack_api("chat.postMessage", payload)
    return {
        "success": result.get("ok", False),
        "channel": channel_id,
        "ts": result.get("ts"),
        "error": result.get("error") if not result.get("ok") else None,
    }


@router.post("/dm")
def send_dm(req: DmRequest):
    """Send a direct message to a user."""
    # Resolve person slug to slack_id
    user_id = req.user
    if not req.user.startswith("U"):
        resolved = _resolve_user(req.user)
        if resolved:
            user_id = resolved
        else:
            return {"success": False, "error": f"Could not resolve '{req.user}' to a Slack user ID"}

    result = _slack_api("chat.postMessage", {
        "channel": user_id,  # DM uses user ID as channel
        "text": markdown_to_slack(req.message),
    })
    return {
        "success": result.get("ok", False),
        "user": user_id,
        "ts": result.get("ts"),
        "error": result.get("error") if not result.get("ok") else None,
    }


@router.post("/card")
def send_card(req: CardRequest):
    """Send a Block Kit card to a channel."""
    channel_id = _resolve_channel(req.channel)
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": req.title, "emoji": True}},
        {"type": "section", "text": {"type": "mrkdwn", "text": markdown_to_slack(req.body)}},
    ]
    if req.footer:
        blocks.append({"type": "divider"})
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": req.footer}]})

    result = _slack_api("chat.postMessage", {
        "channel": channel_id,
        "text": req.title,  # fallback text
        "blocks": blocks,
    })
    return {
        "success": result.get("ok", False),
        "channel": channel_id,
        "ts": result.get("ts"),
        "error": result.get("error") if not result.get("ok") else None,
    }


@router.post("/briefing")
def send_briefing(channel: str = Query("daily_update")):
    """Generate TaskFlow daily briefing and send as Block Kit card to Slack."""
    briefing = taskflow_local.get_daily_briefing()
    channel_id = _resolve_channel(channel)

    # Build Block Kit
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"☀️ Daily Briefing — {briefing['date']}", "emoji": True}},
    ]

    if briefing.get("overdue"):
        items = "\n".join(f"• {t['title']} — _{t.get('assignee', '?')}_ ({t.get('overdue_days', '?')}d overdue)" for t in briefing["overdue"])
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"⚠️ *Overdue ({len(briefing['overdue'])})*\n{items}"}})

    if briefing.get("today"):
        items = "\n".join(f"• {t['title']}" for t in briefing["today"])
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"✅ *Today ({len(briefing['today'])})*\n{items}"}})

    if briefing.get("approaching"):
        items = "\n".join(f"• {t['title']} — _{t.get('assignee', '?')}_ ({t.get('days_until', '?')}d)" for t in briefing["approaching"])
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"📅 *Approaching ({len(briefing['approaching'])})*\n{items}"}})

    blocks.append({"type": "divider"})
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn",
        "text": f"Active: {briefing.get('total_active', 0)} | Inbox: {briefing.get('inbox_count', 0)} | Done yesterday: {briefing.get('completed_yesterday', 0)}"}]})

    fallback = f"Daily Briefing — {briefing['date']}: {len(briefing.get('overdue', []))} overdue, {briefing.get('total_active', 0)} active"
    result = _slack_api("chat.postMessage", {"channel": channel_id, "text": fallback, "blocks": blocks})
    return {
        "success": result.get("ok", False),
        "channel": channel_id,
        "ts": result.get("ts"),
        "error": result.get("error") if not result.get("ok") else None,
    }


@router.get("/channels")
def list_channels():
    """Return configured Slack channels from notification-routes.json."""
    routes = convex_db.get_notification_routes()
    if not routes:
        return {"channels": []}
    slack_cfg = routes.get("slack", {})
    channels = slack_cfg.get("channels", {})
    return {
        "channels": [{"name": name, "id": cid} for name, cid in channels.items()],
        "default": slack_cfg.get("default_channel"),
    }
