from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter

from services import get_supabase
from services.task_window import is_listed

router = APIRouter()

# Public task columns. `rubric` stays server-side: it can hold grading criteria.
# Organizer routes read the full task separately.
_PUBLIC_TASK_FIELDS = (
    "id",
    "title",
    "description",
    "type",
    "max_points",
    "is_active",
    "opens_at",
    "closes_at",
    "allow_multiple_submissions",
    "created_at",
)


@router.get("/")
def list_tasks() -> List[Dict[str, Any]]:
    supabase = get_supabase()
    rows = supabase.table("tasks").select(",".join(_PUBLIC_TASK_FIELDS)).execute().data or []
    # Inactive and not-yet-open tasks are hidden here, not just in the app. Closed
    # tasks stay listed. The task count is small, so filter after the select.
    now = datetime.now(timezone.utc)
    return [
        {k: row.get(k) for k in _PUBLIC_TASK_FIELDS} for row in rows if is_listed(row, now)
    ]
