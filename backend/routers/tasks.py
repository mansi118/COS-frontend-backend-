from fastapi import APIRouter
from datetime import date
import cos_reader

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("")
def list_tasks():
    tasks = cos_reader.get_all_tasks()
    return [
        {
            "id": i + 1,
            "task_id": t.get("id", ""),
            "title": t.get("title", ""),
            "assignee": t.get("owner", t.get("assignee")),
            "status": t.get("status", "todo"),
            "priority": t.get("priority"),
            "due": t.get("due"),
            "description": t.get("description"),
            "source": t.get("source"),
            "impact": t.get("impact"),
        }
        for i, t in enumerate(tasks)
    ]


@router.get("/{task_id}")
def get_task(task_id: str):
    task = cos_reader.get_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return task
