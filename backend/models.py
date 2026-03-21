from sqlalchemy import Column, Integer, String, Text, Date, Boolean, DateTime, ForeignKey, ARRAY
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from database import Base


class TeamMember(Base):
    __tablename__ = "team_members"
    id = Column(Integer, primary_key=True)
    slug = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    role = Column(String(100))
    emoji = Column(String(10))
    slack_id = Column(String(50))
    email = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())


class Followup(Base):
    __tablename__ = "followups"
    id = Column(Integer, primary_key=True)
    fu_id = Column(String(20), unique=True, nullable=False)
    what = Column(Text, nullable=False)
    who = Column(String(50), ForeignKey("team_members.slug"))
    due = Column(Date)
    priority = Column(String(5))
    status = Column(String(20), default="open")
    source = Column(String(50))
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    resolved_at = Column(DateTime)


class Client(Base):
    __tablename__ = "clients"
    id = Column(Integer, primary_key=True)
    slug = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    industry = Column(String(100))
    phase = Column(String(20))
    contract_value = Column(String(50))
    health_score = Column(Integer)
    last_interaction = Column(Date)
    last_interaction_type = Column(String(50))
    sentiment = Column(String(20))
    overdue_invoices = Column(Integer, default=0)
    deliverables_on_track = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class ClientContact(Base):
    __tablename__ = "client_contacts"
    id = Column(Integer, primary_key=True)
    client_slug = Column(String(50), ForeignKey("clients.slug"))
    name = Column(String(100))
    email = Column(String(100))
    role = Column(String(100))



class Sprint(Base):
    __tablename__ = "sprints"
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    start_date = Column(Date)
    end_date = Column(Date)
    goals = Column(ARRAY(String))
    status = Column(String(20), default="active")
    created_at = Column(DateTime, server_default=func.now())
    closed_at = Column(DateTime)


class SprintUpdate(Base):
    __tablename__ = "sprint_updates"
    id = Column(Integer, primary_key=True)
    sprint_id = Column(Integer, ForeignKey("sprints.id"))
    person = Column(String(50), ForeignKey("team_members.slug"))
    week_label = Column(String(30))
    accomplished = Column(Text)
    blockers = Column(Text)
    plan_next_week = Column(Text)
    mood = Column(String(20))
    notified_slack = Column(Boolean, default=False)
    notified_email = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class NotificationLog(Base):
    __tablename__ = "notification_logs"
    id = Column(Integer, primary_key=True)
    update_id = Column(Integer, ForeignKey("sprint_updates.id"))
    channel = Column(String(20))
    recipient = Column(String(100))
    status = Column(String(20), default="sent")
    sent_at = Column(DateTime, server_default=func.now())


class PerformanceSnapshot(Base):
    __tablename__ = "performance_snapshots"
    id = Column(Integer, primary_key=True)
    person = Column(String(50), ForeignKey("team_members.slug"))
    period = Column(String(20))
    score = Column(Integer)
    rating = Column(String(30))
    total_assigned = Column(Integer)
    total_completed = Column(Integer)
    completion_rate = Column(Integer)
    on_time_rate = Column(Integer)
    overdue_count = Column(Integer)
    evaluated_at = Column(DateTime, server_default=func.now())


class BoardSnapshot(Base):
    __tablename__ = "board_snapshots"
    id = Column(Integer, primary_key=True)
    date = Column(Date)
    data = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now())
