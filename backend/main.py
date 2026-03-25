import asyncio
import json
import os
from pathlib import Path
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from routers import pulse, followups, performance, clients, sprint, briefing, tasks, meetings, vault, email, fireflies, gmail, execute, taskflow, whatsapp, slack, standups, voice
import cos_reader
import convex_db

# Initialize DB tables if PostgreSQL is available (legacy fallback)
try:
    from database import engine, Base
    Base.metadata.create_all(bind=engine)
except Exception:
    print("[STARTUP] PostgreSQL not available — using Convex/CoS JSON only")

app = FastAPI(title="NeuralEDGE CoS Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pulse.router)
app.include_router(followups.router)
app.include_router(performance.router)
app.include_router(clients.router)
app.include_router(sprint.router)
app.include_router(briefing.router)
app.include_router(tasks.router)
app.include_router(meetings.router)
app.include_router(vault.router)
app.include_router(email.router)
app.include_router(fireflies.router)
app.include_router(gmail.router)
app.include_router(execute.router)
app.include_router(taskflow.router)
app.include_router(whatsapp.router)
app.include_router(slack.router)
app.include_router(standups.router)
app.include_router(voice.router)


@app.get("/")
def root():
    return {"service": "NeuralEDGE CoS Dashboard API", "status": "running"}


# --- WebSocket live updates ---

connected_clients: Set[WebSocket] = set()

# Map directory names to update types
DIR_TYPE_MAP = {
    "follow-ups": "followup_update",
    "clients": "client_update",
    "board": "board_update",
    "board-snapshots": "board_update",
    "performance": "performance_update",
    "sprint": "sprint_update",
    "tasks": "task_update",
    "meetings": "meeting_update",
    "decisions": "decision_update",
    "vault": "vault_update",
    "config": "config_update",
    "standups": "standup_update",
    "voice": "voice_update",
}


def _detect_change_type(filepath: str) -> str:
    """Determine the update type from the file path."""
    rel = filepath.replace(cos_reader.DATA_DIR, "").lstrip(os.sep)
    parts = rel.split(os.sep)
    if parts:
        return DIR_TYPE_MAP.get(parts[0], "unknown_update")
    return "unknown_update"


async def broadcast(message: dict):
    """Send a message to all connected WebSocket clients."""
    dead = set()
    text = json.dumps(message, default=str)
    for ws in connected_clients:
        try:
            await ws.send_text(text)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


async def watch_workspace():
    """Poll the CoS workspace data/ directory for file changes every 2 seconds."""
    data_dir = cos_reader.DATA_DIR
    if not os.path.isdir(data_dir):
        return

    # Build initial snapshot of modification times
    file_mtimes: dict[str, float] = {}
    for root, dirs, files in os.walk(data_dir):
        for f in files:
            if f.endswith(".json"):
                fp = os.path.join(root, f)
                try:
                    file_mtimes[fp] = os.path.getmtime(fp)
                except OSError:
                    pass

    while True:
        await asyncio.sleep(2)

        current_files: dict[str, float] = {}
        for root, dirs, files in os.walk(data_dir):
            for f in files:
                if f.endswith(".json"):
                    fp = os.path.join(root, f)
                    try:
                        current_files[fp] = os.path.getmtime(fp)
                    except OSError:
                        pass

        # Detect changes
        changes = []

        # New or modified files
        for fp, mtime in current_files.items():
            if fp not in file_mtimes or file_mtimes[fp] != mtime:
                change_type = _detect_change_type(fp)
                try:
                    with open(fp, "r") as fh:
                        data = json.load(fh)
                except (json.JSONDecodeError, OSError):
                    data = {}
                changes.append({
                    "type": change_type,
                    "file": os.path.basename(fp),
                    "data": data,
                })

        # Deleted files
        for fp in set(file_mtimes.keys()) - set(current_files.keys()):
            change_type = _detect_change_type(fp)
            changes.append({
                "type": change_type,
                "file": os.path.basename(fp),
                "data": None,
                "deleted": True,
            })

        file_mtimes = current_files

        # Broadcast changes
        if changes and connected_clients:
            for change in changes:
                await broadcast(change)


@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await ws.accept()
    connected_clients.add(ws)
    try:
        while True:
            # Keep connection alive; client can send pings
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        connected_clients.discard(ws)
    except Exception:
        connected_clients.discard(ws)


async def auto_email_scheduler():
    """Background scheduler — sends automated emails at configured times (IST).

    Schedule:
      09:00 IST — Morning briefing to CEO (yatharth@synlex.tech)
      10:00 IST — Overdue follow-up alerts (P0 routing)
      18:00 IST — EOD summary to CEO
    """
    from datetime import datetime, timezone, timedelta
    from routers.email import send_email
    IST = timezone(timedelta(hours=5, minutes=30))

    sent_today: set[str] = set()
    last_date = ""

    while True:
        await asyncio.sleep(60)  # check every minute
        now = datetime.now(IST)
        today = now.strftime("%Y-%m-%d")
        hour_min = now.strftime("%H:%M")

        # Reset sent tracker at midnight
        if today != last_date:
            sent_today.clear()
            last_date = today

        # 00:01 IST — Save daily pulse snapshot
        if hour_min == "00:01" and "pulse_snapshot" not in sent_today:
            sent_today.add("pulse_snapshot")
            try:
                from routers.pulse import save_pulse_snapshot
                save_pulse_snapshot()
                print(f"[AUTO] Pulse snapshot saved at {hour_min} IST")
            except Exception as e:
                print(f"[AUTO] Pulse snapshot failed: {e}")

        # 09:00 IST — Morning briefing to CEO
        if hour_min == "09:00" and "morning" not in sent_today:
            sent_today.add("morning")
            try:
                fus = cos_reader.get_all_followups() or []
                active = [f for f in fus if f.get("status") in ("open", "in_progress")]
                overdue = [f for f in active if f.get("due") and f["due"] < today]
                mtgs = cos_reader.get_meetings(today)
                meeting_count = len((mtgs or {}).get("events", (mtgs or {}).get("meetings", [])))
                sprint = cos_reader.get_active_sprint()

                body = f"# Morning Briefing — {now.strftime('%A, %B %d')}\n\n"
                body += f"- **Active tasks:** {len(active)}\n"
                body += f"- **Overdue:** {len(overdue)}\n"
                body += f"- **Meetings today:** {meeting_count}\n"
                if sprint:
                    body += f"- **Sprint:** {sprint.get('name', '?')}\n"
                body += "\n"

                if overdue:
                    body += "### Overdue Items\n\n"
                    for f in overdue:
                        body += f"- [ ] **{f.get('id')}**: {f.get('what')} — *{f.get('who')}* (due: {f.get('due')})\n"
                    body += "\n"

                body += "---\n\n*Automated morning briefing from PULSE Command Center*"

                send_email(
                    to="yatharth@synlex.tech",
                    subject=f"Morning Briefing — {now.strftime('%B %d, %Y')}",
                    body=body,
                )
                print(f"[AUTO-EMAIL] Morning briefing sent to CEO at {hour_min} IST")
            except Exception as e:
                print(f"[AUTO-EMAIL] Morning briefing failed: {e}")

        # 10:00 IST — Overdue alerts to team (P0 routing)
        if hour_min == "10:00" and "overdue" not in sent_today:
            sent_today.add("overdue")
            try:
                fus = cos_reader.get_all_followups() or []
                active = [f for f in fus if f.get("status") in ("open", "in_progress")]
                overdue = [f for f in active if f.get("due") and f["due"] < today]

                if overdue:
                    routes = cos_reader.get_notification_routes() or {}
                    contacts = routes.get("contacts", {})
                    # Email people who have overdue items
                    notified = set()
                    for f in overdue:
                        who = f.get("who", "")
                        if who in notified:
                            continue
                        contact = contacts.get(who, {})
                        email_addr = contact.get("email")
                        if not email_addr:
                            continue
                        person_overdue = [x for x in overdue if x.get("who") == who]
                        body = f"## Overdue Follow-ups for {who}\n\n"
                        for x in person_overdue:
                            body += f"- [ ] **{x.get('id')}**: {x.get('what')} (due: {x.get('due')})\n"
                        body += "\n---\n\n*Please update status in the PULSE dashboard.*"

                        send_email(to=email_addr, subject=f"OVERDUE: {len(person_overdue)} item(s) need attention", body=body)
                        notified.add(who)

                    print(f"[AUTO-EMAIL] Overdue alerts sent to {len(notified)} people at {hour_min} IST")
            except Exception as e:
                print(f"[AUTO-EMAIL] Overdue alerts failed: {e}")

        # 11:00 IST — Standup reminder to missing members
        if hour_min == "11:00" and "standup_remind" not in sent_today:
            sent_today.add("standup_remind")
            try:
                import standup_local
                stats = standup_local.get_standup_stats()
                missing = stats.get("missing", [])
                if missing and not stats.get("is_weekend"):
                    from routers.slack import _slack_api, _resolve_user
                    for person in missing:
                        user_id = _resolve_user(person)
                        if user_id:
                            _slack_api("chat.postMessage", {
                                "channel": user_id,
                                "text": f"Hey {person} 👋 You haven't posted your standup today. Post it at the PULSE dashboard → Updates page."
                            })
                    print(f"[AUTO] Standup reminders sent to {len(missing)} people at {hour_min} IST")
            except Exception as e:
                print(f"[AUTO] Standup reminder failed: {e}")

        # 18:00 IST — EOD summary to CEO
        if hour_min == "18:00" and "eod" not in sent_today:
            sent_today.add("eod")
            try:
                fus = cos_reader.get_all_followups() or []
                resolved = [f for f in fus if f.get("status") == "resolved"]
                active = [f for f in fus if f.get("status") in ("open", "in_progress")]
                overdue = [f for f in active if f.get("due") and f["due"] < today]

                body = f"# End of Day Summary — {now.strftime('%A, %B %d')}\n\n"
                body += f"- **Resolved today:** {len(resolved)}\n"
                body += f"- **Still open:** {len(active)}\n"
                body += f"- **Overdue:** {len(overdue)}\n"
                body += "\n---\n\n*Automated EOD summary from PULSE Command Center*"

                send_email(
                    to="yatharth@synlex.tech",
                    subject=f"EOD Summary — {now.strftime('%B %d, %Y')}",
                    body=body,
                )
                print(f"[AUTO-EMAIL] EOD summary sent to CEO at {hour_min} IST")
            except Exception as e:
                print(f"[AUTO-EMAIL] EOD summary failed: {e}")


@app.on_event("startup")
async def startup_event():
    """Start the file watcher and auto-email scheduler on app startup."""
    asyncio.create_task(watch_workspace())
    asyncio.create_task(auto_email_scheduler())
    # Save today's pulse snapshot on startup
    try:
        from routers.pulse import save_pulse_snapshot
        save_pulse_snapshot()
        print("[STARTUP] Pulse snapshot saved for today")
    except Exception as e:
        print(f"[STARTUP] Pulse snapshot failed: {e}")
    print("[SCHEDULER] Auto-email scheduler started (00:01/09:00/10:00/11:00/18:00 IST)")
