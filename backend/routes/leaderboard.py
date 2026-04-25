from __future__ import annotations

from fastapi import APIRouter

from services import get_supabase

router = APIRouter()


@router.get("/")
def get_leaderboard():
    supabase = get_supabase()
    try:
        teams = (
            supabase.table("teams")
            .select("id,name,total_score")
            .order("total_score", desc=True)
            .execute()
            .data
        )
    except Exception:
        # If `total_score` doesn't exist yet (migration not applied), fall back to a stable ordering.
        teams = supabase.table("teams").select("id,name").order("name").execute().data
    return {"teams": teams}

