"""TaskFlow service — Convex database as sole data source.

Drop-in replacement for taskflow_local.py. Same function signatures,
same return shapes. Reads/writes Convex only — no local JSON files.
"""

from datetime import date, datetime, timedelta
from typing import Optional
import convex_db


# --- Constants ---

COMPLETED_STATUSES = ("completed", "resolved", "done")
TRASHED_STATUSES = ("trashed",)
ACTIVE_STATUSES = ("open", "in_progress", "todo", "blocked", "active", "inbox")


# --- Helpers ---

def _normalize_task(data: dict) -> dict:
    """Normalize Convex task record to the shape consumers expect.

    Convex stores 'task_id' but consumers expect 'id'.
    Also compute _is_active and ensure all expected fields exist.
    """
    # Map task_id → id for consumer compatibility
    if "task_id" in data and "id" not in data:
        data["id"] = data["task_id"]

    # Ensure basic fields exist
    data.setdefault("notes", "")
    data.setdefault("tags", [])
    data.setdefault("checklist_items", [])
    data.setdefault("priority_hint", "")

    # Assignee alias
    if "assigned_to" not in data:
        data["assigned_to"] = data.get("owner", "")

    # Project name alias
    if "project_name" not in data and "project" in data and isinstance(data["project"], str):
        data["project_name"] = data["project"]

    # Status normalization
    status = data.get("status", "")
    if status in ("todo", "blocked", "open", "in_progress", "active", "inbox", ""):
        data["_is_active"] = True
    elif status in COMPLETED_STATUSES:
        data["_is_active"] = False
    elif status in TRASHED_STATUSES:
        data["_is_active"] = False
    else:
        data["_is_active"] = True

    # Priority alias
    data["priority"] = data.get("priority", data.get("priority_hint", ""))

    return data


def _is_active(t: dict) -> bool:
    return t.get("_is_active", True) and t.get("status") not in COMPLETED_STATUSES + TRASHED_STATUSES


def _read_all_tasks() -> list[dict]:
    """Read all tasks from Convex and normalize."""
    raw = convex_db.list_tasks() or []
    tasks = []
    for t in raw:
        # Strip Convex internal fields
        task = {k: v for k, v in t.items() if not k.startswith("_")}
        tasks.append(_normalize_task(task))
    return tasks


