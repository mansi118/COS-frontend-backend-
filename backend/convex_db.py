"""Convex database client — replaces SQLAlchemy/PostgreSQL as the fallback database.

Usage:
    import convex_db

    # Read
    result = convex_db.query("followups:list", {"status": "open"})

    # Write
    convex_db.mutate("followups:create", {"fu_id": "FU-0001", "what": "...", ...})

    # Check availability
    if convex_db.is_available():
        ...
"""

import os
import time
import json as _json
from typing import Optional, Any

CONVEX_URL = os.getenv("CONVEX_URL", "")

# --- In-memory TTL cache for read queries ---
_cache: dict[str, tuple[Any, float]] = {}

def _cached_query(function_name: str, args: dict = None, ttl: int = 30) -> Optional[Any]:
    """Query with TTL cache. Avoids redundant Convex HTTP calls within a request."""
    args_key = _json.dumps(args or {}, sort_keys=True)
    cache_key = f"{function_name}:{args_key}"
    if cache_key in _cache:
        val, ts = _cache[cache_key]
        if time.time() - ts < ttl:
            return val
    result = query(function_name, args)
    _cache[cache_key] = (result, time.time())
    return result

def _invalidate_cache(prefix: str = None):
    """Clear cache entries. If prefix given, only clear matching keys."""
    global _cache
    if prefix:
        _cache = {k: v for k, v in _cache.items() if not k.startswith(prefix)}
    else:
        _cache = {}

_client = None


def _get_client():
    """Lazy init Convex client."""
    global _client
    if _client is None and CONVEX_URL:
        try:
            from convex import ConvexClient
            _client = ConvexClient(CONVEX_URL)
        except Exception as e:
            print(f"[convex_db] Failed to init client: {e}")
            _client = None
    return _client


def is_available() -> bool:
    """Check if Convex is configured and reachable."""
    return bool(CONVEX_URL) and _get_client() is not None


def query(function_name: str, args: dict = None) -> Optional[Any]:
    """Run a Convex query function (read-only).

    Args:
        function_name: e.g. "followups:list" or "team_members:getBySlug"
        args: dict of arguments to pass

    Returns:
        Query result, or None if Convex unavailable
    """
    client = _get_client()
    if not client:
        return None
    try:
        result = client.query(function_name, args or {})
        return result
    except Exception as e:
        print(f"[convex_db] Query failed ({function_name}): {e}")
        return None


def mutate(function_name: str, args: dict = None) -> Optional[Any]:
    """Run a Convex mutation function (write).

    Args:
        function_name: e.g. "followups:create" or "voice_updates:update"
        args: dict of arguments to pass

    Returns:
        Mutation result (usually the document ID), or None if Convex unavailable
    """
    client = _get_client()
    if not client:
        return None
    try:
        result = client.mutation(function_name, args or {})
        return result
    except Exception as e:
        print(f"[convex_db] Mutation failed ({function_name}): {e}")
        return None


def get_mode() -> str:
    """Return current database mode."""
    if is_available():
        return "convex"
    return "none"


# --- Convenience wrappers matching current usage patterns ---

def insert_followup(data: dict) -> Optional[str]:
    """Insert a follow-up into Convex. Returns document ID or None."""
    _invalidate_cache("followups:")
    return mutate("followups:create", data)


def get_followup(fu_id: str) -> Optional[dict]:
    """Get a follow-up by fu_id."""
    return query("followups:getByFuId", {"fu_id": fu_id})


def list_followups(**filters) -> Optional[list]:
    """List follow-ups with optional filters (cached 30s)."""
    clean = {k: v for k, v in filters.items() if v is not None}
    return _cached_query("followups:list", clean, ttl=30)


def update_followup(fu_id: str, updates: dict) -> Optional[str]:
    """Update a follow-up."""
    _invalidate_cache("followups:")
    return mutate("followups:update", {"fu_id": fu_id, **updates})


def delete_followup(fu_id: str) -> Optional[bool]:
    """Delete a follow-up."""
    _invalidate_cache("followups:")
    return mutate("followups:remove", {"fu_id": fu_id})


def insert_voice_update(data: dict) -> Optional[str]:
    """Insert a voice update."""
    return mutate("voice_updates:create", data)


def get_voice_update(vu_id: str) -> Optional[dict]:
    """Get a voice update by vu_id."""
    return query("voice_updates:getByVuId", {"vu_id": vu_id})


def update_voice_update(vu_id: str, updates: dict) -> Optional[str]:
    """Update a voice update."""
    return mutate("voice_updates:update", {"vu_id": vu_id, **updates})


def delete_voice_update(vu_id: str) -> Optional[bool]:
    """Delete a voice update."""
    return mutate("voice_updates:remove", {"vu_id": vu_id})


def list_team_members() -> Optional[list]:
    """List all team members (cached 60s)."""
    return _cached_query("team_members:list", {}, ttl=60)


def get_active_sprint() -> Optional[dict]:
    """Get the active sprint (cached 60s)."""
    return _cached_query("sprints:getActive", {}, ttl=60)


