from __future__ import annotations

import secrets
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from services import get_supabase

router = APIRouter()

_INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/1/I/L/O


def _generate_invite_code(length: int = 8) -> str:
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(length))


def _is_invite_code_unique_violation(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "duplicate" in msg and "invite" in msg and "code" in msg


class TeamCreateIn(BaseModel):
    name: str = Field(min_length=1)


@router.post("/")
def create_team(payload: TeamCreateIn) -> Any:
    supabase = get_supabase()

    last_exc: Optional[Exception] = None
    for _ in range(5):
        invite_code = _generate_invite_code()
        try:
            res = (
                supabase.table("teams")
                .insert({"name": payload.name, "invite_code": invite_code})
                .execute()
            )
            data = res.data or []
            row = data[0] if isinstance(data, list) and data else data
            if not row or "id" not in row or "invite_code" not in row:
                raise HTTPException(status_code=500, detail="Failed to create team")
            return {"id": row["id"], "invite_code": row["invite_code"]}
        except HTTPException:
            raise
        except Exception as e:
            last_exc = e
            if _is_invite_code_unique_violation(e):
                continue
            raise HTTPException(status_code=400, detail=str(e))

    raise HTTPException(
        status_code=500,
        detail=f"Failed to generate unique invite_code: {last_exc}",
    )


@router.get("/{id}")
def get_team_by_id(id: str) -> Any:
    supabase = get_supabase()
    res = supabase.table("teams").select("*").eq("id", id).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Team not found")
    return res.data


@router.get("/")
def get_team_by_invite_code(invite_code: str = Query(...)) -> Any:
    supabase = get_supabase()
    res = (
        supabase.table("teams")
        .select("*")
        .eq("invite_code", invite_code)
        .maybe_single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Team not found")
    return res.data

