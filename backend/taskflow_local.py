"""Local JSON CRUD for TaskFlow — fallback when external TaskFlow API is unavailable."""

import json
import os
from datetime import date, datetime, timedelta
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


def _normalize_task(data: dict) -> dict:
    """Normalize legacy CoS task fields to TaskFlow format.

    CoS tasks (NE-001, CONFIG-001) use different field names:
      due → when_date (also used as deadline)
      desc/description → notes
      owner/assignee → assigned_to
      project (string name) → project_name
      todo/blocked → valid active statuses
      labels → tags (if tags missing)
    """
    # Dates: CoS uses 'due', TaskFlow uses 'when_date' + 'deadline'
    if "when_date" not in data and "due" in data:
        data["when_date"] = data["due"]
    if "deadline" not in data and "due" in data:
        data["deadline"] = data["due"]

    # Notes: CoS uses 'desc' or 'description'
    if "notes" not in data:
        data["notes"] = data.get("desc", data.get("description", ""))

    # Assignee: CoS uses 'owner' or 'assignee'
    if "assigned_to" not in data:
        data["assigned_to"] = data.get("owner", data.get("assignee", ""))

    # Project: CoS uses string 'project', TaskFlow uses 'project_id'
    if "project_name" not in data and "project" in data and isinstance(data["project"], str):
        data["project_name"] = data["project"]

    # Tags: CoS may use 'labels' instead of 'tags'
    if "tags" not in data and "labels" in data:
        data["tags"] = data["labels"]
    if "tags" not in data:
        data["tags"] = []

    # Status normalization: 'todo' and 'blocked' are valid active statuses
    status = data.get("status", "")
    if status in ("todo", "blocked", "open", "in_progress"):
        data["_is_active"] = True
    elif status in ("completed", "resolved", "done"):
        data["status"] = "completed"
        data["_is_active"] = False
    elif status == "trashed":
        data["_is_active"] = False
    elif status == "inbox" or not status:
        data["_is_active"] = True
    else:
        data["_is_active"] = True

    # Priority: ensure consistent format
    priority = data.get("priority", data.get("priority_hint", ""))
    data["priority"] = priority

    return data


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
                tasks.append(_normalize_task(data))
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

COMPLETED_STATUSES = ("completed", "resolved", "done")
TRASHED_STATUSES = ("trashed",)
ACTIVE_STATUSES = ("open", "in_progress", "todo", "blocked", "active", "inbox")


def _is_active(t: dict) -> bool:
    return t.get("_is_active", True) and t.get("status") not in COMPLETED_STATUSES + TRASHED_STATUSES


