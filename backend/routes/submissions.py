import logging
import re
import uuid

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from typing import Any, Dict, Optional

from postgrest.exceptions import APIError

from auth.organizer import require_organizer
from auth.team import canonical_team_id, require_team
from services import get_supabase
from services.scoring import score_submission
from services.storage import storage_bucket
from services.uploads import ALLOWED_IMAGE_TYPES, read_validated_image

logger = logging.getLogger(__name__)

router = APIRouter()


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


# Participant-visible columns. Everything else on the row (ai_result, confidence,
# gpt4o_description, raw photo_url) stays server-side: it can include the expected
# answer or scoring criteria. Organizer routes return the full row separately.
_PARTICIPANT_FIELDS = (
    "id",
    "task_id",
    "team_id",
    "text_answer",
    "status",
    "score",
    "rationale",
    "created_at",
)
_PARTICIPANT_COLUMNS = ",".join(_PARTICIPANT_FIELDS)

# `rationale` is free model text produced from a prompt that contains every
# criterion for the task, so it can quote the expected answer. Participants get a
# fixed message per status instead; the stored rationale is untouched.
_PARTICIPANT_RATIONALE = {
    "approved": "Your submission was approved.",
    "auto_approved": "Your submission was approved.",
    "reviewed": "An organizer reviewed your submission.",
    "flagged": "Your submission is awaiting organizer review.",
    "error": "Please try again.",
}


# Scores are shown only once final. A flagged score is an unreviewed model score,
# and showing it would let a team probe the rubric by resubmitting variants.
_PARTICIPANT_SCORED_STATUSES = {"approved", "auto_approved", "reviewed"}


def _participant_view(row: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: row.get(k) for k in _PARTICIPANT_FIELDS}
    status = str(row.get("status") or "").strip().lower()
    out["rationale"] = _PARTICIPANT_RATIONALE.get(status)
    if status not in _PARTICIPANT_SCORED_STATUSES:
        out["score"] = None
    return out


_TEAM_MISMATCH_DETAIL = "Team mismatch."

_UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
# Uploads before T-07 stored JPEGs as ".jpeg"; those rows are still server-generated.
_LEGACY_PHOTO_EXTENSIONS = {"jpeg"}
_PHOTO_EXTENSIONS = "|".join(
    sorted(re.escape(e) for e in set(ALLOWED_IMAGE_TYPES.values()) | _LEGACY_PHOTO_EXTENSIONS)
)


def _check_team_param(supplied: Optional[str], token_team_id: str) -> None:
    """403 if the client sent a team_id that is not the token's team."""
    if supplied is None:
        return
    if canonical_team_id(supplied) != token_team_id:
        raise HTTPException(status_code=403, detail=_TEAM_MISMATCH_DETAIL)


def _signable_photo_path(row: Dict[str, Any]) -> Optional[str]:
    """The row's photo path if the server could have generated it, else None.

    Only `{team_id}/{task_id}/<uuid>.<ext>` built from the row's own ids is signed.
    Older rows written through the removed `photo_path` field can hold any path.
    """
    path = row.get("photo_url")
    if not isinstance(path, str) or not path:
        return None
    team = canonical_team_id(row.get("team_id"))
    task = canonical_team_id(row.get("task_id"))
    if team is None or task is None:
        return None
    pattern = f"{re.escape(team)}/{re.escape(task)}/{_UUID_PATTERN}\\.(?:{_PHOTO_EXTENSIONS})"
    return path if re.fullmatch(pattern, path) else None


@router.get("/{id}")
async def get_submission(id: str, team_id: str = Depends(require_team)) -> Dict[str, Any]:
    # A non-UUID id can't exist, and sending it to a uuid column makes PostgREST fail.
    submission_id = canonical_team_id(id)
    if submission_id is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    supabase = get_supabase()
    rows = (
        supabase.table("submissions")
        .select(f"{_PARTICIPANT_COLUMNS},photo_url")
        .eq("id", submission_id)
        .limit(1)
        .execute()
        .data
    )
    # Another team's row looks the same as a missing one.
    if not rows or canonical_team_id(rows[0].get("team_id")) != team_id:
        raise HTTPException(status_code=404, detail="Submission not found")
    row: Dict[str, Any] = rows[0]
    submission = _participant_view(row)

    photo_path = _signable_photo_path(row)
    if photo_path:
        try:
            signed = await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).create_signed_url(photo_path, 600)
            )
            signed_url = _extract_signed_url(signed)
            if signed_url:
                submission["photo_signed_url"] = signed_url
        except Exception:
            logger.warning("Signing the photo for submission %s failed", submission_id)
    elif row.get("photo_url"):
        logger.warning("Submission %s has a photo path that is not signable", submission_id)

    return submission


@router.get("/")
def list_submissions(
    token_team_id: str = Depends(require_team),
    team_id: Optional[str] = Query(None),
    task_id: Optional[str] = Query(None),
) -> Any:
    _check_team_param(team_id, token_team_id)
    supabase = get_supabase()
    q = (
        supabase.table("submissions")
        .select(_PARTICIPANT_COLUMNS)
        .eq("team_id", token_team_id)
        .order("created_at", desc=True)
    )
    if task_id:
        canonical_task_id = canonical_team_id(task_id)
        if canonical_task_id is None:
            raise HTTPException(status_code=400, detail="task_id must be a UUID")
        q = q.eq("task_id", canonical_task_id)
    return [_participant_view(r) for r in (q.execute().data or [])]


