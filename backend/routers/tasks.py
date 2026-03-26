from fastapi import APIRouter
import convex_db

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("")
def list_tasks():
    tasks = convex_db.list_tasks() or []
    return [
        {
            "id": i + 1,
            "task_id": t.get("task_id", t.get("id", "")),
            "title": t.get("title", ""),
            "assignee": t.get("owner", t.get("assignee")),
            "status": t.get("status", "todo"),
            "priority": t.get("priority_hint", t.get("priority")),
            "due": t.get("when_date", t.get("due")),
            "description": t.get("notes", t.get("description")),
            "source": t.get("source"),
        }
        for i, t in enumerate(tasks)
    ]


@router.get("/{task_id}")
def get_task(task_id: str):
    task = convex_db.get_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return task
