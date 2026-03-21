"""Competitive Intelligence — placeholder endpoints for market monitoring."""

from fastapi import APIRouter, Query
from datetime import date

router = APIRouter(prefix="/api/intel", tags=["intel"])


PLACEHOLDER_COMPETITORS = [
    {
        "name": "Fractal Analytics",
        "tier": 1,
        "latest": "Raised $100M Series E — expanding AI consulting in India",
        "date": "2026-03-18",
        "relevance": 8,
        "signals": ["funding", "expansion"],
    },
    {
        "name": "Relevance AI",
        "tier": 2,
        "latest": "Launched enterprise agent platform v3.0 with multi-agent orchestration",
        "date": "2026-03-15",
        "relevance": 7,
        "signals": ["product_launch"],
    },
    {
        "name": "CrewAI",
        "tier": 2,
        "latest": "Open-sourced CrewAI Enterprise — targeting mid-market AI consulting firms",
        "date": "2026-03-12",
        "relevance": 6,
        "signals": ["open_source", "enterprise"],
    },
]

PLACEHOLDER_INDUSTRY = [
    {"headline": "India AI market projected to reach $17B by 2027", "source": "Economic Times", "date": "2026-03-19", "category": "market", "relevance": 9},
    {"headline": "DPDP Act implementation guidelines released — AI data processing rules clarified", "source": "MeitY", "date": "2026-03-17", "category": "regulation", "relevance": 8},
    {"headline": "Agentic AI adoption in Indian enterprises up 340% YoY", "source": "Nasscom", "date": "2026-03-14", "category": "technology", "relevance": 9},
]

PLACEHOLDER_OPPORTUNITIES = [
    {"title": "RFP: AI-powered customer service automation", "source": "GeM Portal", "industry": "Banking", "value": "₹45L", "confidence": 7, "date": "2026-03-20"},
    {"title": "Partnership: Healthcare AI digital employee pilot", "source": "LinkedIn", "industry": "Healthcare", "value": "₹20L", "confidence": 5, "date": "2026-03-18"},
]

WATCHLIST = {
    "tier_1": ["Fractal Analytics", "Quantiphi", "Tiger Analytics"],
    "tier_2": ["Relevance AI", "CrewAI", "AutoGen (Microsoft)"],
    "tier_3": ["Accenture AI", "Deloitte AI", "TCS AI"],
}


@router.get("/dashboard")
def get_intel_dashboard():
    return {
        "date": str(date.today()),
        "competitors": PLACEHOLDER_COMPETITORS,
        "industry": PLACEHOLDER_INDUSTRY,
        "opportunities": PLACEHOLDER_OPPORTUNITIES,
        "watchlist": WATCHLIST,
        "status": "placeholder",
        "note": "Connect web_search + web_fetch for live competitive scanning",
    }


@router.get("/competitors")
def get_competitors():
    return {"competitors": PLACEHOLDER_COMPETITORS, "watchlist": WATCHLIST}


@router.get("/industry")
def get_industry_news():
    return {"news": PLACEHOLDER_INDUSTRY}


@router.get("/opportunities")
def get_opportunities():
    return {"opportunities": PLACEHOLDER_OPPORTUNITIES}


@router.get("/alerts")
def get_intel_alerts():
    alerts = []
    for c in PLACEHOLDER_COMPETITORS:
        if c["relevance"] >= 8:
            alerts.append({"level": "high", "competitor": c["name"], "event": c["latest"], "date": c["date"]})
    for n in PLACEHOLDER_INDUSTRY:
        if n["category"] == "regulation":
            alerts.append({"level": "medium", "type": "regulation", "headline": n["headline"], "date": n["date"]})
    return {"alerts": alerts}
