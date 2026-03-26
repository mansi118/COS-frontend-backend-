"""TaskFlow task manager — dual mode: proxy to TaskFlow API or local JSON fallback."""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Optional
import taskflow_service as taskflow_local
import taskflow_client
import convex_db
from routers.email import send_email

router = APIRouter(prefix="/api/taskflow", tags=["taskflow"])


def _use_api() -> bool:
    return taskflow_client.is_available()


# --- Schemas ---

class TaskCreate(BaseModel):
    title: str
    notes: Optional[str] = ""
    when_date: Optional[str] = None
    deadline: Optional[str] = None
    is_today: Optional[bool] = False
    is_someday: Optional[bool] = False
    project_id: Optional[str] = None
    area_id: Optional[str] = None
    tags: Optional[list[str]] = None
    priority_hint: Optional[str] = ""
    checklist_items: Optional[list[dict]] = None
    owner: Optional[str] = ""
    source: Optional[str] = "dashboard"


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    when_date: Optional[str] = None
    deadline: Optional[str] = None
    is_today: Optional[bool] = None
    is_someday: Optional[bool] = None
    project_id: Optional[str] = None
    area_id: Optional[str] = None
    tags: Optional[list[str]] = None
    priority_hint: Optional[str] = None
    status: Optional[str] = None
    owner: Optional[str] = None


class ProjectCreate(BaseModel):
    name: str
    notes: Optional[str] = ""
    color: Optional[str] = "#818cf8"
    area_id: Optional[str] = None
    deadline: Optional[str] = None


# Resolve slugs to full names
_roster_cache = None
def _get_roster_map():
    global _roster_cache
    if _roster_cache is None:
        members = convex_db.list_team_members() or []
        _roster_cache = {m.get("slug"): m for m in members}
    return _roster_cache


def _enrich_tasks(tasks: list) -> list:
    """Add who_name to each task from roster."""
    for t in tasks:
        owner = t.get("owner") or t.get("assigned_to") or ""
        t["who_name"] = _get_roster_map().get(owner, {}).get("name", owner) if owner else None
    return tasks


# --- Task endpoints ---

@router.get("/tasks")
def list_tasks(view: str = Query("today")):
    if _use_api():
        data = taskflow_client.list_tasks(view=view)
        if data is not None:
            tasks = data.get("tasks", data) if isinstance(data, dict) else data
            return {"tasks": _enrich_tasks(tasks if isinstance(tasks, list) else []), "view": view, "source": "api"}
    tasks = taskflow_local.list_tasks(view=view)
    return {"tasks": _enrich_tasks(tasks), "view": view, "count": len(tasks), "source": "local"}


@router.get("/tasks/{task_id}")
def get_task(task_id: str):
    if _use_api():
        data = taskflow_client.get_task(task_id)
        if data is not None:
            return data.get("task", data) if isinstance(data, dict) else data
    task = taskflow_local.get_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return {"task": task}


@router.post("/tasks")
def create_task(data: TaskCreate):
    if _use_api():
        result = taskflow_client.create_task(data.model_dump(exclude_unset=True))
        if result is not None:
            return result
    task = taskflow_local.create_task(data.model_dump(exclude_unset=True))
    return {"task_id": task["id"], "task": task}


@router.put("/tasks/{task_id}/checklist/{item_index}/toggle")
def toggle_task_checklist_item(task_id: str, item_index: int):
    """Toggle a checklist item. Auto-completes task if all done, reopens if unchecked."""
    result = taskflow_local.toggle_task_checklist(task_id, item_index)
    if not result:
        return {"error": "Task or item not found"}
    return {"task": result}


@router.put("/tasks/{task_id}")
def update_task(task_id: str, data: TaskUpdate):
    updates = data.model_dump(exclude_unset=True)
    if _use_api():
        result = taskflow_client.update_task(task_id, updates)
        if result is not None:
            return result
    task = taskflow_local.update_task(task_id, updates)
    if not task:
        return {"error": "Task not found"}
    return {"task": task}


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: str):
    if _use_api():
        result = taskflow_client.complete_task(task_id)
        if result is not None:
            return result
    task = taskflow_local.complete_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return {"task": task}