def insert_sprint_update(data: dict) -> Optional[str]:
    """Insert a sprint update."""
    return mutate("sprints:createUpdate", data)


def list_clients() -> Optional[list]:
    """List all clients (cached 30s)."""
    return _cached_query("clients:list", {}, ttl=30)


def insert_notification(data: dict) -> Optional[str]:
    """Insert a notification log."""
    return mutate("notifications:create", data)


def get_performance(person: str) -> Optional[dict]:
    """Get latest performance snapshot for a person (cached 60s)."""
    return _cached_query("performance:getByPerson", {"person": person}, ttl=60)


def insert_board_snapshot(data: dict) -> Optional[str]:
    """Insert a board snapshot."""
    return mutate("board_snapshots:create", data)


# --- Sprint wrappers ---

def list_sprints() -> Optional[list]:
    """List all sprints."""
    return query("sprints:list")


def create_sprint(data: dict) -> Optional[str]:
    """Create a new sprint (auto-closes active one)."""
    return mutate("sprints:create", data)


def close_sprint() -> Optional[str]:
    """Close the active sprint."""
    return mutate("sprints:closeSprint", {})


def list_sprint_updates(sprint_id: str = None, week_label: str = None, person: str = None) -> Optional[list]:
    """List sprint updates with optional filters."""
    args = {}
    if sprint_id:
        args["sprint_id"] = sprint_id
    if week_label:
        args["week_label"] = week_label
    if person:
        args["person"] = person
    return query("sprints:listUpdates", args)


def patch_sprint_update(update_id: str, data: dict) -> Optional[str]:
    """Patch a sprint update (notified flags)."""
    return mutate("sprints:patchUpdate", {"update_id": update_id, **data})


def get_sprint_update(update_id: str) -> Optional[dict]:
    """Get a sprint update by ID."""
    return query("sprints:getUpdateById", {"update_id": update_id})


# --- Client wrappers ---

def get_client(slug: str) -> Optional[dict]:
    """Get a client by slug."""
    return query("clients:getBySlug", {"slug": slug})


def create_client(data: dict) -> Optional[str]:
    """Create a new client."""
    return mutate("clients:create", data)


def update_client(slug: str, data: dict) -> Optional[str]:
    """Update a client by slug."""
    return mutate("clients:update", {"slug": slug, **data})


def list_client_contacts(client_slug: str) -> Optional[list]:
    """List contacts for a client."""
    return query("clients:listContacts", {"client_slug": client_slug})


def insert_client_contact(data: dict) -> Optional[str]:
    """Insert a client contact."""
    return mutate("clients:insertContact", data)


# --- Performance wrappers ---

def list_performance() -> Optional[list]:
    """List all performance snapshots (cached 60s)."""
    return _cached_query("performance:listAll", {}, ttl=60)


def create_performance(data: dict) -> Optional[str]:
    """Insert a performance snapshot."""
    return mutate("performance:create", data)


# --- Team member wrappers ---

def get_team_member(slug: str) -> Optional[dict]:
    """Get a team member by slug."""
    return query("team_members:getBySlug", {"slug": slug})


def create_team_member(data: dict) -> Optional[str]:
    """Create a team member."""
    return mutate("team_members:create", data)


# --- Notification wrappers ---

def list_notifications(limit: int = 50) -> Optional[list]:
    """List recent notification logs."""
    return query("notifications:listRecent", {"limit": limit})


# --- Board snapshot wrappers ---

def get_board_snapshot(date: str = None) -> Optional[dict]:
    """Get board snapshot by date, or latest."""
    if date:
        return query("board_snapshots:getByDate", {"date": date})
    return query("board_snapshots:latest")


# --- Standup wrappers ---

def post_standup(data: dict) -> Optional[str]:
    """Create/upsert a standup."""
    return mutate("standups:create", data)


def get_standup(person: str, date: str) -> Optional[dict]:
    """Get a standup by person + date."""
    return query("standups:getByPersonDate", {"person": person, "date": date})


def update_standup(person: str, date: str, data: dict) -> Optional[str]:
    """Update a standup."""
    return mutate("standups:update", {"person": person, "date": date, **data})


def get_standups_by_date(date_str: str) -> Optional[list]:
    """Get all standups for a date."""
    return query("standups:getByDate", {"date": date_str})


def get_person_standup_history(person: str, limit: int = 14) -> Optional[list]:
    """Get standup history for a person."""
    return query("standups:list", {"person": person, "limit": limit})


# --- Task wrappers ---

def list_tasks(status: str = None, owner: str = None, project_id: str = None) -> Optional[list]:
    """List tasks with optional filters."""
    args = {}
    if status:
        args["status"] = status
    if owner:
        args["owner"] = owner
    if project_id:
        args["project_id"] = project_id
    return query("tasks:list", args)


def get_task(task_id: str) -> Optional[dict]:
    """Get a task by task_id."""
    return query("tasks:getByTaskId", {"task_id": task_id})


def create_task(data: dict) -> Optional[str]:
    """Create a new task."""
    return mutate("tasks:create", data)


def update_task(task_id: str, data: dict) -> Optional[str]:
    """Update a task."""
    return mutate("tasks:update", {"task_id": task_id, **data})


