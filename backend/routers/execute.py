"""Execution router — delegates actions to OpenClaw gateway."""

import time
import uuid
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

import gateway

router = APIRouter(prefix="/api", tags=["execute"])


# Action key → instruction template.
# Templates can use {arg_name} placeholders filled from request args.
ACTION_MAP = {
    "send_overdue_alerts": (
        "Send P0 overdue alert emails to all team members who have overdue follow-ups. "
        "Use the notification router with P0 priority routing. Send immediately."
    ),
    "daily_digest_ceo": (
        "Send the daily morning briefing digest email to the CEO at yatharth@synlex.tech. "
        "Include overdue items, meetings today, sprint status, and at-risk clients."
    ),
    "sprint_status_team": (
        "Send the current sprint status update email to all team members who have email addresses. "
        "Include sprint progress percentage, goals, and days remaining."
    ),
    "p1_followup_reminders": (
        "Send P1 follow-up reminder emails to team members who have pending P1 follow-ups. "
        "Use the notification router with P1 priority routing."
    ),
    "send_email": (
        "Send an email to {to} with subject '{subject}'. Body:\n{body}"
    ),
    "send_multi_email": (
        "Send an email to the following recipients: {to}. Subject: '{subject}'. Body:\n{body}"
    ),
    "create_followup": (
        "Create a new follow-up item: {what}. Assign to {who}, due date {due}, priority {priority}."
    ),
    "resolve_followup": (
        "Resolve follow-up {fu_id} and mark it as completed."
    ),
    "send_meeting_notes": (
        "Fetch the Fireflies transcript {transcript_id} and email the meeting notes to {recipients}."
    ),
    "send_sprint_updates": (
        "Send sprint updates for week '{week}' via {channel}."
    ),
    "list_transcripts": (
        "List the {limit} most recent Fireflies transcripts using the fireflies-notetaker skill "
        "with --json flag. Return the raw JSON output."
    ),
    "get_transcript": (
        "Get the full Fireflies transcript with ID {transcript_id} using the fireflies-notetaker skill "
        "with --json flag. Include summary, action items, outline, keywords, and sentences. "
        "Return the raw JSON output."
    ),
    "search_transcripts": (
        "Search Fireflies transcripts for the keyword '{keyword}' using the fireflies-notetaker skill "
        "with --json flag. Return up to {limit} results as raw JSON."
    ),
    "get_action_items": (
        "Get action items from the {limit} most recent Fireflies transcripts using the "
        "fireflies-notetaker skill with --json flag. Return the raw JSON output."
    ),
    "analyze_meeting": (
        "Fetch the Fireflies transcript with ID {transcript_id} and analyze it. "
        "Identify key decisions, risks, sentiment (positive/neutral/negative/mixed with score 1-10), "
        "notable quotes with speaker names, and provide a 2-3 sentence executive summary. "
        "Return as a JSON object."
    ),
    "post_standup": (
        "Post a daily standup update for {person}. "
        "What they accomplished: {done}. "
        "What they are working on: {doing}. "
        "Blockers: {blockers}. "
        "Mood: {mood}."
    ),
    "update_standup": (
        "Update today's standup for {person}. "
        "Changes: done={done}, doing={doing}, blockers={blockers}, mood={mood}."
    ),
    "send_standup_reminder": (
        "Send standup reminders to all team members who haven't posted their daily update yet. "
        "Use Slack DMs and WhatsApp where available."
    ),
    "toggle_checklist_item": (
        "Toggle checklist item {item_index} on follow-up {fu_id}. "
        "If unchecked, mark as completed. If checked, uncheck it. "
        "If all items are completed, resolve the follow-up."
    ),
    "edit_followup": (
        "Update follow-up {fu_id}. Set: what={what}, who={who}, due={due}, priority={priority}."
    ),
    "delete_followup": (
        "Delete follow-up {fu_id} permanently."
    ),
    "update_followup_status": (
        "Update the status of follow-up {fu_id} to {status}."
    ),
}


class ExecuteRequest(BaseModel):
    action: str
    args: Optional[dict] = {}


@router.post("/execute")
async def execute_action(req: ExecuteRequest):
    """Execute an action via OpenClaw gateway."""
    start = time.time()

    template = ACTION_MAP.get(req.action)
    if not template:
        return {
            "success": False,
            "error": f"Unknown action: {req.action}",
            "available_actions": list(ACTION_MAP.keys()),
        }

    # Build the instruction from template + args (escape braces in user text)
    try:
        safe_args = {}
        for k, v in (req.args or {}).items():
            safe_args[k] = str(v).replace("{", "{{").replace("}", "}}") if isinstance(v, str) else v
        instruction = template.format(**safe_args)
    except KeyError as e:
        return {"success": False, "error": f"Missing required arg: {e}"}

    result = await gateway.execute(instruction)
    result["action"] = req.action
    result["execution_id"] = str(uuid.uuid4())[:8]
    result["duration_ms"] = int((time.time() - start) * 1000)

    # Remove raw gateway response from client-facing output
    result.pop("raw", None)

    return result


@router.get("/gateway/status")
async def gateway_status():
    """Check OpenClaw gateway connectivity."""
    return await gateway.health()