def list_tasks(view: str = "all") -> list[dict]:
    """List tasks filtered by smart view."""
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()

    if view == "all":
        return [t for t in all_tasks if t.get("status") not in TRASHED_STATUSES]

    if view == "today":
        result = []
        for t in all_tasks:
            if not _is_active(t):
                continue
            when = t.get("when_date")
            deadline = t.get("deadline")
            is_today = t.get("is_today")
            # Matches: date is today, OR overdue, OR flagged as today
            if (when == today_str
                or is_today is True
                or (when and when < today_str)  # overdue
                or (deadline and deadline <= today_str)):
                result.append(t)
        return result

    if view == "inbox":
        return [
            t for t in all_tasks
            if _is_active(t)
            and t.get("status") in ("inbox", "", None)
            and not t.get("when_date")
            and not t.get("project_id")
            and not t.get("is_today")
        ]

    if view == "upcoming":
        return [
            t for t in all_tasks
            if _is_active(t)
            and t.get("when_date") and t["when_date"] > today_str
        ]

    if view == "anytime":
        # Active tasks with no specific date and not someday — includes todo/blocked
        return [
            t for t in all_tasks
            if _is_active(t)
            and not t.get("is_someday")
            and not t.get("when_date")
            and t.get("status") not in ("inbox", "", None)
        ]

    if view == "someday":
        return [
            t for t in all_tasks
            if t.get("is_someday") is True
            and _is_active(t)
        ]

    if view == "logbook":
        return [t for t in all_tasks if t.get("status") in COMPLETED_STATUSES]

    if view == "trash":
        return [t for t in all_tasks if t.get("status") in TRASHED_STATUSES]

    # Default: everything non-trashed
    return [t for t in all_tasks if t.get("status") not in TRASHED_STATUSES]


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

    active = [t for t in all_tasks if _is_active(t)]
    overdue = [
        t for t in active
        if (t.get("when_date") and t["when_date"] < today_str)
        or (t.get("deadline") and t["deadline"] < today_str)
    ]
    due_today = [
        t for t in active
        if t.get("when_date") == today_str or t.get("deadline") == today_str
    ]
    completed = [t for t in all_tasks if t.get("status") in COMPLETED_STATUSES]
    completed_today = [
        t for t in completed
        if (t.get("completed_at") or "")[:10] == today_str
    ]
    inbox = [
        t for t in all_tasks
        if _is_active(t)
        and t.get("status") in ("inbox", "", None)
        and not t.get("when_date") and not t.get("project_id")
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
        "id": f"proj-{data.get('name', '').lower().replace(' ', '-')[:20] or len(projects) + 1}",
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


# --- Organize CRUD (update/delete for projects, areas, tags) ---

def update_project(project_id: str, data: dict) -> Optional[dict]:
    projects = _read_meta("projects")
    for p in projects:
        if p["id"] == project_id:
            for k, v in data.items():
                if k != "id":
                    p[k] = v
            _write_meta("projects", projects)
            return p
    return None


def delete_project(project_id: str) -> bool:
    projects = _read_meta("projects")
    filtered = [p for p in projects if p["id"] != project_id]
    if len(filtered) == len(projects):
        return False
    _write_meta("projects", filtered)
    return True


def create_area(data: dict) -> dict:
    areas = _read_meta("areas")
    area = {
        "id": f"area-{data.get('name', '').lower().replace(' ', '-')[:20] or len(areas) + 1}",
        "name": data.get("name", ""),
        "color": data.get("color", "#818cf8"),
        "icon": data.get("icon"),
    }
    areas.append(area)
    _write_meta("areas", areas)
    return area


def update_area(area_id: str, data: dict) -> Optional[dict]:
    areas = _read_meta("areas")
    for a in areas:
        if a["id"] == area_id:
            for k, v in data.items():
                if k != "id":
                    a[k] = v
            _write_meta("areas", areas)
            return a
    return None


def delete_area(area_id: str) -> bool:
    areas = _read_meta("areas")
    filtered = [a for a in areas if a["id"] != area_id]
    if len(filtered) == len(areas):
        return False
    _write_meta("areas", filtered)
    return True


def create_tag(data: dict) -> dict:
    tags = _read_meta("tags")
    name = data.get("name", "")
    tag = {
        "id": f"tag-{name.lower().replace(' ', '-')[:20]}",
        "name": name,
        "slug": name.lower().replace(" ", "-"),
        "color": data.get("color", "#9ca3af"),
    }
    tags.append(tag)
    _write_meta("tags", tags)
    return tag


def update_tag(tag_id: str, data: dict) -> Optional[dict]:
    tags = _read_meta("tags")
    for t in tags:
        if t["id"] == tag_id:
            for k, v in data.items():
                if k != "id":
                    t[k] = v
            _write_meta("tags", tags)
            return t
    return None


def delete_tag(tag_id: str) -> bool:
    tags = _read_meta("tags")
    filtered = [t for t in tags if t["id"] != tag_id]
    if len(filtered) == len(tags):
        return False
    _write_meta("tags", filtered)
    return True


# --- Analytics ---

def get_workload_scores() -> list[dict]:
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()
    d3 = (date.today() + timedelta(days=3)).isoformat()
    d7 = (date.today() + timedelta(days=7)).isoformat()
    active = [t for t in all_tasks if _is_active(t)]

    by_person: dict[str, list[dict]] = {}
    for t in active:
        who = t.get("assigned_to") or t.get("owner") or "unassigned"
        by_person.setdefault(who, []).append(t)

    scores = []
    for person, tasks in by_person.items():
        overdue = 0
        today_count = 0
        weighted = 0
        for t in tasks:
            dl = t.get("when_date") or t.get("deadline")
            weighted += 1  # base
            if dl and dl < today_str:
                overdue += 1
                days_over = (date.today() - date.fromisoformat(dl)).days
                weighted += min(3 + days_over, 13)
            elif dl == today_str:
                today_count += 1
                weighted += 3
            elif dl and dl <= d3:
                weighted += 2
            elif dl and dl <= d7:
                weighted += 1
        scores.append({
            "person": person, "task_count": len(tasks),
            "overdue_count": overdue, "today_count": today_count, "weighted_score": weighted,
        })
    scores.sort(key=lambda x: x["weighted_score"], reverse=True)
    return scores


def get_team_health() -> dict:
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()
    week_ago = (date.today() - timedelta(days=7)).isoformat()
    d7 = (date.today() + timedelta(days=7)).isoformat()

    active = [t for t in all_tasks if _is_active(t)]
    total = len(all_tasks)
    completed = [t for t in all_tasks if t.get("status") in COMPLETED_STATUSES]
    overdue = [t for t in active if (t.get("when_date") or t.get("deadline") or "") < today_str and (t.get("when_date") or t.get("deadline"))]
    approaching = [t for t in active if (t.get("deadline") or "") > today_str and (t.get("deadline") or "") <= d7]
    inbox = [t for t in all_tasks if _is_active(t) and t.get("status") in ("inbox", "", None) and not t.get("when_date")]
    completed_week = [t for t in completed if (t.get("completed_at") or "")[:10] >= week_ago]
    created_week = [t for t in all_tasks if (t.get("created") or "")[:10] >= week_ago]

    overdue_pct = len(overdue) / max(len(active), 1)
    inbox_pct = len(inbox) / max(len(active), 1)
    completion_rate = len(completed) / max(total, 1)
    health = max(0, min(100, round(100 - (overdue_pct * 40) - (inbox_pct * 20) - ((1 - completion_rate) * 40))))
    velocity = round(len(completed_week) / 7, 2)

    return {
        "health_score": health, "total_active": len(active), "overdue": len(overdue),
        "approaching_deadline": len(approaching), "inbox": len(inbox),
        "completed_this_week": len(completed_week), "created_this_week": len(created_week),
        "velocity": velocity, "completion_rate": round(completion_rate * 100),
    }


def get_risk_flags() -> dict:
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()
    projects = list_projects()

    project_risks = []
    for p in projects:
        ptasks = [t for t in all_tasks if t.get("project_id") == p["id"]]
        active_p = [t for t in ptasks if _is_active(t)]
        overdue_p = [t for t in active_p if (t.get("when_date") or t.get("deadline") or "") < today_str and (t.get("when_date") or t.get("deadline"))]
        reasons = []
        if len(overdue_p) > 0:
            reasons.append(f"{len(overdue_p)} overdue task(s)")
        if len(active_p) > 5:
            reasons.append(f"High task load ({len(active_p)})")
        risk = "high" if len(overdue_p) >= 2 else "medium" if len(overdue_p) >= 1 or len(active_p) > 5 else "low"
        if reasons:
            project_risks.append({"project_id": p["id"], "project_name": p["name"], "risk_level": risk, "reasons": reasons})

    overdue_tasks = []
    for t in all_tasks:
        if not _is_active(t):
            continue
        dl = t.get("when_date") or t.get("deadline")
        if dl and dl < today_str:
            overdue_tasks.append({
                "task_id": t["id"], "title": t.get("title", ""),
                "deadline": dl, "overdue_days": (date.today() - date.fromisoformat(dl)).days,
                "project": t.get("project_name", ""),
            })

    return {"project_risks": project_risks, "overdue_tasks": overdue_tasks, "total_risks": len(project_risks) + len(overdue_tasks)}


def get_velocity(period_days: int = 7) -> dict:
    all_tasks = _read_all_tasks()
    cutoff = (date.today() - timedelta(days=period_days)).isoformat()
    completed = [t for t in all_tasks if t.get("status") in COMPLETED_STATUSES and (t.get("completed_at") or "")[:10] >= cutoff]
    created = [t for t in all_tasks if (t.get("created") or "")[:10] >= cutoff]
    vel = round(len(completed) / max(period_days, 1), 2)
    cpd = round(len(created) / max(period_days, 1), 2)
    return {
        "period_days": period_days, "completed": len(completed), "created": len(created),
        "velocity": vel, "created_per_day": cpd, "net_velocity": round(vel - cpd, 2),
    }


def get_project_burndown(project_id: str) -> dict:
    all_tasks = _read_all_tasks()
    projects = list_projects()
    proj = next((p for p in projects if p["id"] == project_id), None)
    ptasks = [t for t in all_tasks if t.get("project_id") == project_id]
    total = len(ptasks)
    done = len([t for t in ptasks if t.get("status") in COMPLETED_STATUSES])
    remaining = total - done
    series = []
    for i in range(30):
        d = (date.today() - timedelta(days=29 - i)).isoformat()
        completed_by = len([t for t in ptasks if t.get("status") in COMPLETED_STATUSES and (t.get("completed_at") or "")[:10] <= d])
        series.append({"date": d, "remaining": total - completed_by, "completed": completed_by})
    return {
        "project_id": project_id, "project_name": proj["name"] if proj else project_id,
        "total_tasks": total, "completed_tasks": done, "remaining_tasks": remaining,
        "completion_pct": round((done / max(total, 1)) * 100), "series": series,
    }


# --- Briefing ---

def get_daily_briefing() -> dict:
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    week_ahead = (date.today() + timedelta(days=7)).isoformat()

    active = [t for t in all_tasks if _is_active(t)]
    overdue = []
    for t in active:
        dl = t.get("when_date") or t.get("deadline")
        if dl and dl < today_str:
            overdue.append({**t, "overdue_days": (date.today() - date.fromisoformat(dl)).days})
    overdue.sort(key=lambda x: x.get("when_date") or x.get("deadline") or "")

    today_tasks = [t for t in active if (t.get("when_date") == today_str or t.get("is_today") or t.get("deadline") == today_str) and t not in [o for o in overdue]]

    approaching = []
    for t in active:
        dl = t.get("deadline")
        if dl and dl > today_str and dl <= week_ahead:
            approaching.append({**t, "days_until": (date.fromisoformat(dl) - date.today()).days})
    approaching.sort(key=lambda x: x.get("deadline") or "")

    completed_all = [t for t in all_tasks if t.get("status") in COMPLETED_STATUSES]
    completed_yesterday = len([t for t in completed_all if (t.get("completed_at") or "")[:10] == yesterday])
    inbox_count = len([t for t in all_tasks if _is_active(t) and t.get("status") in ("inbox", "", None) and not t.get("when_date")])

    return {
        "date": today_str,
        "overdue": [{"id": t["id"], "title": t.get("title"), "assignee": t.get("assigned_to") or t.get("owner"), "deadline": t.get("when_date") or t.get("deadline"), "overdue_days": t.get("overdue_days", 0)} for t in overdue],
        "today": [{"id": t["id"], "title": t.get("title"), "assignee": t.get("assigned_to") or t.get("owner"), "deadline": t.get("deadline")} for t in today_tasks],
        "approaching": [{"id": t["id"], "title": t.get("title"), "assignee": t.get("assigned_to") or t.get("owner"), "deadline": t.get("deadline"), "days_until": t.get("days_until", 0)} for t in approaching],
        "completed_yesterday": completed_yesterday,
        "inbox_count": inbox_count,
        "total_active": len(active),
    }


def get_team_briefing() -> dict:
    all_tasks = _read_all_tasks()
    today_str = date.today().isoformat()
    active = [t for t in all_tasks if _is_active(t)]

    by_person: dict[str, dict] = {}
    for t in active:
        who = t.get("assigned_to") or t.get("owner") or "unassigned"
        if who not in by_person:
            by_person[who] = {"name": who, "overdue": 0, "today": 0, "total_active": 0}
        by_person[who]["total_active"] += 1
        dl = t.get("when_date") or t.get("deadline")
        if dl and dl < today_str:
            by_person[who]["overdue"] += 1
        elif dl == today_str or t.get("is_today"):
            by_person[who]["today"] += 1

    team = sorted(by_person.values(), key=lambda x: x["overdue"], reverse=True)
    return {"date": today_str, "team": team}
