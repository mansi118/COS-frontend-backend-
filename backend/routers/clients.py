from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import Client, ClientContact
from schemas import ClientCreate, ClientUpdate, ClientOut
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
def list_clients(db: Session = Depends(get_db)):
    # Primary: CoS workspace
    cos_clients = cos_reader.get_all_clients()
    if cos_clients:
        results = [_cos_to_api(c, i + 1) for i, c in enumerate(cos_clients)]
        results.sort(key=lambda x: x.get("health_score") or 100)
        return results

    # Fallback to DB
    return db.query(Client).order_by(Client.health_score.asc()).all()


@router.get("/health")
def get_at_risk_clients(db: Session = Depends(get_db)):
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

    # Fallback to DB
    at_risk = db.query(Client).filter(Client.health_score < 60).all()
    return {
        "at_risk": [
            {
                "slug": c.slug,
                "name": c.name,
                "health_score": c.health_score,
                "phase": c.phase,
                "sentiment": c.sentiment,
                "last_interaction": str(c.last_interaction) if c.last_interaction else None,
            }
            for c in at_risk
        ]
    }


@router.get("/{slug}")
def get_client(slug: str, db: Session = Depends(get_db)):
    # Primary: CoS workspace
    cos_client = cos_reader.get_client(slug)
    if cos_client:
        return _cos_to_api(cos_client, 1)

    # Fallback to DB
    client = db.query(Client).filter(Client.slug == slug).first()
    if not client:
        return {"error": "Client not found"}
    return client


@router.post("")
def create_client(data: ClientCreate, db: Session = Depends(get_db)):
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

    # Also write to DB
    client = Client(**data.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return client


@router.put("/{slug}")
def update_client(slug: str, data: ClientUpdate, db: Session = Depends(get_db)):
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

    # Also update DB
    client = db.query(Client).filter(Client.slug == slug).first()
    if not client:
        if cos_client:
            return _cos_to_api(cos_client, 1)
        return {"error": "Client not found"}
    for key, val in updates.items():
        setattr(client, key, val)
    db.commit()
    db.refresh(client)
    return client
