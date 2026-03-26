"""Daily standup service — Convex database as sole data source.

Drop-in replacement for standup_local.py. Same function signatures,
same return shapes. Reads/writes Convex only — no local JSON files.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional
import convex_db

IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def _now_ist() -> str:
    return datetime.now(IST).isoformat()


def _extract_highlights(done: str) -> list[str]:
    """Extract key phrases from done text — first sentence per line, capped at 3."""
    if not done:
        return []
    lines = [l.strip().lstrip("- •").strip() for l in done.split("\n") if l.strip()]
    highlights = []
    for line in lines[:3]:
        sentence = line.split(".")[0].strip()
        if sentence:
            highlights.append(sentence[:60])
    return highlights


def _resolve_name(person: str) -> str:
    member = convex_db.get_team_member(person)
    if member:
        return member.get("name", person)
    return person


def _is_weekend(date_str: str) -> bool:
    try:
        d = date.fromisoformat(date_str)
        return d.weekday() >= 5
    except (ValueError, TypeError):
        return False


# --- Core CRUD ---

def post_standup(person: str, data: dict) -> dict:
    today = _today_ist()

    standup = {
        "person": person,
        "name": _resolve_name(person),
        "date": today,
        "done": data.get("done", ""),
        "doing": data.get("doing", ""),
        "blockers": data.get("blockers") or None,
        "mood": data.get("mood", "neutral"),
        "highlights": _extract_highlights(data.get("done", "")),
        "linked_tasks": data.get("linked_tasks", []),
        "created_at": _now_ist(),
        "updated_at": _now_ist(),
    }

    # Preserve created_at if already posted today
    existing = get_standup(person, today)
    if existing:
        standup["created_at"] = existing.get("created_at", standup["created_at"])

    # Write to Convex (sole data source)
    cvx_data = {k: v for k, v in standup.items() if v is not None}
    convex_db.post_standup(cvx_data)

    return standup


def get_standup(person: str, date_str: str = None) -> Optional[dict]:
    date_str = date_str or _today_ist()
    return convex_db.get_standup(person, date_str)


def update_standup(person: str, data: dict) -> Optional[dict]:
    today = _today_ist()
    existing = get_standup(person, today)
    if not existing:
        return None

    for key in ("done", "doing", "blockers", "mood", "linked_tasks", "doing_priorities"):
        if key in data:
            existing[key] = data[key]

    existing["highlights"] = _extract_highlights(existing.get("done", ""))
    existing["updated_at"] = _now_ist()

    # Write to Convex — only send fields the update mutation accepts
    allowed_update_keys = {"done", "doing", "blockers", "mood", "highlights", "linked_tasks", "doing_priorities", "updated_at"}
    update_fields = {k: v for k, v in existing.items() if k in allowed_update_keys and v is not None}
    convex_db.update_standup(person, today, update_fields)

    return existing


# --- Listing ---

def get_standups_by_date(date_str: str = None) -> list[dict]:
    date_str = date_str or _today_ist()
    result = convex_db.get_standups_by_date(date_str)
    return result or []


def get_today_standups() -> list[dict]:
    return get_standups_by_date(_today_ist())


def get_person_history(person: str, days: int = 14) -> list[dict]:
    """Get standup history — fetches in one query instead of N file reads."""
    history = convex_db.get_person_standup_history(person, limit=days)
    return history or []


# --- Analytics ---

def _get_all_slugs() -> set[str]:
    """Get all team member slugs from Convex."""
    members = convex_db.list_team_members() or []
    return {m.get("slug") for m in members if m.get("slug")}


def get_standup_stats(date_str: str = None) -> dict:
    date_str = date_str or _today_ist()
    posted_standups = get_standups_by_date(date_str)
    posted_slugs = {s.get("person") for s in posted_standups}

    all_slugs = _get_all_slugs()
    missing = sorted(all_slugs - posted_slugs)

    # Mood average
    mood_values = {"great": 5, "good": 4, "neutral": 3, "struggling": 2, "blocked": 1}
    mood_names = {5: "great", 4: "good", 3: "neutral", 2: "struggling", 1: "blocked"}
    moods = [mood_values.get(s.get("mood", "neutral"), 3) for s in posted_standups]
    avg_mood = round(sum(moods) / len(moods)) if moods else 3
    team_mood = mood_names.get(avg_mood, "neutral")

    blockers_count = len([s for s in posted_standups if s.get("blockers")])

    # Streaks — fetch each person's recent history in one query (not 30 individual reads)
    streaks = {}
    today = date.fromisoformat(date_str) if date_str else date.today()
    for slug in all_slugs:
        person_history = convex_db.get_person_standup_history(slug, limit=30) or []
        # Build set of dates this person posted
        posted_dates = {s.get("date") for s in person_history if s.get("date")}
        streak = 0
        for i in range(30):
            d = today - timedelta(days=i)
            if d.weekday() >= 5:
                continue  # skip weekends
            if d.isoformat() in posted_dates:
                streak += 1
            else:
                break
        streaks[slug] = streak

    weekend = _is_weekend(date_str)

    return {
        "date": date_str,
        "posted": sorted(posted_slugs),
        "missing": [] if weekend else missing,
        "total_team": len(all_slugs),
        "posted_count": len(posted_slugs),
        "missing_count": 0 if weekend else len(missing),
        "is_weekend": weekend,
        "team_mood": team_mood,
        "blockers_count": blockers_count,
        "streaks": streaks,
    }


def get_standup_summary(date_str: str = None) -> dict:
    """Compact summary for PULSE board."""
    date_str = date_str or _today_ist()
    standups = get_standups_by_date(date_str)
    stats = get_standup_stats(date_str)

    blockers = [
        {"person": s.get("person"), "blocker": s.get("blockers")}
        for s in standups if s.get("blockers")
    ]

    mood_dist: dict[str, int] = {}
    highlights = []
    for s in standups:
        m = s.get("mood", "neutral")
        mood_dist[m] = mood_dist.get(m, 0) + 1
        highlights.extend(s.get("highlights", []))

    return {
        "date": date_str,
        "posted_today": stats["posted_count"],
        "missing_today": stats["missing_count"],
        "missing_names": stats["missing"],
        "total_team": stats["total_team"],
        "blockers": blockers,
        "blockers_count": len(blockers),
        "moods": mood_dist,
        "team_mood": stats["team_mood"],
        "highlights": highlights[:6],
        "is_weekend": stats["is_weekend"],
    }
