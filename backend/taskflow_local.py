"""Local JSON CRUD for TaskFlow — fallback when external TaskFlow API is unavailable."""

import json
import os
from datetime import date, datetime
from typing import Optional

COS_WORKSPACE = os.getenv("COS_WORKSPACE", "/home/mansigambhir/.openclaw/workspace")
TASKS_DIR = os.path.join(COS_WORKSPACE, "data", "tasks")
META_DIR = os.path.join(COS_WORKSPACE, "data", "taskflow-meta")


def _ensure_dirs():
    os.makedirs(TASKS_DIR, exist_ok=True)
    os.makedirs(META_DIR, exist_ok=True)


def _read_json(path: str) -> Optional[dict]:
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write_json(path: str, data):
    _ensure_dirs()
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)


def _read_all_tasks() -> list[dict]:
    """Read all task JSON files from data/tasks/."""
    if not os.path.isdir(TASKS_DIR):
        return []
    tasks = []
    for fname in sorted(os.listdir(TASKS_DIR)):
        if fname.endswith(".json") and fname != "counter.json":
            data = _read_json(os.path.join(TASKS_DIR, fname))
            if data and isinstance(data, dict):
                if "id" not in data:
                    data["id"] = fname.replace(".json", "")
                tasks.append(data)
    return tasks


def _get_counter() -> int:
    path = os.path.join(META_DIR, "counter.json")
    data = _read_json(path)
    return data.get("next", 1) if data else 1


def _increment_counter() -> int:
    _ensure_dirs()
    path = os.path.join(META_DIR, "counter.json")
    current = _get_counter()
    _write_json(path, {"next": current + 1})
    return current


# --- Task CRUD ---

def list_tasks(view: str = "all") -> list[dict]:
    """List tasks filtered by smart view."""
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()

    if view == "all":
        return [t for t in all_tasks if t.get("status") not in ("trashed",)]

    if view == "today":
        return [
            t for t in all_tasks
            if t.get("status") not in ("completed", "trashed")
            and (
                t.get("when_date") == today_str
                or t.get("is_today") is True
                or (t.get("due") and t["due"] < today_str and t.get("status") not in ("completed", "trashed"))
                or (t.get("deadline") and t["deadline"] == today_str)
            )
        ]

    if view == "inbox":
        return [
            t for t in all_tasks
            if t.get("status") in ("inbox", None, "")
            and not t.get("when_date")
            and not t.get("project_id")
            and not t.get("is_today")
            and t.get("status") not in ("completed", "trashed")
        ]

    if view == "upcoming":
        return [
            t for t in all_tasks
            if t.get("status") not in ("completed", "trashed")
            and t.get("when_date") and t["when_date"] > today_str
        ]

    if view == "anytime":
        return [
            t for t in all_tasks
            if t.get("status") not in ("completed", "trashed", "inbox")
            and not t.get("is_someday")
            and not t.get("when_date")
        ]

    if view == "someday":
        return [
            t for t in all_tasks
            if t.get("is_someday") is True
            and t.get("status") not in ("completed", "trashed")
        ]

    if view == "logbook":
        return [t for t in all_tasks if t.get("status") == "completed"]

    if view == "trash":
        return [t for t in all_tasks if t.get("status") == "trashed"]

    # Default: active non-trashed
    return [t for t in all_tasks if t.get("status") not in ("trashed",)]


def get_task(task_id: str) -> Optional[dict]:
    path = os.path.join(TASKS_DIR, f"{task_id}.json")
    return _read_json(path)


def create_task(data: dict) -> dict:
    """Create a new task. Returns the created task dict."""
    _ensure_dirs()
    num = _increment_counter()
    task_id = f"TF-{num:04d}"

    now = datetime.utcnow().isoformat()
    task = {
        "id": task_id,
        "title": data.get("title", ""),
        "notes": data.get("notes", ""),
        "status": "inbox" if not data.get("when_date") and not data.get("project_id") else "active",
        "when_date": data.get("when_date"),
        "deadline": data.get("deadline"),
        "is_today": data.get("is_today", False),
        "is_someday": data.get("is_someday", False),
        "project_id": data.get("project_id"),
        "area_id": data.get("area_id"),
        "tags": data.get("tags", []),
        "priority_hint": data.get("priority_hint", ""),
        "checklist_items": data.get("checklist_items", []),
        "owner": data.get("owner", data.get("assigned_to", "")),
        "source": data.get("source", "dashboard"),
        "created": now,
        "updated": now,
        "completed_at": None,
        "trashed_at": None,
    }

    _write_json(os.path.join(TASKS_DIR, f"{task_id}.json"), task)
    return task


def update_task(task_id: str, data: dict) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    for key, val in data.items():
        if key != "id":
            task[key] = val
    task["updated"] = datetime.utcnow().isoformat()
    # Auto-transition inbox → active
    if task.get("status") == "inbox" and (task.get("when_date") or task.get("project_id") or task.get("is_today")):
        task["status"] = "active"
    _write_json(os.path.join(TASKS_DIR, f"{task_id}.json"), task)
    return task


