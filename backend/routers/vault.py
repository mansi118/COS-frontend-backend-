from fastapi import APIRouter, Query
import convex_db

router = APIRouter(prefix="/api/vault", tags=["vault"])


@router.get("")
def list_vault_entries(q: str = Query(None)):
    entries = convex_db.list_vault_entries() or []

    if q:
        q_lower = q.lower()
        entries = [
            e for e in entries
            if q_lower in (e.get("content", "") or "").lower()
            or q_lower in (e.get("key", "") or "").lower()
            or q_lower in str(e.get("tags", [])).lower()
        ]

    # Group by namespace
    grouped: dict = {}
    for e in entries:
        ns = e.get("namespace", "general")
        if ns not in grouped:
            grouped[ns] = []
        grouped[ns].append({
            "key": e.get("key", ""),
            "namespace": ns,
            "content": e.get("content", ""),
            "tags": e.get("tags", []),
            "created": e.get("created", ""),
        })

    return {
        "entries": entries,
        "grouped": grouped,
        "total": len(entries),
    }
