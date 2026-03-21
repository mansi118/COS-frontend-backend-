"""Async HTTP client for external TaskFlow API — used when TASKFLOW_API_URL is configured."""

import os
import time
from typing import Optional

TASKFLOW_API_URL = os.getenv("TASKFLOW_API_URL", "")
TASKFLOW_AGENT_KEY = os.getenv("TASKFLOW_AGENT_KEY", "")
TASKFLOW_USER_ID = os.getenv("TASKFLOW_USER_ID", "")

_available_cache: Optional[bool] = None
_available_cache_time: float = 0
CACHE_TTL = 30


def is_configured() -> bool:
    return bool(TASKFLOW_API_URL and TASKFLOW_AGENT_KEY and TASKFLOW_USER_ID)


def is_available() -> bool:
    """Check if TaskFlow API is configured and reachable (cached 30s)."""
    global _available_cache, _available_cache_time
    if not is_configured():
        return False
    now = time.time()
    if _available_cache is not None and (now - _available_cache_time) < CACHE_TTL:
        return _available_cache
    try:
        import urllib.request
        req = urllib.request.Request(
            f"{TASKFLOW_API_URL}/api/v1/agent/summary?user_id={TASKFLOW_USER_ID}",
            headers={"X-Agent-Key": TASKFLOW_AGENT_KEY},
        )
        urllib.request.urlopen(req, timeout=3)
        _available_cache = True
    except Exception:
        _available_cache = False
    _available_cache_time = now
    return _available_cache


def _request(method: str, path: str, body: dict = None) -> Optional[dict]:
    """Make a request to TaskFlow API. Returns None on failure."""
    if not is_available():
        return None
    import json
    import urllib.request
    url = f"{TASKFLOW_API_URL}{path}"
    headers = {
        "X-Agent-Key": TASKFLOW_AGENT_KEY,
        "Content-Type": "application/json",
    }
    data = None
    if body:
        if "user_id" not in body and "for_user_id" not in body:
            body["user_id"] = TASKFLOW_USER_ID
        data = json.dumps(body).encode()

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def list_tasks(view: str = "today") -> Optional[dict]:
    return _request("GET", f"/api/v1/agent/tasks?user_id={TASKFLOW_USER_ID}&view={view}")


def get_task(task_id: str) -> Optional[dict]:
    return _request("GET", f"/api/v1/agent/tasks/get?user_id={TASKFLOW_USER_ID}&id={task_id}")


def create_task(data: dict) -> Optional[dict]:
    data["for_user_id"] = TASKFLOW_USER_ID
    return _request("POST", "/api/v1/agent/tasks", data)


def update_task(task_id: str, data: dict) -> Optional[dict]:
    data["user_id"] = TASKFLOW_USER_ID
    data["id"] = task_id
    return _request("PATCH", "/api/v1/agent/tasks", data)


def complete_task(task_id: str) -> Optional[dict]:
    return _request("POST", "/api/v1/agent/tasks/complete", {"user_id": TASKFLOW_USER_ID, "id": task_id})


def uncomplete_task(task_id: str) -> Optional[dict]:
    return _request("POST", "/api/v1/agent/tasks/uncomplete", {"user_id": TASKFLOW_USER_ID, "id": task_id})


def trash_task(task_id: str) -> Optional[dict]:
    return _request("POST", "/api/v1/agent/tasks/trash", {"user_id": TASKFLOW_USER_ID, "id": task_id})


def restore_task(task_id: str) -> Optional[dict]:
    return _request("POST", "/api/v1/agent/tasks/restore", {"user_id": TASKFLOW_USER_ID, "id": task_id})


def get_summary() -> Optional[dict]:
    return _request("GET", f"/api/v1/agent/summary?user_id={TASKFLOW_USER_ID}")


def list_projects() -> Optional[dict]:
    return _request("GET", f"/api/v1/agent/projects?user_id={TASKFLOW_USER_ID}")


def list_areas() -> Optional[dict]:
    return _request("GET", f"/api/v1/agent/areas?user_id={TASKFLOW_USER_ID}")


def list_tags() -> Optional[dict]:
    return _request("GET", f"/api/v1/agent/tags?user_id={TASKFLOW_USER_ID}")
