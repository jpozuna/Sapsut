from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services import get_supabase

router = APIRouter()


class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    description: Optional[str] = None
    type: Literal["text", "photo", "combo"]
    max_points: int = Field(ge=0)
    rubric: Optional[dict] = None
    is_active: bool = True
    opens_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    allow_multiple_submissions: Optional[bool] = None


@router.get("/")
def list_tasks():
    supabase = get_supabase()
    return supabase.table("tasks").select("*").execute().data


@router.post("/")
def create_task(task: TaskCreate):
    supabase = get_supabase()
    payload = task.model_dump(exclude_none=True)
    try:
        return supabase.table("tasks").insert(payload).execute().data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

