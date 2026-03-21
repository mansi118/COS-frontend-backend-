"""Financial Snapshot — placeholder endpoints for Razorpay + invoice + expense tracking."""

from fastapi import APIRouter, Query
from datetime import date, timedelta

router = APIRouter(prefix="/api/finance", tags=["finance"])


# Placeholder data — will be replaced with Razorpay API + Convex vault
PLACEHOLDER_REVENUE = {
    "collected_mtd": 350000,
    "collected_last_month": 500000,
    "outstanding": 210000,
    "overdue_invoices": 1,
    "overdue_amount": 50000,
    "pipeline_weighted": 850000,
    "target_monthly": 500000,
}

PLACEHOLDER_EXPENSES = {
    "total_mtd": 180000,
    "categories": {
        "infrastructure": 45000,
        "tools_subscriptions": 22000,
        "payroll": 95000,
        "marketing": 8000,
        "misc": 10000,
    },
    "burn_rate_monthly": 210000,
}

PLACEHOLDER_CLIENTS_REVENUE = [
    {"client": "Breakfree", "contract_value": "3.5L/month", "collected_mtd": 175000, "outstanding": 0, "status": "on_track"},
    {"client": "Von Albert", "contract_value": "5L/month", "collected_mtd": 175000, "outstanding": 210000, "status": "overdue"},
]

PLACEHOLDER_INVOICES = [
    {"id": "INV-001", "client": "Breakfree", "amount": 350000, "issued": "2026-03-01", "due": "2026-03-15", "status": "paid", "paid_date": "2026-03-12"},
    {"id": "INV-002", "client": "Von Albert", "amount": 500000, "issued": "2026-03-01", "due": "2026-03-15", "status": "overdue", "paid_date": None},
    {"id": "INV-003", "client": "Von Albert", "amount": 210000, "issued": "2026-03-10", "due": "2026-03-25", "status": "pending", "paid_date": None},
]


@router.get("/snapshot")
def get_financial_snapshot():
    today = date.today()
    bank_balance = 2800000  # placeholder
    burn = PLACEHOLDER_EXPENSES["burn_rate_monthly"]
    runway_months = round(bank_balance / burn, 1) if burn else 0
    collection_pct = round((PLACEHOLDER_REVENUE["collected_mtd"] / PLACEHOLDER_REVENUE["target_monthly"]) * 100) if PLACEHOLDER_REVENUE["target_monthly"] else 0

    return {
        "date": str(today),
        "revenue": PLACEHOLDER_REVENUE,
        "expenses": PLACEHOLDER_EXPENSES,
        "bank_balance": bank_balance,
        "runway_months": runway_months,
        "collection_pct": collection_pct,
        "net_mtd": PLACEHOLDER_REVENUE["collected_mtd"] - PLACEHOLDER_EXPENSES["total_mtd"],
        "clients": PLACEHOLDER_CLIENTS_REVENUE,
        "status": "placeholder",
        "note": "Connect Razorpay API + expense tracker for live data",
    }


@router.get("/invoices")
def get_invoices():
    return {"invoices": PLACEHOLDER_INVOICES}


@router.get("/alerts")
def get_financial_alerts():
    alerts = []
    burn = PLACEHOLDER_EXPENSES["burn_rate_monthly"]
    runway = round(2800000 / burn, 1) if burn else 0
    if runway < 6:
        alerts.append({"level": "warning", "message": f"Runway is {runway} months — below 6-month threshold"})
    if runway < 3:
        alerts.append({"level": "critical", "message": f"Runway is {runway} months — critical"})
    if PLACEHOLDER_REVENUE["overdue_invoices"] > 0:
        alerts.append({"level": "warning", "message": f"{PLACEHOLDER_REVENUE['overdue_invoices']} overdue invoice(s) totaling ₹{PLACEHOLDER_REVENUE['overdue_amount']:,}"})
    collection_pct = round((PLACEHOLDER_REVENUE["collected_mtd"] / PLACEHOLDER_REVENUE["target_monthly"]) * 100)
    if collection_pct < 80:
        alerts.append({"level": "warning", "message": f"Collection at {collection_pct}% of monthly target"})
    return {"alerts": alerts}
