from __future__ import annotations

import base64
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from auth.organizer import (
    CODE_REQUIRED_DETAIL,
    format_expiry,
    issue_session_token,
    require_organizer,
)
from services import get_supabase
from services.scoring import _get_openai_client, score_submission, _finalize_score
from services.storage import storage_bucket
from services.uploads import read_validated_image

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_organizer)])


@router.post("/session")
def create_organizer_session(request: Request) -> Dict[str, str]:
    """Exchange a valid X-Organizer-Code for a 24h signed session token.

    The router guard has already validated (and rate limited) the credentials. A
    session token cannot be used to mint another one, so a leaked token can't be
    extended; only the code can.
    """
    if getattr(request.state, "organizer_auth", None) != "code":
        raise HTTPException(status_code=401, detail=CODE_REQUIRED_DETAIL)
    code = (os.getenv("ORGANIZER_DEMO_CODE") or "").strip()
    token, expires_at = issue_session_token(code)
    return {"token": token, "expires_at": format_expiry(expires_at)}


@router.get("/session")
def organizer_session(request: Request) -> Dict[str, Any]:
    """Verify a session token or organizer code. The router guard returns 401 if bad."""
    expires_at = getattr(request.state, "organizer_expires_at", None)
    return {
        "ok": True,
        "expires_at": format_expiry(expires_at) if expires_at is not None else None,
    }


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


def _try_insert_review_history(
    *,
    queue_id: str,
    submission_id: str,
    decision: Literal["approve", "override"],
    final_score: int,
    final_rationale: str,
    suggested_score: Optional[int],
    suggested_rationale: Optional[str],
) -> None:
    """
    Best-effort insert into `review_queue_history`.

    This table may not exist in all environments yet; we don't want to block organizer actions.
    """
    supabase = get_supabase()
    try:
        supabase.table("review_queue_history").insert(
            {
                "queue_id": queue_id,
                "submission_id": submission_id,
                "decision": decision,
                "final_score": int(final_score),
                "final_rationale": (final_rationale or "").strip(),
                "suggested_score": None if suggested_score is None else int(suggested_score),
                "suggested_rationale": (suggested_rationale or "").strip() or None,
            }
        ).execute()
    except Exception:
        # Best-effort history; never block the primary action.
        pass


class ReviewActionOk(BaseModel):
    submission_id: str
    status: str
    score: int


class OrganizerTaskCreateIn(BaseModel):
    title: str = Field(min_length=1)
    description: Optional[str] = None
    type: Literal["text", "photo", "combo"]
    max_points: int = Field(ge=0)
    rubric: Optional[dict] = None
    is_active: bool = True
    opens_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    allow_multiple_submissions: Optional[bool] = None


@router.post("/tasks")
def organizer_create_task(task: OrganizerTaskCreateIn) -> Any:
    supabase = get_supabase()
    payload = task.model_dump(exclude_none=True)
    try:
        return supabase.table("tasks").insert(payload).execute().data
    except Exception:
        logger.exception("Failed to create task")
        raise HTTPException(status_code=400, detail="Failed to create task")


@router.get("/tasks/{task_id}")
def organizer_get_task(task_id: str) -> Any:
    supabase = get_supabase()
    try:
        return supabase.table("tasks").select("*").eq("id", task_id).single().execute().data
    except Exception:
        logger.exception("Failed to load task %s", task_id)
        raise HTTPException(status_code=404, detail="Task not found")


@router.put("/tasks/{task_id}")
def organizer_update_task(task_id: str, task: OrganizerTaskCreateIn) -> Any:
    supabase = get_supabase()
    payload = task.model_dump(exclude_none=True)
    try:
        return supabase.table("tasks").update(payload).eq("id", task_id).execute().data
    except Exception:
        logger.exception("Failed to update task %s", task_id)
        raise HTTPException(status_code=400, detail="Failed to update task")


class RubricOcrOut(BaseModel):
    text: str
    criteria: List[str]


