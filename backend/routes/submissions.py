from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks
from services import get_supabase
from services.scoring import score_submission
import uuid

router = APIRouter()

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
    
    submission = {
        "id": submission_id,
        "task_id": task_id,
        "team_id": team_id,
        "text_answer": text_answer,
        "status": "pending"
    }
    supabase.table("submissions").insert(submission).execute()
    
    background_tasks.add_task(score_submission, submission_id, task_id, team_id, text_answer, photo)
    
    return {"submission_id": submission_id, "status": "pending"}
