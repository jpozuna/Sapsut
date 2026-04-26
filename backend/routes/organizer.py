from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from auth.organizer import require_organizer
from services import get_supabase
from services.scoring import score_submission

router = APIRouter(dependencies=[Depends(require_organizer)])


@router.get("/review-queue")
def list_review_queue() -> Any:
    supabase = get_supabase()
    # Keep it lightweight: return raw queue rows ordered newest first.
    return (
        supabase.table("review_queue")
        .select("*")
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )


@router.post("/submissions/{submission_id}/rescore")
def rescore_submission(submission_id: str, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    supabase = get_supabase()
    row = (
        supabase.table("submissions")
        .select("id,task_id,team_id,text_answer,photo_url,status")
        .eq("id", submission_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    background_tasks.add_task(
        score_submission,
        row["id"],
        row["task_id"],
        row["team_id"],
        row.get("text_answer") or "",
        row.get("photo_url"),
    )
    return {"status": "queued", "submission_id": submission_id}


class CriteriaIn(BaseModel):
    criteria_type: Literal["exact", "rubric", "other"] = Field(default="exact")
    value: str = Field(min_length=1)


class CriteriaUpdateIn(BaseModel):
    criteria: List[CriteriaIn]


@router.put("/tasks/{task_id}/criteria")
def replace_task_criteria(task_id: str, payload: CriteriaUpdateIn) -> Dict[str, Any]:
    supabase = get_supabase()

    # Replace semantics: wipe then insert.
    try:
        supabase.table("task_criteria").delete().eq("task_id", task_id).execute()
    except Exception:
        # If delete isn't supported / table missing, surface a useful error.
        raise HTTPException(status_code=400, detail="Failed to clear existing criteria for task")

    rows: List[Dict[str, Any]] = [
        {"task_id": task_id, "criteria_type": c.criteria_type, "value": c.value} for c in payload.criteria
    ]
    try:
        inserted = supabase.table("task_criteria").insert(rows).execute().data or []
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"task_id": task_id, "inserted": inserted}

