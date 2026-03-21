"""Seed the database from CoS workspace JSON files, falling back to dummy data."""
import sys
import time
from datetime import date, datetime, timedelta
from sqlalchemy import text
from database import engine, Base, SessionLocal
from models import (
    TeamMember, Followup, Client, ClientContact,
    Sprint, SprintUpdate, PerformanceSnapshot, BoardSnapshot,
)
import cos_reader


def wait_for_db(retries=10, delay=2):
    for i in range(retries):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception:
            print(f"Waiting for database... ({i+1}/{retries})")
            time.sleep(delay)
    print("Could not connect to database")
    sys.exit(1)


def seed():
    wait_for_db()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Check if already seeded
    if db.query(TeamMember).count() > 0:
        print("Database already seeded, syncing from CoS workspace...")
        _sync_from_cos(db)
        db.close()
        return

    print("Seeding database from CoS workspace...")

    # --- Team Members from notification-routes.json ---
    roster = cos_reader.get_team_roster()
    if roster:
        for r in roster:
            db.add(TeamMember(
                slug=r["slug"],
                name=r["name"],
                role=r.get("role", ""),
                emoji="",
                slack_id=r.get("slack_id"),
                email=r.get("email"),
            ))
        db.flush()
        print(f"  Seeded {len(roster)} team members from CoS workspace")
    else:
        # Fallback to hardcoded
        members = [
            TeamMember(slug="yatharth", name="Yatharth Garg", role="CEO", emoji="", slack_id="U09FZRG09TJ", email="yatharth@synlex.tech"),
            TeamMember(slug="mansi", name="Mansi Gambhir", role="AI Engineer", emoji="", slack_id="U09ESJ0P8QP", email="mansi@synlex.tech"),
            TeamMember(slug="shivam", name="Shivam Singh", role="Lead Engineer", emoji="", slack_id="U09ESJ1JN15"),
            TeamMember(slug="naveen", name="Naveen Bisht", role="Frontend Engineer", emoji="", slack_id="U09ESJ28G0P"),
            TeamMember(slug="ankit", name="Ankit", role="Backend Engineer", emoji="", slack_id="U09ESJ33ACF"),
        ]
        db.add_all(members)
        db.flush()
        print("  Seeded 5 team members from fallback data")

    # --- Follow-ups from CoS workspace ---
    cos_fus = cos_reader.get_all_followups()
    if cos_fus:
        for fu in cos_fus:
            due_str = fu.get("due")
            due_date = None
            if due_str:
                try:
                    due_date = date.fromisoformat(due_str)
                except (ValueError, TypeError):
                    pass

            resolved_str = fu.get("resolved_at")
            resolved_at = None
            if resolved_str:
                try:
                    resolved_at = datetime.fromisoformat(resolved_str)
                except (ValueError, TypeError):
                    pass

            created_str = fu.get("created")
            created_at = None
            if created_str:
                try:
                    created_at = datetime.fromisoformat(created_str)
                except (ValueError, TypeError):
                    pass

            db.add(Followup(
                fu_id=fu.get("id", ""),
                what=fu.get("what", ""),
                who=fu.get("who"),
                due=due_date,
                priority=fu.get("priority", "P2"),
                status=fu.get("status", "open"),
                source=fu.get("source"),
                notes=fu.get("notes", ""),
                created_at=created_at,
                resolved_at=resolved_at,
            ))
        db.flush()
        print(f"  Seeded {len(cos_fus)} follow-ups from CoS workspace")

    # --- Clients from CoS workspace ---
    cos_clients = cos_reader.get_all_clients()
    if cos_clients:
        for c in cos_clients:
            last_interaction = None
            li_str = c.get("last_interaction")
            if li_str:
                try:
                    last_interaction = date.fromisoformat(li_str)
                except (ValueError, TypeError):
                    pass

            db.add(Client(
                slug=c.get("slug", ""),
                name=c.get("name", ""),
                industry=c.get("industry"),
                phase=c.get("phase"),
                contract_value=c.get("contract_value"),
                health_score=c.get("health", c.get("health_score")),
                last_interaction=last_interaction,
                last_interaction_type=c.get("last_interaction_type"),
                sentiment=c.get("sentiment"),
                overdue_invoices=c.get("overdue_invoices", 0),
                deliverables_on_track=c.get("deliverables_on_track", True),
            ))
            # Contacts
            for contact in c.get("contacts", []):
                db.add(ClientContact(
                    client_slug=c.get("slug"),
                    name=contact.get("name"),
                    email=contact.get("email"),
                    role=contact.get("role"),
                ))
        db.flush()
        print(f"  Seeded {len(cos_clients)} clients from CoS workspace")

    # --- Sprint from CoS workspace ---
    cos_sprint = cos_reader.get_active_sprint()
    if cos_sprint:
        start_str = cos_sprint.get("start", cos_sprint.get("start_date", ""))
        end_str = cos_sprint.get("end", cos_sprint.get("end_date", ""))
        try:
            start_date = date.fromisoformat(start_str)
            end_date = date.fromisoformat(end_str)
        except (ValueError, TypeError):
            start_date = date.today()
            end_date = date.today() + timedelta(days=14)

        sprint = Sprint(
            name=cos_sprint.get("name", ""),
            start_date=start_date,
            end_date=end_date,
            goals=cos_sprint.get("goals", []),
            status=cos_sprint.get("status", "active"),
        )
        db.add(sprint)
        db.flush()
        print(f"  Seeded sprint: {cos_sprint.get('name')}")

    # --- Performance from CoS workspace ---
    perf_data = cos_reader.get_performance_data()
    if perf_data:
        for p in perf_data:
            evaluated_str = p.get("evaluated_at")
            evaluated_at = None
            if evaluated_str:
                try:
                    evaluated_at = datetime.fromisoformat(evaluated_str)
                except (ValueError, TypeError):
                    pass

            db.add(PerformanceSnapshot(
                person=p.get("person", ""),
                period=f"{p.get('period_days', 14)} days",
                score=p.get("score"),
                rating=p.get("rating"),
                total_assigned=p.get("total_assigned"),
                total_completed=p.get("total_completed"),
                completion_rate=p.get("completion_rate"),
                on_time_rate=p.get("on_time_rate"),
                overdue_count=p.get("overdue_count"),
                evaluated_at=evaluated_at,
            ))
        db.flush()
        print(f"  Seeded {len(perf_data)} performance snapshots from CoS workspace")

    # --- Board Snapshot ---
    board = cos_reader.get_board_snapshot()
    if board:
        board_date_str = board.get("date", str(date.today()))
        try:
            board_date = date.fromisoformat(board_date_str)
        except (ValueError, TypeError):
            board_date = date.today()

        db.add(BoardSnapshot(
            date=board_date,
            data=board,
        ))
        db.flush()
        print(f"  Seeded board snapshot for {board_date_str}")

    db.commit()
    db.close()
    print("Database seeded successfully from CoS workspace!")