# --- Task CRUD ---

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
            if (when == today_str
                or is_today is True
                or (when and when < today_str)
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

    return [t for t in all_tasks if t.get("status") not in TRASHED_STATUSES]


def get_task(task_id: str) -> Optional[dict]:
    task = convex_db.get_task(task_id)
    if not task:
        return None
    result = {k: v for k, v in task.items() if not k.startswith("_")}
    return _normalize_task(result)


def create_task(data: dict) -> dict:
    """Create a new task. Returns the created task dict."""
    num = convex_db.increment_counter("task")
    if not num:
        num = 1
    task_id = f"TF-{int(num):04d}"

    now = datetime.utcnow().isoformat()
    status = "inbox" if not data.get("when_date") and not data.get("project_id") else "active"

    task = {
        "id": task_id,
        "title": data.get("title", ""),
        "notes": data.get("notes", ""),
        "status": status,
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

    # Write to Convex
    cvx = {k: v for k, v in task.items() if v is not None and k != "id"}
    cvx["task_id"] = task_id
    cvx["status"] = status
    convex_db.create_task(cvx)

    return task


def update_task(task_id: str, data: dict) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    for key, val in data.items():
        if key not in ("id", "task_id"):
            task[key] = val
    task["updated"] = datetime.utcnow().isoformat()
    # Auto-transition inbox → active
    if task.get("status") == "inbox" and (task.get("when_date") or task.get("project_id") or task.get("is_today")):
        task["status"] = "active"

    # Write to Convex
    cvx_updates = {k: v for k, v in data.items() if k not in ("id", "task_id") and v is not None}
    cvx_updates["updated"] = task["updated"]
    if "status" in task:
        cvx_updates["status"] = task["status"]
    convex_db.update_task(task_id, cvx_updates)

    return task


def complete_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "completed"
    task["completed_at"] = datetime.utcnow().isoformat()
    task["updated"] = datetime.utcnow().isoformat()
    convex_db.complete_task(task_id)
    return task


def uncomplete_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "active"
    task["completed_at"] = None
    task["updated"] = datetime.utcnow().isoformat()
    convex_db.uncomplete_task(task_id)
    return task


def toggle_task_checklist(task_id: str, item_index: int) -> Optional[dict]:
    """Toggle a checklist item on a task. Auto-complete if all done, reopen if unchecked."""
    task = get_task(task_id)
    if not task:
        return None
    items = task.get("checklist_items") or []
    if item_index < 0 or item_index >= len(items):
        return None
    items[item_index]["is_completed"] = not items[item_index].get("is_completed", False)
    task["checklist_items"] = items
    task["updated"] = datetime.utcnow().isoformat()
    # Auto-complete if all items done
    if items and all(ci.get("is_completed") for ci in items):
        task["status"] = "completed"
        task["completed_at"] = datetime.utcnow().isoformat()
    elif task.get("status") == "completed":
        task["status"] = "active"
        task["completed_at"] = None

    # Write to Convex
    cvx_items = [{"title": ci.get("title", ""), "is_completed": ci.get("is_completed", False)} for ci in items]
    cvx_updates = {"checklist_items": cvx_items, "updated": task["updated"], "status": task["status"]}
    if task.get("completed_at"):
        cvx_updates["completed_at"] = task["completed_at"]
    convex_db.update_task(task_id, cvx_updates)

    return task


def trash_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "trashed"
    task["trashed_at"] = datetime.utcnow().isoformat()
    task["updated"] = datetime.utcnow().isoformat()
    convex_db.trash_task(task_id)
    return task


def restore_task(task_id: str) -> Optional[dict]:
    task = get_task(task_id)
    if not task:
        return None
    task["status"] = "active"
    task["trashed_at"] = None
    task["updated"] = datetime.utcnow().isoformat()
    convex_db.restore_task(task_id)
    return task


# --- Summary ---

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


# --- Projects, Areas, Tags ---

def list_projects() -> list[dict]:
    projects = convex_db.list_projects() or []
    # Normalize id field
    for p in projects:
        if "project_id" in p and "id" not in p:
            p["id"] = p["project_id"]
    # Count tasks per project
    all_tasks = _read_all_tasks()
    for p in projects:
        pid = p.get("id") or p.get("project_id")
        p["task_count"] = len([t for t in all_tasks if t.get("project_id") == pid and t.get("status") not in ("completed", "trashed")])
        p["completed_count"] = len([t for t in all_tasks if t.get("project_id") == pid and t.get("status") == "completed"])
    return projects


def create_project(data: dict) -> dict:
    project_id = f"proj-{data.get('name', '').lower().replace(' ', '-')[:20]}"
    project = {
        "project_id": project_id,
        "name": data.get("name", ""),
        "color": data.get("color", "#818cf8"),
        "status": "active",
    }
    if data.get("notes"):
        project["notes"] = data["notes"]
    if data.get("area_id"):
        project["area_id"] = data["area_id"]
    if data.get("deadline"):
        project["deadline"] = data["deadline"]
    convex_db.create_project(project)
    project["id"] = project_id
    return project


def list_areas() -> list[dict]:
    areas = convex_db.list_areas() or []
    for a in areas:
        if "area_id" in a and "id" not in a:
            a["id"] = a["area_id"]
    if not areas:
        # Seed defaults
        defaults = [
            {"area_id": "area-work", "name": "Work", "color": "#818cf8", "icon": "briefcase"},
            {"area_id": "area-clients", "name": "Clients", "color": "#4ade80", "icon": "users"},
        ]
        for d in defaults:
            convex_db.create_area(d)
            d["id"] = d["area_id"]
        return defaults
    return areas


def list_tags() -> list[dict]:
    tags = convex_db.list_tags() or []
    for t in tags:
        if "tag_id" in t and "id" not in t:
            t["id"] = t["tag_id"]
    if not tags:
        # Seed defaults
        defaults = [
            {"tag_id": "tag-urgent", "name": "urgent", "slug": "urgent", "color": "#f87171"},
            {"tag_id": "tag-p0", "name": "P0", "slug": "p0", "color": "#ef4444"},
            {"tag_id": "tag-p1", "name": "P1", "slug": "p1", "color": "#f97316"},
            {"tag_id": "tag-blocked", "name": "blocked", "slug": "blocked", "color": "#f87171"},
            {"tag_id": "tag-sprint", "name": "sprint", "slug": "sprint", "color": "#818cf8"},
        ]
        for d in defaults:
            convex_db.create_tag(d)
            d["id"] = d["tag_id"]
        return defaults
    return tags


def update_project(project_id: str, data: dict) -> Optional[dict]:
    convex_db.update_project(project_id, {k: v for k, v in data.items() if k not in ("id", "project_id")})
    # Return updated
    projects = list_projects()
    return next((p for p in projects if p.get("id") == project_id or p.get("project_id") == project_id), None)


def delete_project(project_id: str) -> bool:
    result = convex_db.delete_project(project_id)
    return result is not None


def create_area(data: dict) -> dict:
    area_id = f"area-{data.get('name', '').lower().replace(' ', '-')[:20]}"
    area = {
        "area_id": area_id,
        "name": data.get("name", ""),
        "color": data.get("color", "#818cf8"),
    }
    if data.get("icon"):
        area["icon"] = data["icon"]
    convex_db.create_area(area)
    area["id"] = area_id
    return area


def update_area(area_id: str, data: dict) -> Optional[dict]:
    convex_db.update_area(area_id, {k: v for k, v in data.items() if k not in ("id", "area_id")})
    areas = list_areas()
    return next((a for a in areas if a.get("id") == area_id or a.get("area_id") == area_id), None)


def delete_area(area_id: str) -> bool:
    result = convex_db.delete_area(area_id)
    return result is not None


def create_tag(data: dict) -> dict:
    name = data.get("name", "")
    tag_id = f"tag-{name.lower().replace(' ', '-')[:20]}"
    tag = {
        "tag_id": tag_id,
        "name": name,
        "slug": name.lower().replace(" ", "-"),
        "color": data.get("color", "#9ca3af"),
    }
    convex_db.create_tag(tag)
    tag["id"] = tag_id
    return tag


def update_tag(tag_id: str, data: dict) -> Optional[dict]:
    convex_db.update_tag(tag_id, {k: v for k, v in data.items() if k not in ("id", "tag_id")})
    tags = list_tags()
    return next((t for t in tags if t.get("id") == tag_id or t.get("tag_id") == tag_id), None)


def delete_tag(tag_id: str) -> bool:
    result = convex_db.delete_tag(tag_id)
    return result is not None


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
            weighted += 1
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
        pid = p.get("id") or p.get("project_id")
        ptasks = [t for t in all_tasks if t.get("project_id") == pid]
        active_p = [t for t in ptasks if _is_active(t)]
        overdue_p = [t for t in active_p if (t.get("when_date") or t.get("deadline") or "") < today_str and (t.get("when_date") or t.get("deadline"))]
        reasons = []
        if len(overdue_p) > 0:
            reasons.append(f"{len(overdue_p)} overdue task(s)")
        if len(active_p) > 5:
            reasons.append(f"High task load ({len(active_p)})")
        risk = "high" if len(overdue_p) >= 2 else "medium" if len(overdue_p) >= 1 or len(active_p) > 5 else "low"
        if reasons:
            project_risks.append({"project_id": pid, "project_name": p["name"], "risk_level": risk, "reasons": reasons})

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
    proj = next((p for p in projects if p.get("id") == project_id or p.get("project_id") == project_id), None)
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
