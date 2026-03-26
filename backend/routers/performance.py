from fastapi import APIRouter, Query
import convex_db
import cos_reader

router = APIRouter(prefix="/api/performance", tags=["performance"])


@router.get("/report")
def get_performance_report(
    period: str = Query("biweekly"),
):
    # Primary: CoS workspace
    perf_data = cos_reader.get_performance_data()
    roster = cos_reader.get_team_roster()

    if perf_data and roster:
        roster_map = {r["slug"]: r for r in roster}
        report = []
        for p in perf_data:
            slug = p.get("person", "")
            member = roster_map.get(slug, {})
            report.append({
                "name": p.get("name", member.get("name", slug)),
                "slug": slug,
                "emoji": "",
                "score": p.get("score"),
                "rating": p.get("rating"),
                "total_assigned": p.get("total_assigned"),
                "total_completed": p.get("total_completed"),
                "completion_rate": p.get("completion_rate"),
                "on_time_rate": p.get("on_time_rate"),
                "overdue_count": p.get("overdue_count"),
                "period_days": p.get("period_days"),
                "open_count": p.get("open_count"),
                "carry_rate": p.get("carry_rate"),
            })
        report.sort(key=lambda x: x.get("score") or 0, reverse=True)
        return {"period": period, "team": report}

    # Fallback: Convex
    perf_all = convex_db.list_performance() or []
    members = convex_db.list_team_members() or []
    member_map = {m.get("slug"): m for m in members}
    report = []
    for p in perf_all:
        slug = p.get("person", "")
        m = member_map.get(slug, {})
        report.append({
            "name": m.get("name", slug),
            "slug": slug,
            "emoji": "",
            "score": p.get("score"),
            "rating": p.get("rating"),
            "total_assigned": p.get("total_assigned"),
            "total_completed": p.get("total_completed"),
            "completion_rate": p.get("completion_rate"),
            "on_time_rate": p.get("on_time_rate"),
            "overdue_count": p.get("overdue_count"),
        })
    report.sort(key=lambda x: x.get("score") or 0, reverse=True)
    return {"period": period, "team": report}


@router.get("/flag")
def get_flagged_performers():
    # Primary: CoS workspace
    perf_data = cos_reader.get_performance_data()
    roster = cos_reader.get_team_roster()

    if perf_data and roster:
        roster_map = {r["slug"]: r for r in roster}
        flagged = []
        for p in perf_data:
            if (p.get("score") or 100) < 65:
                slug = p.get("person", "")
                member = roster_map.get(slug, {})
                flagged.append({
                    "name": p.get("name", member.get("name", slug)),
                    "slug": slug,
                    "score": p.get("score"),
                    "rating": p.get("rating"),
                    "on_time_rate": p.get("on_time_rate"),
                    "overdue_count": p.get("overdue_count"),
                })
        return {"flagged": flagged}

    # Fallback: Convex
    perf_all = convex_db.list_performance() or []
    members = convex_db.list_team_members() or []
    member_map = {m.get("slug"): m for m in members}
    flagged = []
    for p in perf_all:
        if (p.get("score") or 100) < 65:
            slug = p.get("person", "")
            m = member_map.get(slug, {})
            flagged.append({
                "name": m.get("name", slug),
                "slug": slug,
                "score": p.get("score"),
                "rating": p.get("rating"),
                "on_time_rate": p.get("on_time_rate"),
                "overdue_count": p.get("overdue_count"),
            })
    return {"flagged": flagged}


@router.get("/{person}")
def get_person_performance(person: str):
    # Primary: CoS workspace
    perf = cos_reader.get_person_performance(person)
    roster = cos_reader.get_team_roster()

    if perf:
        roster_map = {r["slug"]: r for r in roster} if roster else {}
        member = roster_map.get(person, {})
        return {
            "name": perf.get("name", member.get("name", person)),
            "slug": person,
            "emoji": "",
            "role": member.get("role", ""),
            "score": perf.get("score"),
            "rating": perf.get("rating"),
            "total_assigned": perf.get("total_assigned"),
            "total_completed": perf.get("total_completed"),
            "completion_rate": perf.get("completion_rate"),
            "on_time_rate": perf.get("on_time_rate"),
            "overdue_count": perf.get("overdue_count"),
            "period": f"{perf.get('period_days', 14)} days",
            "period_days": perf.get("period_days"),
            "open_count": perf.get("open_count"),
            "carry_rate": perf.get("carry_rate"),
            "evaluated_at": perf.get("evaluated_at"),
        }

    # Fallback: Convex
    member = convex_db.get_team_member(person)
    if not member:
        return {"error": "Person not found"}
    snap = convex_db.get_performance(person)
    if not snap:
        return {"error": "No performance data"}
    return {
        "name": member.get("name", person),
        "slug": person,
        "emoji": "",
        "role": member.get("role", ""),
        "score": snap.get("score"),
        "rating": snap.get("rating"),
        "total_assigned": snap.get("total_assigned"),
        "total_completed": snap.get("total_completed"),
        "completion_rate": snap.get("completion_rate"),
        "on_time_rate": snap.get("on_time_rate"),
        "overdue_count": snap.get("overdue_count"),
        "period": snap.get("period"),
    }


@router.get("/{person}/history")
def get_person_history(person: str):
    # Primary: CoS workspace
    perf = cos_reader.get_person_performance(person)
    if perf:
        return {
            "person": person,
            "history": [
                {
                    "date": perf.get("evaluated_at", "")[:10] if perf.get("evaluated_at") else None,
                    "score": perf.get("score"),
                    "completion_rate": perf.get("completion_rate"),
                    "on_time_rate": perf.get("on_time_rate"),
                    "overdue_count": perf.get("overdue_count"),
                    "period": f"{perf.get('period_days', 14)} days",
                }
            ],
        }

    # Fallback: Convex
    perf_all = convex_db.list_performance() or []
    person_snaps = [p for p in perf_all if p.get("person") == person]
    person_snaps.sort(key=lambda x: x.get("evaluated_at", ""))
    return {
        "person": person,
        "history": [
            {
                "date": s.get("evaluated_at", "")[:10] if s.get("evaluated_at") else None,
                "score": s.get("score"),
                "completion_rate": s.get("completion_rate"),
                "on_time_rate": s.get("on_time_rate"),
                "overdue_count": s.get("overdue_count"),
                "period": s.get("period"),
            }
            for s in person_snaps
        ],
    }