@router.post("/tasks/{task_id}/rubric-ocr", response_model=RubricOcrOut)
async def ocr_rubric_image(task_id: str, image: UploadFile = File(...)) -> RubricOcrOut:
    # Validate UUID early.
    try:
        uuid.UUID(str(task_id))
    except Exception:
        raise HTTPException(status_code=400, detail="task_id must be a UUID")

    # Type (415) and size (413) are checked before OCR; reads at most 10 MB + 1 byte.
    validated = await read_validated_image(image)

    b64 = base64.b64encode(validated.data).decode("utf-8")
    image_mime = validated.content_type

    try:
        openai_client = _get_openai_client()
        resp = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{b64}"}},
                        {
                            "type": "text",
                            "text": (
                                "Extract the rubric text from this image.\n"
                                "Return plain text only (no markdown), preserving line breaks."
                            ),
                        },
                    ],
                }
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
    except Exception:
        logger.exception("Rubric OCR failed for task %s", task_id)
        raise HTTPException(status_code=400, detail="OCR failed")

    # Heuristic: split into criteria lines.
    lines = [ln.strip(" \t-•*") for ln in text.splitlines()]
    criteria = [ln for ln in lines if ln]
    return RubricOcrOut(text=text, criteria=criteria[:50])


def _extract_signed_url(resp: Any) -> Optional[str]:
    if not resp:
        return None
    if isinstance(resp, str):
        return resp
    if isinstance(resp, dict):
        for k in ("signedURL", "signed_url", "signedUrl", "url"):
            v = resp.get(k)
            if isinstance(v, str) and v:
                return v
        data = resp.get("data")
        if isinstance(data, dict):
            for k in ("signedURL", "signed_url", "signedUrl", "url"):
                v = data.get(k)
                if isinstance(v, str) and v:
                    return v
    return None


@router.post("/tasks/{task_id}/photos")
async def upload_task_photo(task_id: str, photo: UploadFile = File(...)) -> Dict[str, Any]:
    supabase = get_supabase()
    try:
        uuid.UUID(str(task_id))
    except Exception:
        raise HTTPException(status_code=400, detail="task_id must be a UUID")

    # Type (415) and size (413) are checked before anything is stored.
    validated = await read_validated_image(photo)
    photo_bytes = validated.data
    content_type = validated.content_type
    photo_id = str(uuid.uuid4())
    stored_path = f"tasks/{task_id}/{photo_id}.{validated.ext}"

    try:
        await anyio.to_thread.run_sync(
            lambda: supabase.storage.from_(storage_bucket()).upload(
                stored_path,
                photo_bytes,
                file_options={"content-type": content_type},
            )
        )
    except Exception:
        logger.exception("Photo upload failed for task %s", task_id)
        raise HTTPException(status_code=400, detail="Photo upload failed")

    row = {"id": photo_id, "task_id": task_id, "path": stored_path}
    try:
        inserted = supabase.table("task_photos").insert(row).execute().data
    except Exception:
        logger.exception("Failed to record task photo for task %s", task_id)
        raise HTTPException(status_code=400, detail="Failed to record task photo")

    return {"task_id": task_id, "photo": (inserted[0] if inserted else row)}


