from fastapi import APIRouter
from datetime import date
import convex_db

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _format_events(data: dict) -> list[dict]:
    events = data.get("events", data.get("meetings", []))
    results = []
    for i, e in enumerate(events):
        results.append({
            "id": e.get("id", f"meeting-{i}"),
            "title": e.get("summary", e.get("title", "Untitled")),
            "start_time": e.get("start", ""),
            "end_time": e.get("end", ""),
            "meet_link": e.get("hangoutLink", e.get("meet_link", "")),
            "phone": e.get("phone", ""),
            "organizer": e.get("organizer", ""),
            "attendees": e.get("attendees", []),
            "description": e.get("description", ""),
        })
    return results


@router.get("/today")
def get_today_meetings():
    today = date.today().isoformat()
    data = convex_db.get_meetings(today)
    if not data:
        return {"meetings": [], "date": today}
    return {"meetings": _format_events(data), "date": today}


@router.get("/{meeting_date}")
def get_meetings_by_date(meeting_date: str):
    data = convex_db.get_meetings(meeting_date)
    if not data:
        return {"meetings": [], "date": meeting_date}
    return {"meetings": _format_events(data), "date": meeting_date}
