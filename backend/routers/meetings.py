from fastapi import APIRouter
from datetime import date
import cos_reader

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


@router.get("/today")
def get_today_meetings():
    today = date.today().isoformat()
    data = cos_reader.get_meetings(today)
    if not data:
        return {"meetings": []}

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

    return {"meetings": results, "date": today}


@router.get("/{meeting_date}")
def get_meetings_by_date(meeting_date: str):
    data = cos_reader.get_meetings(meeting_date)
    if not data:
        return {"meetings": [], "date": meeting_date}

    events = data.get("events", data.get("meetings", []))
    results = []
    for i, e in enumerate(events):
        results.append({
            "id": e.get("id", f"meeting-{i}"),
            "title": e.get("summary", e.get("title", "Untitled")),
            "start_time": e.get("start", ""),
            "end_time": e.get("end", ""),
            "meet_link": e.get("hangoutLink", e.get("meet_link", "")),
            "organizer": e.get("organizer", ""),
            "attendees": e.get("attendees", []),
            "description": e.get("description", ""),
        })

    return {"meetings": results, "date": meeting_date}