@router.get("/tasks/{task_id}/photos")
async def list_task_photos(task_id: str) -> Any:
    supabase = get_supabase()
    try:
        uuid.UUID(str(task_id))
    except Exception:
        raise HTTPException(status_code=400, detail="task_id must be a UUID")

    try:
        rows = (
            supabase.table("task_photos")
            .select("id,task_id,path,created_at")
            .eq("task_id", task_id)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
    except Exception:
        return []

    async def _signed(path: str) -> Optional[str]:
        try:
            signed = await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).create_signed_url(path, 600)
            )
            return _extract_signed_url(signed)
        except Exception:
            return None

    for r in rows:
        path = r.get("path")
        if isinstance(path, str) and path:
            r["signed_url"] = await _signed(path)

    return rows


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
        .select("id,task_id,team_id,status,score")
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

    _try_insert_review_history(
        queue_id=queue_id,
        submission_id=submission["id"],
        decision="approve",
        final_score=int(suggested),
        final_rationale=rationale,
        suggested_score=int(suggested),
        suggested_rationale=queue_row.get("claude_rationale"),
    )

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

    task = (
        supabase.table("tasks")
        .select("id,max_points")
        .eq("id", submission.get("task_id"))
        .maybe_single()
        .execute()
        .data
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    max_points = int(task.get("max_points") or 0)
    if int(payload.score) > max_points:
        raise HTTPException(
            status_code=400,
            detail=f"Score cannot exceed the task's maximum of {max_points} points.",
        )

    rationale = (payload.rationale or "").strip() or "Organizer override"

    _try_insert_review_history(
        queue_id=queue_id,
        submission_id=submission["id"],
        decision="override",
        final_score=int(payload.score),
        final_rationale=rationale,
        suggested_score=queue_row.get("claude_score"),
        suggested_rationale=queue_row.get("claude_rationale"),
    )

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


@router.get("/review-history")
def list_review_history(limit: int = 100) -> Any:
    supabase = get_supabase()
    safe_limit = max(1, min(int(limit), 500))
    try:
        rows = (
            supabase.table("review_queue_history")
            .select(
                "id,queue_id,submission_id,decision,final_score,final_rationale,suggested_score,suggested_rationale,created_at,"
                "submission:submissions(id,task_id,team_id,text_answer,photo_url,status,score,confidence,rationale,gpt4o_description,created_at)"
            )
            .order("created_at", desc=True)
            .limit(safe_limit)
            .execute()
            .data
            or []
        )
        # If the table exists and has rows, return it.
        if rows:
            return rows
    except Exception:
        rows = []

    # Fallback: derive organizer history from `submissions.ai_result`, which is always
    # written on approve/override/auto_approve.
    try:
        subs = (
            supabase.table("submissions")
            .select(
                "id,task_id,team_id,text_answer,photo_url,status,score,confidence,rationale,gpt4o_description,ai_result,created_at"
            )
            .order("created_at", desc=True)
            .limit(max(50, safe_limit * 5))
            .execute()
            .data
            or []
        )
    except Exception:
        subs = []

    out: List[Dict[str, Any]] = []
    for s in subs:
        ai = s.get("ai_result") if isinstance(s, dict) else None
        if not isinstance(ai, dict):
            continue
        mode = str(ai.get("mode") or "").strip()
        if mode not in {"organizer_approve", "organizer_override", "auto_approve"}:
            continue

        decision = (
            "approve"
            if mode == "organizer_approve"
            else "override"
            if mode == "organizer_override"
            else "auto_approve"
        )
        out.append(
            {
                "id": f"sub_{s.get('id')}",
                "queue_id": ai.get("queue_id"),
                "submission_id": s.get("id"),
                "decision": decision,
                "final_score": s.get("score"),
                "final_rationale": s.get("rationale"),
                "suggested_score": ai.get("suggested_score") if decision == "override" else s.get("score"),
                "suggested_rationale": ai.get("suggested_rationale") if decision == "override" else s.get("rationale"),
                "created_at": s.get("created_at"),
                "submission": {
                    "id": s.get("id"),
                    "task_id": s.get("task_id"),
                    "team_id": s.get("team_id"),
                    "text_answer": s.get("text_answer"),
                    "photo_url": s.get("photo_url"),
                    "status": s.get("status"),
                    "score": s.get("score"),
                    "confidence": s.get("confidence"),
                    "rationale": s.get("rationale"),
                    "gpt4o_description": s.get("gpt4o_description"),
                    "created_at": s.get("created_at"),
                },
            }
        )
        if len(out) >= safe_limit:
            break

    return out


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
        # If delete isn't supported / table missing, surface a generic error.
        logger.exception("Failed to clear criteria for task %s", task_id)
        raise HTTPException(status_code=400, detail="Failed to clear existing criteria for task")

    rows: List[Dict[str, Any]] = [
        {"task_id": task_id, "criteria_type": c.criteria_type, "value": c.value} for c in payload.criteria
    ]
    try:
        inserted = supabase.table("task_criteria").insert(rows).execute().data or []
    except Exception:
        logger.exception("Failed to insert criteria for task %s", task_id)
        raise HTTPException(status_code=400, detail="Failed to save task criteria")

    return {"task_id": task_id, "inserted": inserted}

