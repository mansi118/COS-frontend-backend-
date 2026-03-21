from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional


class TeamMemberOut(BaseModel):
    id: int
    slug: str
    name: str
    role: Optional[str] = None
    emoji: Optional[str] = None
    slack_id: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True


class FollowupCreate(BaseModel):
    what: str
    who: str
    due: Optional[date] = None
    priority: Optional[str] = "P2"
    source: Optional[str] = None
    notes: Optional[str] = None


class FollowupUpdate(BaseModel):
    what: Optional[str] = None
    who: Optional[str] = None
    due: Optional[date] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class FollowupOut(BaseModel):
    id: int
    fu_id: str
    what: str
    who: Optional[str] = None
    due: Optional[date] = None
    priority: Optional[str] = None
    status: str
    source: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ClientCreate(BaseModel):
    name: str
    slug: str
    industry: Optional[str] = None
    phase: Optional[str] = "active"
    contract_value: Optional[str] = None
    health_score: Optional[int] = 80
    sentiment: Optional[str] = "positive"


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    phase: Optional[str] = None
    contract_value: Optional[str] = None
    health_score: Optional[int] = None
    last_interaction: Optional[date] = None
    last_interaction_type: Optional[str] = None
    sentiment: Optional[str] = None
    overdue_invoices: Optional[int] = None
    deliverables_on_track: Optional[bool] = None


class ClientOut(BaseModel):
    id: int
    slug: str
    name: str
    industry: Optional[str] = None
    phase: Optional[str] = None
    contract_value: Optional[str] = None
    health_score: Optional[int] = None
    last_interaction: Optional[date] = None
    last_interaction_type: Optional[str] = None
    sentiment: Optional[str] = None
    overdue_invoices: int
    deliverables_on_track: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ClientContactOut(BaseModel):
    id: int
    client_slug: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None

    class Config:
        from_attributes = True



class SprintCreate(BaseModel):
    name: str
    start_date: date
    end_date: date
    goals: Optional[list[str]] = None


class SprintOut(BaseModel):
    id: int
    name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    goals: Optional[list[str]] = None
    status: str
    created_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SprintUpdateCreate(BaseModel):
    person: str
    week_label: Optional[str] = None
    accomplished: str
    blockers: Optional[str] = None
    plan_next_week: Optional[str] = None
    mood: Optional[str] = "neutral"


class SprintUpdateOut(BaseModel):
    id: int
    sprint_id: Optional[int] = None
    person: Optional[str] = None
    week_label: Optional[str] = None
    accomplished: Optional[str] = None
    blockers: Optional[str] = None
    plan_next_week: Optional[str] = None
    mood: Optional[str] = None
    notified_slack: bool
    notified_email: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SendUpdatesRequest(BaseModel):
    channel: str = "all"
    week_label: Optional[str] = None


class PerformanceOut(BaseModel):
    id: int
    person: Optional[str] = None
    period: Optional[str] = None
    score: Optional[int] = None
    rating: Optional[str] = None
    total_assigned: Optional[int] = None
    total_completed: Optional[int] = None
    completion_rate: Optional[int] = None
    on_time_rate: Optional[int] = None
    overdue_count: Optional[int] = None
    evaluated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
