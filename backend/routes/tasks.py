from __future__ import annotations

from fastapi import APIRouter

from services import get_supabase

router = APIRouter()


@router.get("/")
def list_tasks():
    supabase = get_supabase()
    return supabase.table("tasks").select("*").execute().data