def _sync_from_cos(db):
    """Sync existing DB with latest CoS workspace data."""
    # Sync follow-ups
    cos_fus = cos_reader.get_all_followups()
    if cos_fus:
        synced = 0
        for fu_data in cos_fus:
            fu_id = fu_data.get("id", "")
            existing = db.query(Followup).filter(Followup.fu_id == fu_id).first()
            if existing:
                existing.status = fu_data.get("status", existing.status)
                existing.what = fu_data.get("what", existing.what)
                existing.who = fu_data.get("who", existing.who)
                existing.priority = fu_data.get("priority", existing.priority)
                if fu_data.get("due"):
                    try:
                        existing.due = date.fromisoformat(fu_data["due"])
                    except (ValueError, TypeError):
                        pass
                if fu_data.get("resolved_at"):
                    try:
                        existing.resolved_at = datetime.fromisoformat(fu_data["resolved_at"])
                    except (ValueError, TypeError):
                        pass
                synced += 1
            else:
                # New follow-up from CoS
                due_date = None
                if fu_data.get("due"):
                    try:
                        due_date = date.fromisoformat(fu_data["due"])
                    except (ValueError, TypeError):
                        pass
                db.add(Followup(
                    fu_id=fu_id,
                    what=fu_data.get("what", ""),
                    who=fu_data.get("who"),
                    due=due_date,
                    priority=fu_data.get("priority", "P2"),
                    status=fu_data.get("status", "open"),
                    source=fu_data.get("source"),
                    notes=fu_data.get("notes", ""),
                ))
                synced += 1
        db.commit()
        print(f"  Synced {synced} follow-ups from CoS workspace")


if __name__ == "__main__":
    seed()
