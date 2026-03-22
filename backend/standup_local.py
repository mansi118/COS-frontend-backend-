"""Daily standup storage — JSON files in data/standups/YYYY-MM-DD/{person}.json"""

import json
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional
import cos_reader

COS_WORKSPACE = os.getenv("COS_WORKSPACE", "/home/mansigambhir/.openclaw/workspace")
STANDUPS_DIR = os.path.join(COS_WORKSPACE, "data", "standups")
IST = timezone(timedelta(hours=5, minutes=30))


def _today_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def _now_ist() -> str:
    return datetime.now(IST).isoformat()


def _ensure_dir(date_str: str):
    os.makedirs(os.path.join(STANDUPS_DIR, date_str), exist_ok=True)


def _read_json(path: str) -> Optional[dict]:
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write_json(path: str, data: dict):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)


def _extract_highlights(done: str) -> list[str]:
    """Extract key phrases from done text — first sentence per line, capped at 3."""
    if not done:
        return []
    lines = [l.strip().lstrip("- •").strip() for l in done.split("\n") if l.strip()]
    highlights = []
    for line in lines[:3]:
        # Take first sentence or first 60 chars
        sentence = line.split(".")[0].strip()
        if sentence:
            highlights.append(sentence[:60])
    return highlights


def _resolve_name(person: str) -> str:
    roster = cos_reader.get_team_roster()
    if roster:
        for r in roster:
            if r.get("slug") == person:
                return r.get("name", person)
    return person


def _is_weekend(date_str: str) -> bool:
    try:
        d = date.fromisoformat(date_str)
        return d.weekday() >= 5  # 5=Sat, 6=Sun
    except (ValueError, TypeError):
        return False


# --- Core CRUD ---

def post_standup(person: str, data: dict) -> dict:
    today = _today_ist()
    _ensure_dir(today)

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

    # Check if already posted today — preserve created_at
    existing = get_standup(person, today)
    if existing:
        standup["created_at"] = existing.get("created_at", standup["created_at"])

    path = os.path.join(STANDUPS_DIR, today, f"{person}.json")
    _write_json(path, standup)
    return standup


def get_standup(person: str, date_str: str = None) -> Optional[dict]:
    date_str = date_str or _today_ist()
    path = os.path.join(STANDUPS_DIR, date_str, f"{person}.json")
    return _read_json(path)


def update_standup(person: str, data: dict) -> Optional[dict]:
    today = _today_ist()
    existing = get_standup(person, today)
    if not existing:
        return None
    for key in ("done", "doing", "blockers", "mood", "linked_tasks"):
        if key in data:
            existing[key] = data[key]
    existing["highlights"] = _extract_highlights(existing.get("done", ""))
    existing["updated_at"] = _now_ist()
    path = os.path.join(STANDUPS_DIR, today, f"{person}.json")
    _write_json(path, existing)
    return existing


# --- Listing ---

def get_standups_by_date(date_str: str = None) -> list[dict]:
    date_str = date_str or _today_ist()
    day_dir = os.path.join(STANDUPS_DIR, date_str)
    if not os.path.isdir(day_dir):
        return []
    standups = []
    for fname in sorted(os.listdir(day_dir)):
        if fname.endswith(".json"):
            data = _read_json(os.path.join(day_dir, fname))
            if data:
                standups.append(data)
    return standups


def get_today_standups() -> list[dict]:
    return get_standups_by_date(_today_ist())


def get_person_history(person: str, days: int = 14) -> list[dict]:
    today = date.today()
    history = []
    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        standup = get_standup(person, d)
        if standup:
            history.append(standup)
    return history


# --- Analytics ---

def get_standup_stats(date_str: str = None) -> dict:
    date_str = date_str or _today_ist()
    posted_standups = get_standups_by_date(date_str)
    posted_slugs = {s.get("person") for s in posted_standups}

    roster = cos_reader.get_team_roster() or []
    all_slugs = {r.get("slug") for r in roster if r.get("slug")}
    missing = sorted(all_slugs - posted_slugs)

    # Mood average
    mood_values = {"great": 5, "good": 4, "neutral": 3, "struggling": 2, "blocked": 1}
    mood_names = {5: "great", 4: "good", 3: "neutral", 2: "struggling", 1: "blocked"}
    moods = [mood_values.get(s.get("mood", "neutral"), 3) for s in posted_standups]
    avg_mood = round(sum(moods) / len(moods)) if moods else 3
    team_mood = mood_names.get(avg_mood, "neutral")

    blockers_count = len([s for s in posted_standups if s.get("blockers")])

    # Streaks (consecutive weekdays posted)
    streaks = {}
    today = date.fromisoformat(date_str) if date_str else date.today()
    for slug in all_slugs:
        streak = 0
        for i in range(30):
            d = today - timedelta(days=i)
            if d.weekday() >= 5:
                continue  # skip weekends
            if get_standup(slug, d.isoformat()):
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
