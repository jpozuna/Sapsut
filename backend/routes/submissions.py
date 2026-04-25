import os
import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile

from services import get_supabase
from services.scoring import score_submission

router = APIRouter()


def _storage_bucket() -> str:
    # Default bucket name; can be overridden via env var.
    return os.getenv("SUPABASE_STORAGE_BUCKET", "submissions").strip() or "submissions"


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
    
    photo_path = None
    if photo is not None:
        # Important: read and upload during the request lifecycle.
        photo_bytes = await photo.read()
        content_type = (photo.content_type or "application/octet-stream").strip()
        ext = (content_type.split("/")[-1] if "/" in content_type else "bin") or "bin"
        photo_path = f"submissions/{submission_id}.{ext}"
        try:
            supabase.storage.from_(_storage_bucket()).upload(
                photo_path,
                photo_bytes,
                file_options={"content-type": content_type, "upsert": True},
            )
        except Exception:
            # If photo upload fails, still create the submission and let scoring mark it as error.
            photo_path = None

    submission = {
        "id": submission_id,
        "task_id": task_id,
        "team_id": team_id,
        "text_answer": text_answer,
        # Persist object path in existing schema column name.
        "photo_url": photo_path,
        "status": "pending"
    }
    supabase.table("submissions").insert(submission).execute()
    
    background_tasks.add_task(score_submission, submission_id, task_id, team_id, text_answer, photo_path)
    
    return {"submission_id": submission_id, "status": "pending"}
