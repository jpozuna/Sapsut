import uuid

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from typing import Any, Dict, Optional

from io import BytesIO

from postgrest.exceptions import APIError

from auth.organizer import require_organizer
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


def _is_allowed_rubric_upload(filename: str, content_type: str) -> Optional[str]:
    """
    Returns 'pdf' or 'docx' if allowed, else None.
    Best-effort: checks both filename extension and MIME type.
    """
    fn = (filename or "").lower().strip()
    ct = (content_type or "").lower().strip()

    if fn.endswith(".pdf") or ct == "application/pdf":
        return "pdf"

    docx_mimes = {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        # Some clients mislabel; keep a small allowance.
        "application/octet-stream",
    }
    if fn.endswith(".docx") or ct in docx_mimes:
        return "docx"

    return None


def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(pdf_bytes))
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            parts.append("")
    return "\n".join(parts).strip()


def _extract_text_from_docx(docx_bytes: bytes) -> str:
    from docx import Document

    doc = Document(BytesIO(docx_bytes))
    parts = []
    for p in doc.paragraphs:
        if p.text:
            parts.append(p.text)
    return "\n".join(parts).strip()


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

    file_path = submission.get("file_url")
    if file_path:
        try:
            signed = await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).create_signed_url(file_path, 600)
            )
            signed_url = _extract_signed_url(signed)
            if signed_url:
                submission["file_signed_url"] = signed_url
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
    photo_path: str = Form(None),
    photo: UploadFile = File(None),
    rubric_file: UploadFile = File(None),
):
    # Validate ids early; PostgREST returns a 500 if we send non-UUID text into uuid columns.
    try:
        uuid.UUID(str(task_id))
    except Exception:
        raise HTTPException(status_code=400, detail="task_id must be a UUID")

    try:
        uuid.UUID(str(team_id))
    except Exception:
        raise HTTPException(status_code=400, detail="team_id must be a UUID")

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
    normalized_photo_path = (photo_path or "").strip() or None

    has_text = bool(normalized_text_answer.strip())
    has_rubric_file = rubric_file is not None
    if has_text and has_rubric_file:
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one input method: either text_answer or rubric_file.",
        )

    wants_text = task_type in {"text", "combo"}
    wants_photo = task_type in {"photo", "combo"}

    # Enforce at least one valid input.
    if wants_text and not wants_photo:
        if not has_text and not has_rubric_file:
            return {"error": "Submission must include text_answer or rubric_file."}
    else:
        if (
            (not has_text)
            and (not has_rubric_file)
            and (photo is None)
            and (normalized_photo_path is None)
        ):
            return {"error": "Submission must include text_answer, rubric_file, photo, or photo_path."}

    stored_file_path: Optional[str] = None
    if has_rubric_file:
        # Read bytes during request lifecycle.
        file_bytes = await rubric_file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="rubric_file was empty.")
        max_bytes = 15 * 1024 * 1024
        if len(file_bytes) > max_bytes:
            raise HTTPException(status_code=400, detail="rubric_file must be <= 15 MB.")

        kind = _is_allowed_rubric_upload(rubric_file.filename or "", rubric_file.content_type or "")
        if kind not in {"pdf", "docx"}:
            raise HTTPException(status_code=400, detail="rubric_file must be a .pdf or .docx.")

        try:
            extracted = (
                _extract_text_from_pdf(file_bytes) if kind == "pdf" else _extract_text_from_docx(file_bytes)
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse rubric_file: {e}")

        if not extracted.strip():
            raise HTTPException(status_code=400, detail="rubric_file contained no extractable text.")

        normalized_text_answer = extracted

        stored_file_path = f"{team_id}/{task_id}/{submission_id}-rubric.{kind}"
        try:
            await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).upload(
                    stored_file_path,
                    file_bytes,
                    file_options={
                        "content-type": (rubric_file.content_type or "application/octet-stream").strip(),
                        "upsert": "true",
                    },
                )
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"rubric_file upload failed: {e}")

    stored_photo_path = normalized_photo_path
    if (stored_photo_path is None) and (photo is not None):
        # Important: read and upload during the request lifecycle.
        photo_bytes = await photo.read()
        content_type = (photo.content_type or "application/octet-stream").strip()
        ext = (content_type.split("/")[-1] if "/" in content_type else "bin") or "bin"
        stored_photo_path = f"{team_id}/{task_id}/{submission_id}.{ext}"
        try:
            # Supabase Storage upload is synchronous; offload to worker thread.
            await anyio.to_thread.run_sync(
                lambda: supabase.storage.from_(storage_bucket()).upload(
                    stored_photo_path,
                    photo_bytes,
                    # supabase-py passes these through to HTTP headers; values must be strings.
                    file_options={"content-type": content_type, "upsert": "true"},
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
            try:
                supabase.table("submissions").insert(submission).execute()
            except Exception:
                # Don't mask the storage error with a DB insert failure.
                pass
            return {"submission_id": submission_id, "status": "error"}

    submission = {
        "id": submission_id,
        "task_id": task_id,
        "team_id": team_id,
        "text_answer": normalized_text_answer,
        # Persist object path in existing schema column name.
        "photo_url": stored_photo_path,
        "file_url": stored_file_path,
        "status": "pending"
    }
    try:
        supabase.table("submissions").insert(submission).execute()
    except APIError as e:
        # Backwards compatible: if file_url column doesn't exist yet, retry without it.
        msg = ""
        try:
            msg = (e.args[0] or {}).get("message") or ""
        except Exception:
            msg = ""
        if stored_file_path and ("file_url" in msg or "column" in msg and "file_url" in msg):
            submission.pop("file_url", None)
            try:
                supabase.table("submissions").insert(submission).execute()
            except APIError as e2:
                msg2 = ""
                try:
                    msg2 = (e2.args[0] or {}).get("message") or ""
                except Exception:
                    msg2 = ""
                raise HTTPException(status_code=400, detail=msg2 or "Invalid submission payload")
        else:
        # Convert common PostgREST errors into a client-friendly 4xx.
            raise HTTPException(status_code=400, detail=msg or "Invalid submission payload")
    
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
