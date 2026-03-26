from fastapi import APIRouter
import convex_db
from schemas import ClientCreate, ClientUpdate
from datetime import datetime
import cos_reader

router = APIRouter(prefix="/api/clients", tags=["clients"])


def _cos_to_api(c: dict, idx: int = 0) -> dict:
    """Convert CoS client JSON to API response shape matching ClientOut."""
    last_interaction = c.get("last_interaction")
    return {
        "id": idx,
        "slug": c.get("slug", ""),
        "name": c.get("name", ""),
        "industry": c.get("industry"),
        "phase": c.get("phase"),
        "contract_value": c.get("contract_value"),
        "health_score": c.get("health", c.get("health_score")),
        "last_interaction": last_interaction,
        "last_interaction_type": c.get("last_interaction_type"),
        "sentiment": c.get("sentiment"),
        "overdue_invoices": c.get("overdue_invoices", 0),
        "deliverables_on_track": c.get("deliverables_on_track", True),
        "created_at": c.get("created"),
        "contacts": c.get("contacts", []),
    }


@router.get("")
def list_clients():
    # Primary: CoS workspace
    cos_clients = cos_reader.get_all_clients()
    if cos_clients:
        results = [_cos_to_api(c, i + 1) for i, c in enumerate(cos_clients)]
        results.sort(key=lambda x: x.get("health_score") or 100)
        return results

    # Fallback: Convex
    cvx_clients = convex_db.list_clients() or []
    return [_cos_to_api(c, i + 1) for i, c in enumerate(cvx_clients)]


@router.get("/health")
def get_at_risk_clients():
    # Primary: CoS workspace
    cos_clients = cos_reader.get_all_clients()
    if cos_clients:
        at_risk = [c for c in cos_clients if (c.get("health", c.get("health_score", 100)) or 100) < 60]
        return {
            "at_risk": [
                {
                    "slug": c.get("slug"),
                    "name": c.get("name"),
                    "health_score": c.get("health", c.get("health_score")),
                    "phase": c.get("phase"),
                    "sentiment": c.get("sentiment"),
                    "last_interaction": c.get("last_interaction"),
                }
                for c in at_risk
            ]
        }

    # Fallback: Convex
    cvx_clients = convex_db.list_clients() or []
    at_risk = [c for c in cvx_clients if (c.get("health_score") or 100) < 60]
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
    # Primary: CoS workspace
    cos_client = cos_reader.get_client(slug)
    if cos_client:
        return _cos_to_api(cos_client, 1)

    # Fallback: Convex
    cvx_client = convex_db.get_client(slug)
    if cvx_client:
        return _cos_to_api(cvx_client, 1)
    return {"error": "Client not found"}


@router.post("")
def create_client(data: ClientCreate):
    now = datetime.utcnow().isoformat()

    # Write to CoS workspace
    cos_data = {
        "slug": data.slug,
        "name": data.name,
        "industry": data.industry,
        "contacts": [],
        "phase": data.phase or "active",
        "contract_value": data.contract_value,
        "last_interaction": None,
        "last_interaction_type": None,
        "deliverables_on_track": True,
        "overdue_invoices": 0,
        "sentiment": data.sentiment or "neutral",
        "notes": "",
        "created": now,
        "health": data.health_score or 80,
    }
    cos_reader.write_client(data.slug, cos_data)

    # Also write to Convex
    cvx_data = {
        "slug": data.slug,
        "name": data.name,
        "industry": data.industry,
        "phase": data.phase or "active",
        "contract_value": data.contract_value,
        "health_score": data.health_score or 80,
        "sentiment": data.sentiment or "neutral",
        "created_at": now,
    }
    # Strip None values for Convex
    cvx_data = {k: v for k, v in cvx_data.items() if v is not None}
    convex_db.create_client(cvx_data)

    return _cos_to_api(cos_data, 1)


@router.put("/{slug}")
def update_client(slug: str, data: ClientUpdate):
    updates = data.model_dump(exclude_unset=True)

    # Update CoS workspace
    cos_client = cos_reader.get_client(slug)
    if cos_client:
        for key, val in updates.items():
            if key == "health_score":
                cos_client["health"] = val
            elif key == "last_interaction" and val is not None:
                cos_client[key] = str(val)
            else:
                cos_client[key] = val
        cos_reader.write_client(slug, cos_client)

    # Also update Convex
    cvx_updates = {}
    for key, val in updates.items():
        if val is not None:
            if key == "last_interaction":
                cvx_updates[key] = str(val)
            else:
                cvx_updates[key] = val
    if cvx_updates:
        convex_db.update_client(slug, cvx_updates)

    if cos_client:
        return _cos_to_api(cos_client, 1)
    return {"error": "Client not found"}
