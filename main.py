import os
from typing import Any, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from openai import OpenAI
from pydantic import BaseModel
from supabase import Client, create_client


load_dotenv()

app = FastAPI(title="Sapsut API")


def _get_env(name: str, *, fallback: Optional[str] = None) -> Optional[str]:
    val = os.getenv(name)
    if val is not None and val.strip() != "":
        return val
    return fallback


def get_supabase() -> Client:
    url = _get_env("SUPABASE_URL")
    key = _get_env("SUPABASE_SERVICE_ROLE_KEY", fallback=_get_env("SUPABASE_KEY"))
    if not url or not key:
        raise RuntimeError(
            "Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY)."
        )
    return create_client(url, key)


def get_openai() -> OpenAI:
    api_key = _get_env("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY.")
    return OpenAI(api_key=api_key)


AllowedCriteriaType = Literal["exact", "fuzzy", "rubric"]


class TaskCriteriaCreateIn(BaseModel):
    task_id: str
    criteria_type: str
    value: str


@app.get("/tasks/{id}")
def get_task(id: str) -> Any:
    sb = get_supabase()
    res = sb.table("tasks").select("*").eq("id", id).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Task not found")
    return res.data


@app.post("/task_criteria")
def create_task_criteria(payload: TaskCriteriaCreateIn) -> Any:
    criteria_type = payload.criteria_type
    if criteria_type not in ("exact", "fuzzy", "rubric"):
        raise HTTPException(
            status_code=400,
            detail="criteria_type must be one of: exact, fuzzy, rubric",
        )

    client = get_openai()
    emb = client.embeddings.create(
        model="text-embedding-3-small",
        input=payload.value,
    )
    embedding = emb.data[0].embedding

    sb = get_supabase()
    res = (
        sb.table("task_criteria")
        .insert(
            {
                "task_id": payload.task_id,
                "criteria_type": criteria_type,
                "value": payload.value,
                "embedding": embedding,
            }
        )
        .execute()
    )
    # PostgREST returns inserted rows under data
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create task criteria")
    return res.data[0] if isinstance(res.data, list) else res.data


@app.get("/task_criteria")
def list_task_criteria(task_id: str = Query(...)) -> Any:
    sb = get_supabase()
    res = sb.table("task_criteria").select("*").eq("task_id", task_id).execute()
    return res.data or []

