from fastapi import APIRouter
import convex_db
from schemas import ClientCreate, ClientUpdate
from datetime import datetime

router = APIRouter(prefix="/api/clients", tags=["clients"])


def _to_api(c: dict, idx: int = 0) -> dict:
    """Normalize Convex client record to API response shape."""
    return {
        "id": idx,
        "slug": c.get("slug", ""),
        "name": c.get("name", ""),
        "industry": c.get("industry"),
        "phase": c.get("phase"),
        "contract_value": c.get("contract_value"),
        "health_score": c.get("health_score", c.get("health")),
        "last_interaction": c.get("last_interaction"),
        "last_interaction_type": c.get("last_interaction_type"),
        "sentiment": c.get("sentiment"),
        "overdue_invoices": c.get("overdue_invoices", 0),
        "deliverables_on_track": c.get("deliverables_on_track", True),
        "created_at": c.get("created_at", c.get("created")),
        "contacts": c.get("contacts", []),
    }


@router.get("")
def list_clients():
    clients = convex_db.list_clients() or []
    results = [_to_api(c, i + 1) for i, c in enumerate(clients)]
    results.sort(key=lambda x: x.get("health_score") or 100)
    return results


@router.get("/health")
def get_at_risk_clients():
    clients = convex_db.list_clients() or []
    at_risk = [c for c in clients if (c.get("health_score") or 100) < 60]
    return {
        "at_risk": [
            {
                "slug": c.get("slug"),
                "name": c.get("name"),
                "health_score": c.get("health_score"),
                "phase": c.get("phase"),
                "sentiment": c.get("sentiment"),
                "last_interaction": c.get("last_interaction"),
            }
            for c in at_risk
        ]
    }


@router.get("/{slug}")
def get_client(slug: str):
    client = convex_db.get_client(slug)
    if not client:
        return {"error": "Client not found"}
    return _to_api(client, 1)


@router.post("")
def create_client(data: ClientCreate):
    now = datetime.utcnow().isoformat()
    cvx_data = {
        "slug": data.slug,
        "name": data.name,
        "phase": data.phase or "active",
        "health_score": data.health_score or 80,
        "sentiment": data.sentiment or "neutral",
        "created_at": now,
    }
    if data.industry:
        cvx_data["industry"] = data.industry
    if data.contract_value:
        cvx_data["contract_value"] = data.contract_value
    convex_db.create_client(cvx_data)
    return _to_api({**cvx_data, "contacts": []}, 1)


@router.put("/{slug}")
def update_client(slug: str, data: ClientUpdate):
    updates = data.model_dump(exclude_unset=True)
    cvx_updates = {}
    for key, val in updates.items():
        if val is not None:
            if key == "last_interaction":
                cvx_updates[key] = str(val)
            else:
                cvx_updates[key] = val
    if cvx_updates:
        convex_db.update_client(slug, cvx_updates)

    # Return updated client
    client = convex_db.get_client(slug)
    if client:
        return _to_api(client, 1)
    return {"error": "Client not found"}