@router.post("/tasks/{task_id}/uncomplete")
def uncomplete_task(task_id: str):
    if _use_api():
        result = taskflow_client.uncomplete_task(task_id)
        if result is not None:
            return result
    task = taskflow_local.uncomplete_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return {"task": task}


@router.post("/tasks/{task_id}/trash")
def trash_task(task_id: str):
    if _use_api():
        result = taskflow_client.trash_task(task_id)
        if result is not None:
            return result
    task = taskflow_local.trash_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return {"task": task}


@router.post("/tasks/{task_id}/restore")
def restore_task(task_id: str):
    if _use_api():
        result = taskflow_client.restore_task(task_id)
        if result is not None:
            return result
    task = taskflow_local.restore_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return {"task": task}


# --- Summary ---

@router.get("/summary")
def get_summary():
    if _use_api():
        data = taskflow_client.get_summary()
        if data is not None:
            return {**data, "source": "api"}
    return {**taskflow_local.get_summary(), "source": "local"}


# --- Projects, Areas, Tags ---

@router.get("/projects")
def list_projects():
    if _use_api():
        data = taskflow_client.list_projects()
        if data is not None:
            return data
    return {"projects": taskflow_local.list_projects()}


@router.post("/projects")
def create_project(data: ProjectCreate):
    project = taskflow_local.create_project(data.model_dump(exclude_unset=True))
    return {"project_id": project["id"], "project": project}


@router.get("/areas")
def list_areas():
    if _use_api():
        data = taskflow_client.list_areas()
        if data is not None:
            return data
    return {"areas": taskflow_local.list_areas()}


@router.get("/tags")
def list_tags():
    if _use_api():
        data = taskflow_client.list_tags()
        if data is not None:
            return data
    return {"tags": taskflow_local.list_tags()}


# --- Organize CRUD ---

class MetaUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    deadline: Optional[str] = None
    area_id: Optional[str] = None
    icon: Optional[str] = None


@router.put("/projects/{project_id}")
def update_project(project_id: str, data: MetaUpdate):
    result = taskflow_local.update_project(project_id, data.model_dump(exclude_unset=True))
    return {"project": result} if result else {"error": "Project not found"}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str):
    return {"deleted": taskflow_local.delete_project(project_id)}


@router.post("/areas")
def create_area(data: MetaUpdate):
    area = taskflow_local.create_area(data.model_dump(exclude_unset=True))
    return {"area_id": area["id"], "area": area}


@router.put("/areas/{area_id}")
def update_area(area_id: str, data: MetaUpdate):
    result = taskflow_local.update_area(area_id, data.model_dump(exclude_unset=True))
    return {"area": result} if result else {"error": "Area not found"}


@router.delete("/areas/{area_id}")
def delete_area(area_id: str):
    return {"deleted": taskflow_local.delete_area(area_id)}


@router.post("/tags")
def create_tag(data: MetaUpdate):
    tag = taskflow_local.create_tag(data.model_dump(exclude_unset=True))
    return {"tag_id": tag["id"], "tag": tag}


@router.put("/tags/{tag_id}")
def update_tag(tag_id: str, data: MetaUpdate):
    result = taskflow_local.update_tag(tag_id, data.model_dump(exclude_unset=True))
    return {"tag": result} if result else {"error": "Tag not found"}


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: str):
    return {"deleted": taskflow_local.delete_tag(tag_id)}


# --- Analytics ---

@router.get("/analytics/workload")
def analytics_workload():
    return {"workload": taskflow_local.get_workload_scores()}


@router.get("/analytics/team-health")
def analytics_team_health():
    return taskflow_local.get_team_health()


@router.get("/analytics/risk-flags")
def analytics_risk_flags():
    return taskflow_local.get_risk_flags()


@router.get("/analytics/velocity")
def analytics_velocity(period: str = Query("7d")):
    days = int(period.replace("d", "")) if period.endswith("d") else 7
    return taskflow_local.get_velocity(days)


