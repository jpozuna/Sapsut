from __future__ import annotations

import logging
import re
import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from auth.organizer import require_organizer
from auth.team import (
    NOT_CONFIGURED_DETAIL,
    format_expiry,
    is_configured,
    issue_team_token,
    require_team,
)
from services import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter()

_INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/1/I/L/O
# Real codes are 8 characters; anything much longer cannot match, so skip the lookup.
_MAX_INVITE_CODE_INPUT = 64
_NAME_MAX_LENGTH = 80
_INVITE_CODE_PATTERN = re.compile(r"[A-Z0-9]{1,%d}" % _MAX_INVITE_CODE_INPUT)
# Team lists carry invite codes and join responses carry a session token.
_NO_STORE = "no-store"


def _generate_invite_code(length: int = 8) -> str:
    return "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(length))


def _is_invite_code_unique_violation(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "duplicate" in msg and "invite" in msg and "code" in msg


def _error_kind(exc: Exception) -> str:
    """Exception type and PostgREST code only. The message can quote row values
    (for example `Key (invite_code)=(...)`), so it never goes to the logs."""
    code = getattr(exc, "code", None)
    return f"{type(exc).__name__} code={code}" if code else type(exc).__name__


def _first_row(data: Any) -> Optional[Dict[str, Any]]:
    if isinstance(data, list):
        return data[0] if data else None
    return data or None


class TeamCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=_NAME_MAX_LENGTH)

    @field_validator("name", mode="before")
    @classmethod
    def _trim_name(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class TeamJoinIn(BaseModel):
    invite_code: str


@router.post("/", dependencies=[Depends(require_organizer)])
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
            row = _first_row(res.data)
            if not row or "id" not in row or "invite_code" not in row:
                raise HTTPException(status_code=500, detail="Failed to create team")
            return {"id": row["id"], "name": payload.name, "invite_code": row["invite_code"]}
        except HTTPException:
            raise
        except Exception as e:
            last_exc = e
            if _is_invite_code_unique_violation(e):
                continue
            logger.error("Failed to create team: %s", _error_kind(e))
            raise HTTPException(status_code=400, detail="Failed to create team")

    logger.error(
        "Failed to generate unique invite_code after retries: %s",
        _error_kind(last_exc) if last_exc else None,
    )
    raise HTTPException(status_code=500, detail="Failed to create team")


@router.get("/", dependencies=[Depends(require_organizer)])
def list_teams(response: Response) -> List[Dict[str, Any]]:
    response.headers["Cache-Control"] = _NO_STORE
    supabase = get_supabase()
    res = (
        supabase.table("teams")
        .select("id,name,invite_code,total_score,created_at")
        .order("name")
        .execute()
    )
    return res.data or []


@router.post("/join")
def join_team(payload: TeamJoinIn, response: Response) -> Any:
    """Exchange an invite code for a signed team session token. Public."""
    if not is_configured():
        logger.error("POST /teams/join called but TEAM_SESSION_SECRET is not usable")
        raise HTTPException(status_code=500, detail=NOT_CONFIGURED_DETAIL)

    # ASCII first: str.upper() folds some non-ASCII letters into ASCII ones.
    raw = payload.invite_code.strip()
    code = raw.upper() if raw.isascii() else ""
    if not _INVITE_CODE_PATTERN.fullmatch(code):
        raise HTTPException(status_code=404, detail="Team not found")

    supabase = get_supabase()
    try:
        res = (
            supabase.table("teams")
            .select("id,name")
            .eq("invite_code", code)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("Team lookup for join failed: %s", _error_kind(e))
        raise HTTPException(status_code=500, detail="Failed to join team")
    row = _first_row(res.data)
    if not row:
        raise HTTPException(status_code=404, detail="Team not found")

    try:
        token, expires_at = issue_team_token(str(row["id"]))
    except (ValueError, RuntimeError):
        # A non-UUID id from the DB, or the secret vanishing mid-request: a server fault.
        logger.exception("Failed to issue team token")
        raise HTTPException(status_code=500, detail="Failed to join team")

    response.headers["Cache-Control"] = _NO_STORE
    return {
        "team": {"id": row["id"], "name": row["name"]},
        "token": token,
        "expires_at": format_expiry(expires_at),
    }


@router.get("/me")
def get_my_team(team_id: str = Depends(require_team)) -> Any:
    supabase = get_supabase()
    res = (
        supabase.table("teams")
        .select("id,name,total_score")
        .eq("id", team_id)
        .limit(1)
        .execute()
    )
    row = _first_row(res.data)
    if not row:
        raise HTTPException(status_code=404, detail="Team not found")
    return {"id": row["id"], "name": row["name"], "total_score": row.get("total_score", 0)}