def complete_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "completed"
    task["completed_at"] = datetime.utcnow().isoformat()
    task["updated"] = datetime.utcnow().isoformat()
    _write_json(os.path.join(TASKS_DIR, f"{task_id}.json"), task)
    return task


def uncomplete_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "active"
    task["completed_at"] = None
    task["updated"] = datetime.utcnow().isoformat()
    _write_json(os.path.join(TASKS_DIR, f"{task_id}.json"), task)
    return task


def trash_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "trashed"
    task["trashed_at"] = datetime.utcnow().isoformat()
    task["updated"] = datetime.utcnow().isoformat()
    _write_json(os.path.join(TASKS_DIR, f"{task_id}.json"), task)
    return task


def restore_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "active"
    task["trashed_at"] = None
    task["updated"] = datetime.utcnow().isoformat()
    _write_json(os.path.join(TASKS_DIR, f"{task_id}.json"), task)
    return task


def get_summary() -> dict:
    """Get daily summary stats."""
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()

    active = [t for t in all_tasks if t.get("status") not in ("completed", "trashed")]
    overdue = [
        t for t in active
        if (t.get("due") and t["due"] < today_str) or (t.get("deadline") and t["deadline"] < today_str)
    ]
    due_today = [
        t for t in active
        if t.get("when_date") == today_str or t.get("deadline") == today_str
    ]
    completed = [t for t in all_tasks if t.get("status") == "completed"]
    completed_today = [
        t for t in completed
        if t.get("completed_at", "")[:10] == today_str
    ]
    inbox = [
        t for t in all_tasks
        if t.get("status") in ("inbox", None, "")
        and not t.get("when_date") and not t.get("project_id")
        and t.get("status") not in ("completed", "trashed")
    ]

    return {
        "overdue": len(overdue),
        "due_today": len(due_today),
        "completed_today": len(completed_today),
        "inbox": len(inbox),
        "total_active": len(active),
    }


# --- Projects, Areas, Tags (local meta storage) ---

def _read_meta(name: str) -> list[dict]:
    path = os.path.join(META_DIR, f"{name}.json")
    data = _read_json(path)
    return data if isinstance(data, list) else []


def _write_meta(name: str, items: list[dict]):
    _ensure_dirs()
    _write_json(os.path.join(META_DIR, f"{name}.json"), items)


def list_projects() -> list[dict]:
    projects = _read_meta("projects")
    if not projects:
        # Seed with defaults
        projects = [
            {"id": "proj-cos", "name": "Chief of Staff", "color": "#818cf8", "status": "active"},
            {"id": "proj-breakfree", "name": "Breakfree", "color": "#4ade80", "status": "active"},
            {"id": "proj-vonalbert", "name": "Von Albert", "color": "#facc15", "status": "active"},
        ]
        _write_meta("projects", projects)
    # Count tasks per project
    all_tasks = _read_all_tasks()
    for p in projects:
        p["task_count"] = len([t for t in all_tasks if t.get("project_id") == p["id"] and t.get("status") not in ("completed", "trashed")])
        p["completed_count"] = len([t for t in all_tasks if t.get("project_id") == p["id"] and t.get("status") == "completed"])
    return projects


def create_project(data: dict) -> dict:
    projects = _read_meta("projects")
    project = {
        "id": f"proj-{len(projects) + 1}",
        "name": data.get("name", ""),
        "notes": data.get("notes", ""),
        "color": data.get("color", "#818cf8"),
        "status": "active",
        "area_id": data.get("area_id"),
        "deadline": data.get("deadline"),
    }
    projects.append(project)
    _write_meta("projects", projects)
    return project


def list_areas() -> list[dict]:
    areas = _read_meta("areas")
    if not areas:
        areas = [
            {"id": "area-work", "name": "Work", "color": "#818cf8", "icon": "briefcase"},
            {"id": "area-clients", "name": "Clients", "color": "#4ade80", "icon": "users"},
        ]
        _write_meta("areas", areas)
    return areas


def list_tags() -> list[dict]:
    tags = _read_meta("tags")
    if not tags:
        tags = [
            {"id": "tag-urgent", "name": "urgent", "slug": "urgent", "color": "#f87171"},
            {"id": "tag-p0", "name": "P0", "slug": "p0", "color": "#ef4444"},
            {"id": "tag-p1", "name": "P1", "slug": "p1", "color": "#f97316"},
            {"id": "tag-blocked", "name": "blocked", "slug": "blocked", "color": "#f87171"},
            {"id": "tag-sprint", "name": "sprint", "slug": "sprint", "color": "#818cf8"},
        ]
        _write_meta("tags", tags)
    return tags