@router.get("/analytics/burndown")
def analytics_burndown(project_id: str = Query(...)):
    return taskflow_local.get_project_burndown(project_id)


# --- Briefing ---

@router.get("/briefing/daily")
def briefing_daily():
    return taskflow_local.get_daily_briefing()


@router.get("/briefing/team")
def briefing_team():
    return taskflow_local.get_team_briefing()


# --- Notifications ---

class NotifyCustom(BaseModel):
    to: str
    subject: str
    body: str


@router.post("/notify/briefing")
def notify_briefing():
    """Generate daily briefing and email to team."""
    briefing = taskflow_local.get_daily_briefing()
    routes = convex_db.get_notification_routes()
    if not routes:
        return {"error": "No notification routes configured"}

    body = f"# TaskFlow Daily Briefing — {briefing['date']}\n\n"
    if briefing["overdue"]:
        body += f"### Overdue ({len(briefing['overdue'])})\n\n"
        for t in briefing["overdue"]:
            body += f"- [ ] **{t['id']}**: {t['title']} — *{t.get('assignee', '?')}* ({t['overdue_days']}d overdue)\n"
        body += "\n"
    if briefing["today"]:
        body += f"### Today ({len(briefing['today'])})\n\n"
        for t in briefing["today"]:
            body += f"- {t['title']}\n"
        body += "\n"
    if briefing["approaching"]:
        body += f"### Approaching Deadlines ({len(briefing['approaching'])})\n\n"
        for t in briefing["approaching"]:
            body += f"- {t['title']} — *{t.get('assignee', '?')}* ({t['days_until']}d)\n"
        body += "\n"
    body += f"---\n\n*Completed yesterday: {briefing['completed_yesterday']} | Inbox: {briefing['inbox_count']} | Active: {briefing['total_active']}*"

    contacts = routes.get("contacts", {})
    team_emails = [c["email"] for c in contacts.values() if c.get("email")]
    results = []
    for email in team_emails:
        r = send_email(to=email, subject=f"TaskFlow Briefing — {briefing['date']}", body=body)
        results.append({"to": email, **r})
    sent = sum(1 for r in results if r.get("success"))
    return {"status": "sent" if sent else "failed", "sent": sent, "total": len(team_emails), "results": results}


@router.post("/notify/overdue")
def notify_overdue():
    """Send per-person overdue alerts."""
    briefing = taskflow_local.get_daily_briefing()
    routes = convex_db.get_notification_routes()
    if not routes or not briefing["overdue"]:
        return {"status": "nothing_to_send", "overdue_count": 0}

    contacts = routes.get("contacts", {})
    by_person: dict[str, list] = {}
    for t in briefing["overdue"]:
        who = t.get("assignee") or "unassigned"
        by_person.setdefault(who, []).append(t)

    results = []
    for person, items in by_person.items():
        contact = contacts.get(person, {})
        email = contact.get("email")
        if not email:
            results.append({"person": person, "status": "skipped", "reason": "no email"})
            continue
        body = f"## Overdue Tasks for {person}\n\n"
        for t in items:
            body += f"- [ ] **{t['id']}**: {t['title']} ({t['overdue_days']}d overdue)\n"
        body += "\n---\n\n*Please update status in TaskFlow.*"
        r = send_email(to=email, subject=f"OVERDUE: {len(items)} task(s) need attention", body=body)
        results.append({"person": person, "email": email, **r})
    sent = sum(1 for r in results if r.get("success"))
    return {"status": "sent" if sent else "partial", "sent": sent, "results": results}


@router.post("/notify/custom")
def notify_custom(data: NotifyCustom):
    r = send_email(to=data.to, subject=data.subject, body=data.body)
    return {"status": "sent" if r.get("success") else "failed", **r}


# --- Config ---

@router.get("/config")
def get_config():
    return {
        "api_configured": taskflow_client.is_configured(),
        "api_available": taskflow_client.is_available() if taskflow_client.is_configured() else False,
        "mode": "api" if _use_api() else "local",
        "api_url": taskflow_client.TASKFLOW_API_URL or None,
    }
