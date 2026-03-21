"""Email sender — mirrors the real CoS scripts/email/smtp.py logic."""

import re
import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import cos_reader

router = APIRouter(prefix="/api/email", tags=["email"])

SMTP_HOST = os.getenv("SMTP_HOST", "email-smtp.us-east-1.amazonaws.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER_NAME", "")
SMTP_PASS = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "connect@customerconnect.site")


# --- Markdown-to-HTML (ported from CoS smtp.py) ---

def _inline_format(text: str) -> str:
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
    text = re.sub(
        r'`(.+?)`',
        r'<code style="background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 13px;">\1</code>',
        text,
    )
    return text


def markdown_to_html(text: str) -> str:
    """Convert markdown body to branded NeuralEDGE HTML email."""
    lines = text.split("\n")
    html_lines = []
    in_list = False
    in_checklist = False

    for line in lines:
        stripped = line.strip()

        if stripped in ("---", "***", "___"):
            if in_list or in_checklist:
                html_lines.append("</ul>")
                in_list = in_checklist = False
            html_lines.append('<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">')
            continue

        if stripped.startswith("### "):
            if in_list or in_checklist:
                html_lines.append("</ul>"); in_list = in_checklist = False
            html_lines.append(f'<h3 style="color: #1a1a1a; font-size: 15px; font-weight: 600; margin: 18px 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif;">{stripped[4:]}</h3>')
            continue
        if stripped.startswith("## "):
            if in_list or in_checklist:
                html_lines.append("</ul>"); in_list = in_checklist = False
            html_lines.append(f'<h2 style="color: #1a1a1a; font-size: 17px; font-weight: 600; margin: 22px 0 10px 0; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif;">{stripped[3:]}</h2>')
            continue
        if stripped.startswith("# "):
            if in_list or in_checklist:
                html_lines.append("</ul>"); in_list = in_checklist = False
            html_lines.append(f'<h1 style="color: #1a1a1a; font-size: 20px; font-weight: 600; margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', sans-serif;">{stripped[2:]}</h1>')
            continue

        if stripped.startswith("- [ ] ") or stripped.startswith("- [x] "):
            if not in_checklist:
                if in_list:
                    html_lines.append("</ul>"); in_list = False
                html_lines.append('<ul style="list-style: none; padding-left: 0; margin: 8px 0;">')
                in_checklist = True
            checked = stripped.startswith("- [x] ")
            item = stripped[6:]
            icon = "✅" if checked else "☐"
            color = "#888" if checked else "#1a1a1a"
            dec = "line-through" if checked else "none"
            html_lines.append(f'<li style="padding: 4px 0; color: {color}; text-decoration: {dec}; font-size: 14px;">{icon}&nbsp;&nbsp;{_inline_format(item)}</li>')
            continue

        if stripped.startswith("- ") or stripped.startswith("* "):
            if not in_list:
                if in_checklist:
                    html_lines.append("</ul>"); in_checklist = False
                html_lines.append('<ul style="padding-left: 20px; margin: 8px 0; color: #1a1a1a;">')
                in_list = True
            html_lines.append(f'<li style="padding: 3px 0; font-size: 14px;">{_inline_format(stripped[2:])}</li>')
            continue

        if in_list:
            html_lines.append("</ul>"); in_list = False
        if in_checklist:
            html_lines.append("</ul>"); in_checklist = False

        if not stripped:
            html_lines.append('<div style="height: 8px;"></div>')
            continue

        html_lines.append(f'<p style="margin: 4px 0; font-size: 14px; color: #333; line-height: 1.5;">{_inline_format(stripped)}</p>')

    if in_list:
        html_lines.append("</ul>")
    if in_checklist:
        html_lines.append("</ul>")

    body_html = "\n".join(html_lines)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background-color: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f7; padding: 30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden;">
        <tr><td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px 32px;">
          <p style="margin: 0; color: #ffffff; font-size: 11px; font-weight: 500; letter-spacing: 1.5px; text-transform: uppercase;">NeuralEDGE</p>
          <p style="margin: 4px 0 0 0; color: rgba(255,255,255,0.7); font-size: 11px;">Chief of Staff</p>
        </td></tr>
        <tr><td style="padding: 28px 32px 32px 32px;">
          {body_html}
        </td></tr>
        <tr><td style="padding: 16px 32px; background-color: #fafafa; border-top: 1px solid #f0f0f0;">
          <p style="margin: 0; font-size: 11px; color: #999; text-align: center;">NeuralEDGE &middot; Your AI Partners &middot; Chief of Staff Agent</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def strip_markdown(text: str) -> str:
    text = re.sub(r'^#{1,3}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'^- \[ \] ', '  ☐ ', text, flags=re.MULTILINE)
    text = re.sub(r'^- \[x\] ', '  ✓ ', text, flags=re.MULTILINE)
    text = re.sub(r'^---$', '─' * 40, text, flags=re.MULTILINE)
    return text


# --- Core send function ---

def send_email(to: str, subject: str, body: str, sender: str = None, plain_only: bool = False) -> dict:
    """Send email via AWS SES SMTP — identical to CoS smtp.py logic."""
    if not SMTP_USER or not SMTP_PASS:
        return {"success": False, "error": "SMTP credentials not configured (SMTP_USER_NAME / SMTP_PASSWORD missing)"}

    sender = sender or SMTP_FROM

    msg = MIMEMultipart("alternative")
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject

    # Always attach plain text
    plain_text = strip_markdown(body) if not plain_only else body
    msg.attach(MIMEText(plain_text, "plain"))

    # Attach branded HTML unless plain_only
    if not plain_only:
        html = markdown_to_html(body)
        msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(sender, to, msg.as_string())
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


# --- API schemas ---

class EmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    plain: Optional[bool] = False


class MultiEmailRequest(BaseModel):
    to: list[str]
    subject: str
    body: str
    plain: Optional[bool] = False


# --- Endpoints ---

@router.post("/send")
def api_send_email(req: EmailRequest):
    """Send a single email with markdown body → branded HTML."""
    result = send_email(to=req.to, subject=req.subject, body=req.body, plain_only=req.plain or False)
    return {
        "status": "sent" if result["success"] else "failed",
        "from": SMTP_FROM,
        "to": req.to,
        "subject": req.subject,
        **result,
    }


@router.post("/send-multi")
def api_send_multi(req: MultiEmailRequest):
    """Send to multiple recipients."""
    results = []
    for recipient in req.to:
        r = send_email(to=recipient, subject=req.subject, body=req.body, plain_only=req.plain or False)
        results.append({"to": recipient, **r})
    sent = sum(1 for r in results if r["success"])
    return {
        "status": "sent" if sent == len(req.to) else "partial" if sent > 0 else "failed",
        "from": SMTP_FROM,
        "sent": sent,
        "total": len(req.to),
        "results": results,
    }


@router.post("/notify")
def api_notify_by_priority(priority: str = "P1", subject: str = "Notification", body: str = ""):
    """Send email based on notification-routes.json priority routing."""
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"error": "notification-routes.json not found"}

    contacts = routes.get("contacts", {})
    route_map = routes.get("routes", {})
    results = []

    for person, person_routes in route_map.items():
        channels = person_routes.get(priority, [])
        if "email" not in channels:
            continue
        contact = contacts.get(person, {})
        email_addr = contact.get("email")
        if not email_addr:
            results.append({"person": person, "status": "skipped", "reason": "no email"})
            continue
        r = send_email(to=email_addr, subject=subject, body=body)
        results.append({"person": person, "email": email_addr, **r})

    return {
        "priority": priority,
        "sent": sum(1 for r in results if r.get("success")),
        "results": results,
    }


@router.get("/contacts")
def get_email_contacts():
    """Return team contacts from notification-routes.json."""
    routes = cos_reader.get_notification_routes()
    if not routes:
        return {"contacts": []}

    contacts = routes.get("contacts", {})
    result = []
    for slug, info in contacts.items():
        result.append({
            "slug": slug,
            "email": info.get("email"),
            "slack_id": info.get("slack_id"),
            "slack": info.get("slack"),
        })
    return {
        "contacts": result,
        "default_from": routes.get("defaults", {}).get("from_email", SMTP_FROM),
    }


class PreviewRequest(BaseModel):
    body: str


@router.post("/preview")
def preview_email(req: PreviewRequest):
    """Return the branded HTML rendering of a markdown body (no send)."""
    html = markdown_to_html(req.body)
    return {"html": html}


@router.get("/schedule")
def get_email_schedule():
    """Return the auto-email schedule."""
    return {
        "timezone": "Asia/Kolkata (IST)",
        "jobs": [
            {"time": "09:00", "name": "Morning Briefing", "to": "yatharth@synlex.tech", "description": "Daily briefing with overdue items, meetings, sprint status"},
            {"time": "10:00", "name": "Overdue Alerts", "to": "per-person (from notification-routes)", "description": "Email team members who have overdue follow-ups"},
            {"time": "18:00", "name": "EOD Summary", "to": "yatharth@synlex.tech", "description": "End of day resolved/open/overdue counts"},
        ],
        "active": True,
    }


@router.get("/config")
def get_email_config():
    """Return email config status."""
    return {
        "from": SMTP_FROM,
        "host": SMTP_HOST,
        "port": SMTP_PORT,
        "configured": bool(SMTP_USER and SMTP_PASS),
    }
