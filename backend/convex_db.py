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
from typing import Optional, Any

CONVEX_URL = os.getenv("CONVEX_URL", "")

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
    return mutate("followups:create", data)


def get_followup(fu_id: str) -> Optional[dict]:
    """Get a follow-up by fu_id."""
    return query("followups:getByFuId", {"fu_id": fu_id})


def list_followups(**filters) -> Optional[list]:
    """List follow-ups with optional filters."""
    return query("followups:list", filters)


def update_followup(fu_id: str, updates: dict) -> Optional[str]:
    """Update a follow-up."""
    return mutate("followups:update", {"fu_id": fu_id, **updates})


def delete_followup(fu_id: str) -> Optional[bool]:
    """Delete a follow-up."""
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
    """List all team members."""
    return query("team_members:list")


def get_active_sprint() -> Optional[dict]:
    """Get the active sprint."""
    return query("sprints:getActive")


def insert_sprint_update(data: dict) -> Optional[str]:
    """Insert a sprint update."""
    return mutate("sprints:createUpdate", data)


def list_clients() -> Optional[list]:
    """List all clients."""
    return query("clients:list")


def insert_notification(data: dict) -> Optional[str]:
    """Insert a notification log."""
    return mutate("notifications:create", data)


def get_performance(person: str) -> Optional[dict]:
    """Get latest performance snapshot for a person."""
    return query("performance:getByPerson", {"person": person})


def insert_board_snapshot(data: dict) -> Optional[str]:
    """Insert a board snapshot."""
    return mutate("board_snapshots:create", data)
