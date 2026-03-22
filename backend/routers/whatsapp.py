"""WhatsApp integration via Twilio WhatsApp API."""

import os
import urllib.request
import urllib.parse
import base64
import json
from typing import Optional
from fastapi import APIRouter, Query
from pydantic import BaseModel
import cos_reader
import taskflow_local

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])

TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "")  # e.g. whatsapp:+14155238886


def _is_configured() -> bool:
    return bool(TWILIO_SID and TWILIO_TOKEN and TWILIO_FROM)


def _send_whatsapp(to: str, body: str) -> dict:
    """Send WhatsApp message via Twilio API."""
    if not _is_configured():
        return {"success": False, "error": "Twilio WhatsApp not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM in .env"}

    # Ensure whatsapp: prefix
    if not to.startswith("whatsapp:"):
        to = f"whatsapp:{to}"
    from_num = TWILIO_FROM if TWILIO_FROM.startswith("whatsapp:") else f"whatsapp:{TWILIO_FROM}"

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
    data = urllib.parse.urlencode({
        "From": from_num,
        "To": to,
        "Body": body,
    }).encode()

    auth = base64.b64encode(f"{TWILIO_SID}:{TWILIO_TOKEN}".encode()).decode()
    req = urllib.request.Request(url, data=data, headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/x-www-form-urlencoded",
    })

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            return {"success": True, "sid": result.get("sid", ""), "status": result.get("status", "")}
    except urllib.error.HTTPError as e:
        body_err = e.read().decode() if e.fp else ""
        try:
            err = json.loads(body_err)
            return {"success": False, "error": err.get("message", f"HTTP {e.code}")}
        except json.JSONDecodeError:
            return {"success": False, "error": f"HTTP {e.code}: {body_err[:200]}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _format_briefing_wa(briefing: dict) -> str:
    """Format daily briefing for WhatsApp (uses WhatsApp markdown: *bold*, _italic_)."""
    lines = [f"☀️ *Daily Briefing — {briefing['date']}*", ""]

    if briefing.get("overdue"):
        lines.append(f"⚠️ *Overdue ({len(briefing['overdue'])})*")
        for t in briefing["overdue"]:
            lines.append(f"• {t['title']} — _{t.get('assignee', '?')}_ ({t.get('overdue_days', '?')}d)")
        lines.append("")

    if briefing.get("today"):
        lines.append(f"✅ *Today ({len(briefing['today'])})*")
        for t in briefing["today"]:
            lines.append(f"• {t['title']}")
        lines.append("")

    if briefing.get("approaching"):
        lines.append(f"📅 *Approaching ({len(briefing['approaching'])})*")
        for t in briefing["approaching"]:
            lines.append(f"• {t['title']} — _{t.get('assignee', '?')}_ ({t.get('days_until', '?')}d)")
        lines.append("")

    lines.append(f"_Active: {briefing.get('total_active', 0)} | Inbox: {briefing.get('inbox_count', 0)} | Done yesterday: {briefing.get('completed_yesterday', 0)}_")
    return "\n".join(lines)


# --- Schemas ---

class SendRequest(BaseModel):
    to: str  # phone number with country code, e.g. +919876543210
    message: str


class BulkSendRequest(BaseModel):
    to: list[str]
    message: str


# --- Endpoints ---

@router.get("/config")
def whatsapp_config():
    return {
        "configured": _is_configured(),
        "from": TWILIO_FROM if _is_configured() else None,
        "provider": "twilio",
    }


@router.post("/send")
def send_message(req: SendRequest):
    result = _send_whatsapp(req.to, req.message)
    return {"to": req.to, **result}


@router.post("/send-bulk")
def send_bulk(req: BulkSendRequest):
    results = []
    for phone in req.to:
        r = _send_whatsapp(phone, req.message)
        results.append({"to": phone, **r})
    sent = sum(1 for r in results if r.get("success"))
    return {"sent": sent, "total": len(req.to), "results": results}


@router.post("/briefing")
def send_briefing(to: str = Query(None)):
    """Generate TaskFlow daily briefing and send via WhatsApp."""
    briefing = taskflow_local.get_daily_briefing()
    body = _format_briefing_wa(briefing)

    if to:
        result = _send_whatsapp(to, body)
        return {"to": to, **result, "preview": body}

    # Send to CEO by default
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"error": "No notification routes configured"}

    contacts = routes.get("contacts", {})
    ceo = contacts.get("yatharth", {})
    phone = ceo.get("whatsapp") or ceo.get("phone")
    if not phone:
        return {"error": "No WhatsApp number for CEO. Add 'whatsapp' field to yatharth in notification-routes.json", "preview": body}

    result = _send_whatsapp(phone, body)
    return {"to": phone, **result, "preview": body}


@router.post("/overdue")
def send_overdue_alerts():
    """Send per-person overdue alerts via WhatsApp."""
    briefing = taskflow_local.get_daily_briefing()
    if not briefing.get("overdue"):
        return {"status": "nothing_to_send", "overdue_count": 0}

    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"error": "No notification routes configured"}

    contacts = routes.get("contacts", {})
    by_person: dict[str, list] = {}
    for t in briefing["overdue"]:
        who = t.get("assignee") or "unassigned"
        by_person.setdefault(who, []).append(t)

    results = []
    for person, items in by_person.items():
        contact = contacts.get(person, {})
        phone = contact.get("whatsapp") or contact.get("phone")
        if not phone:
            results.append({"person": person, "status": "skipped", "reason": "no whatsapp number"})
            continue
        msg = f"⚠️ *Overdue Tasks — {person}*\n\n"
        for t in items:
            msg += f"• {t['title']} ({t.get('overdue_days', '?')}d overdue)\n"
        msg += "\n_Please update status in the dashboard._"
        r = _send_whatsapp(phone, msg)
        results.append({"person": person, "phone": phone, **r})

    sent = sum(1 for r in results if r.get("success"))
    return {"sent": sent, "results": results}


@router.post("/notify")
def notify_by_priority(priority: str = Query("P0"), message: str = Query("")):
    """Send WhatsApp message based on notification-routes.json priority routing."""
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"error": "No notification routes configured"}

    contacts = routes.get("contacts", {})
    route_map = routes.get("routes", {})
    results = []

    for person, person_routes in route_map.items():
        channels = person_routes.get(priority, [])
        if "whatsapp" not in channels:
            continue
        contact = contacts.get(person, {})
        phone = contact.get("whatsapp") or contact.get("phone")
        if not phone:
            results.append({"person": person, "status": "skipped", "reason": "no whatsapp number"})
            continue
        r = _send_whatsapp(phone, message or f"[{priority}] Notification from NeuralEDGE CoS")
        results.append({"person": person, "phone": phone, **r})

    sent = sum(1 for r in results if r.get("success"))
    return {"priority": priority, "sent": sent, "results": results}


@router.get("/contacts")
def get_whatsapp_contacts():
    """Return team contacts with WhatsApp numbers from notification-routes.json."""
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"contacts": []}
    contacts = routes.get("contacts", {})
    return {
        "contacts": [
            {"slug": slug, "whatsapp": info.get("whatsapp") or info.get("phone"), "email": info.get("email")}
            for slug, info in contacts.items()
        ]
    }
