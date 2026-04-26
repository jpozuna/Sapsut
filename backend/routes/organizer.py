from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from auth.organizer import require_organizer
from services import get_supabase
from services.scoring import score_submission, _finalize_score

router = APIRouter(dependencies=[Depends(require_organizer)])


@router.get("/review-queue")
def list_review_queue() -> Any:
    supabase = get_supabase()
    # Join submissions so organizer UI can display submission content per row.
    return (
        supabase.table("review_queue")
        .select(
            "id,submission_id,claude_score,claude_rationale,confidence,created_at,"
            "submission:submissions(id,task_id,team_id,text_answer,photo_url,status,score,confidence,rationale,gpt4o_description,created_at)"
        )
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )


class ReviewActionOk(BaseModel):
    submission_id: str
    status: str
    score: int


def _get_queue_row_or_404(queue_id: str) -> Dict[str, Any]:
    supabase = get_supabase()
    row = (
        supabase.table("review_queue")
        .select("id,submission_id,claude_score,claude_rationale,confidence,created_at")
        .eq("id", queue_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Review queue item not found")
    return row


def _get_submission_or_404(submission_id: str) -> Dict[str, Any]:
    supabase = get_supabase()
    row = (
        supabase.table("submissions")
        .select("id,team_id,status,score")
        .eq("id", submission_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")
    return row


class OverrideIn(BaseModel):
    score: int = Field(ge=0)
    rationale: Optional[str] = None


@router.post("/review-queue/{queue_id}/approve")
def approve_review_queue_item(queue_id: str) -> Dict[str, Any]:
    supabase = get_supabase()
    queue_row = _get_queue_row_or_404(queue_id)
    submission = _get_submission_or_404(queue_row["submission_id"])

    suggested = queue_row.get("claude_score")
    if suggested is None:
        raise HTTPException(status_code=400, detail="Queue item is missing claude_score")

    rationale = (queue_row.get("claude_rationale") or "Organizer approved").strip() or "Organizer approved"
    queue_confidence = queue_row.get("confidence")
    confidence = 1.0 if queue_confidence is None else float(queue_confidence)

    _finalize_score(
        supabase,
        submission_id=submission["id"],
        team_id=submission["team_id"],
        score=int(suggested),
        confidence=confidence,
        rationale=rationale,
        status="reviewed",
        ai_result={"mode": "organizer_approve", "queue_id": queue_id},
    )

    # Remove from queue after decision.
    supabase.table("review_queue").delete().eq("id", queue_id).execute()
    return {"submission_id": submission["id"], "status": "reviewed", "score": int(suggested)}


@router.post("/review-queue/{queue_id}/override")
def override_review_queue_item(queue_id: str, payload: OverrideIn) -> Dict[str, Any]:
    supabase = get_supabase()
    queue_row = _get_queue_row_or_404(queue_id)
    submission = _get_submission_or_404(queue_row["submission_id"])

    rationale = (payload.rationale or "").strip() or "Organizer override"
    _finalize_score(
        supabase,
        submission_id=submission["id"],
        team_id=submission["team_id"],
        score=int(payload.score),
        confidence=1.0,
        rationale=rationale,
        status="reviewed",
        ai_result={
            "mode": "organizer_override",
            "queue_id": queue_id,
            "suggested_score": queue_row.get("claude_score"),
            "suggested_rationale": queue_row.get("claude_rationale"),
        },
    )

    supabase.table("review_queue").delete().eq("id", queue_id).execute()
    return {"submission_id": submission["id"], "status": "reviewed", "score": int(payload.score)}


class RescoreIn(BaseModel):
    force: bool = False


@router.post("/submissions/{submission_id}/rescore")
def rescore_submission(
    submission_id: str,
    payload: RescoreIn,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    supabase = get_supabase()
    row = (
        supabase.table("submissions")
        .select("id,task_id,team_id,text_answer,photo_url,status,score,rationale")
        .eq("id", submission_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    terminal_statuses = {"auto_approved", "reviewed"}
    if (row.get("status") in terminal_statuses) and (not payload.force):
        raise HTTPException(
            status_code=400,
            detail="Submission is already in a terminal state; set force=true to override.",
        )

    try:
        supabase.table("review_queue").insert(
            {
                "submission_id": row["id"],
                "claude_score": int(row.get("score") or 0),
                "claude_rationale": (row.get("rationale") or "Rescore requested").strip() or "Rescore requested",
            }
        ).execute()
    except Exception:
        pass

    background_tasks.add_task(
        score_submission,
        row["id"],
        row["task_id"],
        row["team_id"],
        row.get("text_answer") or "",
        row.get("photo_url"),
        bool(payload.force),
    )
    return {"status": "queued", "submission_id": submission_id, "force": bool(payload.force)}


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