@router.post("/")
async def create_submission(
    background_tasks: BackgroundTasks,
    task_id: str = Form(...),
    team_id: Optional[str] = Form(None),
    text_answer: str = Form(None),
    photo: UploadFile = File(None),
    token_team_id: str = Depends(require_team),
):
    # The team always comes from the token. A client team_id is only checked against it.
    _check_team_param(team_id, token_team_id)
    team_id = token_team_id

    # Validate the id early; PostgREST returns a 500 if we send non-UUID text into uuid columns.
    # Canonical form keeps the storage path matching what GET /submissions/{id} will sign.
    canonical_task_id = canonical_team_id(task_id)
    if canonical_task_id is None:
        raise HTTPException(status_code=400, detail="task_id must be a UUID")
    task_id = canonical_task_id

    submission_id = str(uuid.uuid4())
    supabase = get_supabase()

    try:
        task = (
            supabase.table("tasks")
            .select("id,type,allow_multiple_submissions")
            .eq("id", task_id)
            .single()
            .execute()
            .data
        )
        allow_multiple = bool(task.get("allow_multiple_submissions", False))
        task_type = (task.get("type") or "").strip()
    except Exception:
        # If the column doesn't exist yet (migration not applied), default to single-submission behavior.
        allow_multiple = False
        task_type = ""

    if not allow_multiple:
        existing = (
            supabase.table("submissions")
            .select("id")
            .eq("task_id", task_id)
            .eq("team_id", team_id)
            # A failed upload leaves an error row; it must not block a retry.
            .neq("status", "error")
            .limit(1)
            .execute()
            .data
        )
        if existing:
            return {
                "error": "This task only allows one submission per team.",
                "existing_submission_id": existing[0]["id"],
            }

    normalized_text_answer = text_answer or ""

    wants_text = task_type in {"text", "combo"}
    wants_photo = task_type in {"photo", "combo"}

    # Enforce at least one valid input.
    if wants_text and not wants_photo:
        if not normalized_text_answer.strip():
            return {"error": "Submission must include text_answer."}
    else:
        if (not normalized_text_answer.strip()) and (photo is None):
            return {"error": "Submission must include text_answer or photo."}

    stored_photo_path: Optional[str] = None
    if photo is not None:
        # Important: read and upload during the request lifecycle.
        # Validates type (415) and size (413) before anything is stored or inserted.
        validated = await read_validated_image(photo)
        photo_bytes = validated.data
        content_type = validated.content_type
        stored_photo_path = f"{team_id}/{task_id}/{submission_id}.{validated.ext}"
        try:
            # Supabase Storage upload is synchronous; offload to worker thread.
            await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).upload(
                    stored_photo_path,
                    photo_bytes,
                    # supabase-py passes these through to HTTP headers; values must be strings.
                    file_options={"content-type": content_type},
                )
            )
        except Exception:
            # If photo upload fails, record error immediately and avoid enqueueing scoring.
            logger.exception("Photo upload failed for submission %s", submission_id)
            submission = {
                "id": submission_id,
                "task_id": task_id,
                "team_id": team_id,
                "text_answer": normalized_text_answer,
                "photo_url": None,
                "status": "error",
                "rationale": "Photo upload failed",
                "ai_result": {"mode": "storage_upload", "error": "Photo upload failed"},
            }
            try:
                supabase.table("submissions").insert(submission).execute()
            except Exception:
                # Don't mask the storage error with a DB insert failure.
                logger.exception("Failed to record upload-error submission %s", submission_id)
            return {"submission_id": submission_id, "status": "error"}

    submission = {
        "id": submission_id,
        "task_id": task_id,
        "team_id": team_id,
        "text_answer": normalized_text_answer,
        # Persist object path in existing schema column name.
        "photo_url": stored_photo_path,
        "status": "pending"
    }
    try:
        supabase.table("submissions").insert(submission).execute()
    except APIError:
        # Convert PostgREST errors into a client-friendly 4xx without leaking DB details.
        logger.exception("Submission insert failed for submission %s", submission_id)
        raise HTTPException(status_code=400, detail="Invalid submission payload")
    
    background_tasks.add_task(score_submission, submission_id, task_id, team_id, normalized_text_answer, stored_photo_path, False)
    
    return {"submission_id": submission_id, "status": "pending"}


class RescoreIn(BaseModel):
    force: bool = False


@router.post("/{id}/rescore", dependencies=[Depends(require_organizer)])
def rescore_submission(
    id: str,
    payload: RescoreIn,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    supabase = get_supabase()

    row = (
        supabase.table("submissions")
        .select("id,task_id,team_id,text_answer,photo_url,status,score,rationale,ai_result")
        .eq("id", id)
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

    # Audit trail: `review_queue` requires NOT NULL suggested_score and claude_rationale.
    try:
        supabase.table("review_queue").insert(
            {
                "submission_id": row["id"],
                "claude_score": int(row.get("score") or 0),
                "claude_rationale": (row.get("rationale") or "Rescore requested").strip() or "Rescore requested",
            }
        ).execute()
    except Exception:
        # Avoid blocking rescore if audit logging fails (e.g., table missing in dev).
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
    return {"status": "queued", "submission_id": row["id"], "force": bool(payload.force)}
