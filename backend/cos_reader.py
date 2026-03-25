"""
Bridge between CoS workspace JSON files and the dashboard API.
Reads live data from /home/mansigambhir/.openclaw/workspace/data/
"""
import os
import json
import glob
from datetime import date, datetime
from pathlib import Path
from typing import Optional

COS_WORKSPACE = os.getenv("COS_WORKSPACE", "/home/mansigambhir/.openclaw/workspace")
DATA_DIR = os.path.join(COS_WORKSPACE, "data")


def _read_json(filepath: str) -> Optional[dict]:
    """Read and parse a single JSON file, returning None on failure."""
    try:
        with open(filepath, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _write_json(filepath: str, data: dict):
    """Write data to a JSON file, creating parent dirs if needed."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, default=str)


def _read_all_in_dir(dirpath: str, prefix: str = "", suffix: str = ".json") -> list[dict]:
    """Read all JSON files in a directory matching an optional prefix."""
    results = []
    pattern = os.path.join(dirpath, f"{prefix}*{suffix}")
    for filepath in sorted(glob.glob(pattern)):
        basename = os.path.basename(filepath)
        if basename == "counter.json":
            continue
        data = _read_json(filepath)
        if data is not None:
            results.append(data)
    return results


# ---------- Follow-ups ----------

def get_all_followups() -> list[dict]:
    """Read all FU-*.json files from data/follow-ups/."""
    return _read_all_in_dir(os.path.join(DATA_DIR, "follow-ups"), prefix="FU-")


def get_followup(fu_id: str) -> Optional[dict]:
    """Read a single follow-up by ID (e.g. FU-0001)."""
    return _read_json(os.path.join(DATA_DIR, "follow-ups", f"{fu_id}.json"))


def write_followup(fu_id: str, data: dict):
    """Write a follow-up JSON file."""
    _write_json(os.path.join(DATA_DIR, "follow-ups", f"{fu_id}.json"), data)


def get_followup_counter() -> int:
    """Get the next follow-up counter value."""
    counter = _read_json(os.path.join(DATA_DIR, "follow-ups", "counter.json"))
    return counter.get("next", 1) if counter else 1


def increment_followup_counter() -> int:
    """Increment and return the next follow-up counter."""
    counter_path = os.path.join(DATA_DIR, "follow-ups", "counter.json")
    current = get_followup_counter()
    _write_json(counter_path, {"next": current + 1})
    return current


# ---------- Voice Updates ----------

def get_all_voice_updates() -> list[dict]:
    """Read all VU-*.json files from data/voice/."""
    return _read_all_in_dir(os.path.join(DATA_DIR, "voice"), prefix="VU-")


def get_voice_update(vu_id: str) -> Optional[dict]:
    """Read a single voice update by ID (e.g. VU-0001)."""
    return _read_json(os.path.join(DATA_DIR, "voice", f"{vu_id}.json"))


def write_voice_update(vu_id: str, data: dict):
    """Write a voice update JSON file."""
    _write_json(os.path.join(DATA_DIR, "voice", f"{vu_id}.json"), data)


def get_voice_counter() -> int:
    """Get the next voice update counter value."""
    counter = _read_json(os.path.join(DATA_DIR, "voice", "counter.json"))
    return counter.get("next", 1) if counter else 1


def increment_voice_counter() -> int:
    """Increment and return the next voice update counter."""
    counter_path = os.path.join(DATA_DIR, "voice", "counter.json")
    current = get_voice_counter()
    _write_json(counter_path, {"next": current + 1})
    return current


# ---------- Clients ----------

def get_all_clients() -> list[dict]:
    """Read all client JSON files from data/clients/."""
    return _read_all_in_dir(os.path.join(DATA_DIR, "clients"))


def get_client(slug: str) -> Optional[dict]:
    """Read a single client by slug."""
    return _read_json(os.path.join(DATA_DIR, "clients", f"{slug}.json"))


def write_client(slug: str, data: dict):
    """Write a client JSON file."""
    _write_json(os.path.join(DATA_DIR, "clients", f"{slug}.json"), data)


# ---------- Decisions ----------

def get_all_decisions() -> list[dict]:
    """Read all DEC-*.json files from data/decisions/."""
    return _read_all_in_dir(os.path.join(DATA_DIR, "decisions"), prefix="DEC-")


def get_decision(dec_id: str) -> Optional[dict]:
    """Read a single decision by ID."""
    return _read_json(os.path.join(DATA_DIR, "decisions", f"{dec_id}.json"))


# ---------- Board Snapshots ----------

def get_board_snapshot(snapshot_date: Optional[str] = None) -> Optional[dict]:
    """Read board snapshot for a given date (YYYY-MM-DD). Defaults to latest available."""
    board_dir = os.path.join(DATA_DIR, "board", "snapshots")
    if snapshot_date:
        return _read_json(os.path.join(board_dir, f"{snapshot_date}.json"))
    # Find latest
    files = sorted(glob.glob(os.path.join(board_dir, "*.json")), reverse=True)
    if files:
        return _read_json(files[0])
    return None


def get_eod_snapshot(snapshot_date: Optional[str] = None) -> Optional[dict]:
    """Read EOD board snapshot for a given date."""
    eod_dir = os.path.join(DATA_DIR, "board-snapshots")
    if snapshot_date:
        return _read_json(os.path.join(eod_dir, f"{snapshot_date}-eod.json"))
    # Find latest
    files = sorted(glob.glob(os.path.join(eod_dir, "*-eod.json")), reverse=True)
    if files:
        return _read_json(files[0])
    return None


# ---------- Performance ----------

def get_performance_data() -> list[dict]:
    """Read all performance evaluations from data/performance/*/."""
    results = []
    perf_dir = os.path.join(DATA_DIR, "performance")
    if not os.path.isdir(perf_dir):
        return results
    for person_dir in sorted(os.listdir(perf_dir)):
        person_path = os.path.join(perf_dir, person_dir)
        if not os.path.isdir(person_path):
            continue
        for filepath in sorted(glob.glob(os.path.join(person_path, "*.json")), reverse=True):
            data = _read_json(filepath)
            if data is not None:
                results.append(data)
    return results


def get_person_performance(person: str) -> Optional[dict]:
    """Read the latest performance evaluation for a person."""
    person_dir = os.path.join(DATA_DIR, "performance", person)
    if not os.path.isdir(person_dir):
        return None
    files = sorted(glob.glob(os.path.join(person_dir, "*.json")), reverse=True)
    if files:
        return _read_json(files[0])
    return None


# ---------- Sprint ----------

def get_active_sprint() -> Optional[dict]:
    """Read sprint/active.json."""
    return _read_json(os.path.join(DATA_DIR, "sprint", "active.json"))


# ---------- Tasks ----------

def get_all_tasks() -> list[dict]:
    """Read all task JSON files from data/tasks/."""
    return _read_all_in_dir(os.path.join(DATA_DIR, "tasks"))


def get_task(task_id: str) -> Optional[dict]:
    """Read a single task by ID."""
    return _read_json(os.path.join(DATA_DIR, "tasks", f"{task_id}.json"))


# ---------- Meetings ----------

def get_meetings(meeting_date: Optional[str] = None) -> Optional[dict]:
    """Read meetings for a given date. Defaults to today."""
    if not meeting_date:
        meeting_date = date.today().isoformat()
    return _read_json(os.path.join(DATA_DIR, "meetings", f"{meeting_date}.json"))


# ---------- Team / Config ----------

def get_notification_routes() -> Optional[dict]:
    """Read config/notification-routes.json."""
    return _read_json(os.path.join(DATA_DIR, "config", "notification-routes.json"))


def get_team_roster() -> list[dict]:
    """Build team roster from notification-routes.json contacts + ceo info."""
    config = get_notification_routes()
    if not config:
        return []

    contacts = config.get("contacts", {})
    ceo_info = config.get("ceo", {})

    # Role mapping from known data
    role_map = {
        "yatharth": "CEO",
        "mansi": "AI Engineer",
        "shivam": "Lead Engineer",
        "naveen": "Frontend Engineer",
        "ankit": "Backend Engineer",
        "rahul": "Advisor",
    }

    # Name mapping — pull from performance data if available, else use config
    name_map = {
        "yatharth": ceo_info.get("name", "Yatharth Garg"),
    }
    # Enrich from performance data
    for perf in get_performance_data():
        slug = perf.get("person", "")
        if slug and perf.get("name"):
            name_map[slug] = perf["name"]

    roster = []
    for slug, contact in contacts.items():
        roster.append({
            "slug": slug,
            "name": name_map.get(slug, slug.capitalize()),
            "role": role_map.get(slug, "Team Member"),
            "email": contact.get("email"),
            "slack_id": contact.get("slack_id"),
            "slack_handle": contact.get("slack"),
        })
    return roster


# ---------- Vault ----------

def get_vault_entries() -> list[dict]:
    """Read all vault JSON files from data/vault/ recursively."""
    results = []
    vault_dir = os.path.join(DATA_DIR, "vault")
    if not os.path.isdir(vault_dir):
        return results
    for filepath in sorted(glob.glob(os.path.join(vault_dir, "**", "*.json"), recursive=True)):
        data = _read_json(filepath)
        if data is not None:
            results.append(data)
    return results