def complete_task(task_id: str) -> Optional[str]:
    """Mark a task as completed."""
    return mutate("tasks:complete", {"task_id": task_id})


def uncomplete_task(task_id: str) -> Optional[str]:
    """Reopen a completed task."""
    return mutate("tasks:uncomplete", {"task_id": task_id})


def trash_task(task_id: str) -> Optional[str]:
    """Trash a task."""
    return mutate("tasks:trash", {"task_id": task_id})


def restore_task(task_id: str) -> Optional[str]:
    """Restore a trashed task."""
    return mutate("tasks:restore", {"task_id": task_id})


def delete_task(task_id: str) -> Optional[str]:
    """Hard-delete a task."""
    return mutate("tasks:remove", {"task_id": task_id})


# --- TaskFlow meta wrappers ---

def list_projects() -> Optional[list]:
    return query("taskflow_meta:listProjects")


def create_project(data: dict) -> Optional[str]:
    return mutate("taskflow_meta:createProject", data)


def update_project(project_id: str, data: dict) -> Optional[str]:
    return mutate("taskflow_meta:updateProject", {"project_id": project_id, **data})


def delete_project(project_id: str) -> Optional[str]:
    return mutate("taskflow_meta:deleteProject", {"project_id": project_id})


def list_areas() -> Optional[list]:
    return query("taskflow_meta:listAreas")


def create_area(data: dict) -> Optional[str]:
    return mutate("taskflow_meta:createArea", data)


def update_area(area_id: str, data: dict) -> Optional[str]:
    return mutate("taskflow_meta:updateArea", {"area_id": area_id, **data})


def delete_area(area_id: str) -> Optional[str]:
    return mutate("taskflow_meta:deleteArea", {"area_id": area_id})


def list_tags() -> Optional[list]:
    return query("taskflow_meta:listTags")


def create_tag(data: dict) -> Optional[str]:
    return mutate("taskflow_meta:createTag", data)


def update_tag(tag_id: str, data: dict) -> Optional[str]:
    return mutate("taskflow_meta:updateTag", {"tag_id": tag_id, **data})


def delete_tag(tag_id: str) -> Optional[str]:
    return mutate("taskflow_meta:deleteTag", {"tag_id": tag_id})


# --- Notification config wrappers ---

def get_notification_routes() -> Optional[dict]:
    """Get the team notification config (cached 120s)."""
    return _cached_query("notification_config:get", {}, ttl=120)


def set_notification_routes(data: dict) -> Optional[str]:
    """Set/update the notification config."""
    return mutate("notification_config:set", data)


# --- Calendar meetings wrappers ---

def get_meetings(date_str: str) -> Optional[dict]:
    """Get meetings for a specific date."""
    return query("calendar_meetings:getByDate", {"date": date_str})


def upsert_meetings(date_str: str, meetings: list, timezone: str = None) -> Optional[str]:
    """Create or update meetings for a date."""
    args = {"date": date_str, "meetings": meetings}
    if timezone:
        args["timezone"] = timezone
    return mutate("calendar_meetings:upsert", args)


# --- Vault wrappers ---

def list_vault_entries(namespace: str = None) -> Optional[list]:
    """List vault entries, optionally filtered by namespace."""
    args = {}
    if namespace:
        args["namespace"] = namespace
    return query("vault_entries:list", args)


def create_vault_entry(data: dict) -> Optional[str]:
    """Create a vault entry."""
    return mutate("vault_entries:create", data)


# --- Counter wrappers ---

def increment_counter(counter_type: str) -> Optional[int]:
    """Atomically increment a counter and return the next value."""
    return mutate("counters:increment", {"counter_type": counter_type})


def set_counter(counter_type: str, next_val: int) -> Optional[str]:
    """Set a counter to a specific value."""
    return mutate("counters:set", {"counter_type": counter_type, "next_val": next_val})


# --- Pulse snapshot wrappers ---

def save_pulse_snapshot(data: dict) -> Optional[str]:
    """Save a daily pulse snapshot."""
    return mutate("pulse_snapshots:create", data)


def get_pulse_snapshot(date_str: str) -> Optional[dict]:
    """Get pulse snapshot for a specific date."""
    return query("pulse_snapshots:getByDate", {"date": date_str})


def list_pulse_snapshots(days: int = 7) -> Optional[list]:
    """Get recent pulse snapshots."""
    return query("pulse_snapshots:listRecent", {"days": days})


# --- EOD snapshot wrappers ---

def get_eod_snapshot(date_str: str = None) -> Optional[dict]:
    """Get EOD snapshot — by date, or latest."""
    if date_str:
        return query("eod_snapshots:getByDate", {"date": date_str})
    return query("eod_snapshots:latest")


def save_eod_snapshot(data: dict) -> Optional[str]:
    """Save an EOD snapshot."""
    return mutate("eod_snapshots:create", data)


# --- Voice update list wrapper (was missing) ---

def list_all_voice_updates(**filters) -> Optional[list]:
    """List all voice updates with optional filters."""
    return query("voice_updates:list", filters)
