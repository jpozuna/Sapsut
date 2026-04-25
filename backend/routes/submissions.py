import uuid

import anyio
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, UploadFile
from typing import Any, Dict, Optional

from services import get_supabase
from services.scoring import score_submission
from services.storage import storage_bucket

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


@router.get("/{id}")
async def get_submission(id: str) -> Dict[str, Any]:
    supabase = get_supabase()
    rows = (
        supabase.table("submissions")
        .select(
            "id,task_id,team_id,text_answer,photo_url,status,score,confidence,rationale,gpt4o_description,ai_result,created_at"
        )
        .eq("id", id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Submission not found")
    submission: Dict[str, Any] = rows[0]

    photo_path = submission.get("photo_url")
    if photo_path:
        try:
            signed = await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).create_signed_url(photo_path, 600)
            )
            signed_url = _extract_signed_url(signed)
            if signed_url:
                submission["photo_signed_url"] = signed_url
        except Exception:
            pass

    return submission


@router.get("/")
def list_submissions(
    team_id: str = Query(...),
    task_id: Optional[str] = Query(None),
) -> Any:
    supabase = get_supabase()
    q = (
        supabase.table("submissions")
        .select(
            "id,task_id,team_id,text_answer,photo_url,status,score,confidence,rationale,gpt4o_description,ai_result,created_at"
        )
        .eq("team_id", team_id)
        .order("created_at", desc=True)
    )
    if task_id:
        q = q.eq("task_id", task_id)
    return q.execute().data or []


@router.post("/")
async def create_submission(
    background_tasks: BackgroundTasks,
    task_id: str = Form(...),
    team_id: str = Form(...),
    text_answer: str = Form(None),
    photo: UploadFile = File(None)
):
    submission_id = str(uuid.uuid4())
    supabase = get_supabase()

    try:
        task = (
            supabase.table("tasks")
            .select("id,allow_multiple_submissions")
            .eq("id", task_id)
            .single()
            .execute()
            .data
        )
        allow_multiple = bool(task.get("allow_multiple_submissions", False))
    except Exception:
        # If the column doesn't exist yet (migration not applied), default to single-submission behavior.
        allow_multiple = False

    if not allow_multiple:
        existing = (
            supabase.table("submissions")
            .select("id")
            .eq("task_id", task_id)
            .eq("team_id", team_id)
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
    if not normalized_text_answer.strip() and photo is None:
        return {"error": "Submission must include text_answer or photo."}

    photo_path = None
    if photo is not None:
        # Important: read and upload during the request lifecycle.
        photo_bytes = await photo.read()
        content_type = (photo.content_type or "application/octet-stream").strip()
        ext = (content_type.split("/")[-1] if "/" in content_type else "bin") or "bin"
        photo_path = f"{team_id}/{task_id}/{submission_id}.{ext}"
        try:
            # Supabase Storage upload is synchronous; offload to worker thread.
            await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).upload(
                    photo_path,
                    photo_bytes,
                    file_options={"content-type": content_type, "upsert": True},
                )
            )
        except Exception as e:
            # If photo upload fails, record error immediately and avoid enqueueing scoring.
            submission = {
                "id": submission_id,
                "task_id": task_id,
                "team_id": team_id,
                "text_answer": normalized_text_answer,
                "photo_url": None,
                "status": "error",
                "rationale": f"Photo upload failed: {e}",
                "ai_result": {"mode": "storage_upload", "error": str(e)},
            }
            supabase.table("submissions").insert(submission).execute()
            return {"submission_id": submission_id, "status": "error"}

    submission = {
        "id": submission_id,
        "task_id": task_id,
        "team_id": team_id,
        "text_answer": normalized_text_answer,
        # Persist object path in existing schema column name.
        "photo_url": photo_path,
        "status": "pending"
    }
    supabase.table("submissions").insert(submission).execute()
    
    background_tasks.add_task(score_submission, submission_id, task_id, team_id, normalized_text_answer, photo_path)
    
    return {"submission_id": submission_id, "status": "pending"}
