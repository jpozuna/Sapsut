from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
import uuid
from typing import Optional, Tuple

from fastapi import Header, HTTPException, Request

from auth.organizer import format_expiry

__all__ = [
    "NOT_CONFIGURED_DETAIL",
    "TEAM_TOKEN_TTL_SECONDS",
    "TOKEN_INVALID_DETAIL",
    "canonical_team_id",
    "format_expiry",
    "is_configured",
    "issue_team_token",
    "require_team",
    "verify_team_token",
]

logger = logging.getLogger(__name__)

# --- Team session tokens ---------------------------------------------------
# Stateless HMAC-SHA256 tokens, shaped like the organizer token:
# "<b64url(payload)>.<b64url(signature)>" where the payload is
# "<team_id>:<expiry unix seconds>:<random nonce>". The signing key is derived from
# TEAM_SESSION_SECRET with its own key-context string, so a team token never verifies
# as an organizer token (and vice versa). Rotating the secret signs out every team.
TEAM_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
_MAX_TOKEN_LENGTH = 512
_KEY_CONTEXT = b"sapsut-team-session-v1"
# POST /teams/join is public, so anyone with an invite code holds a signed token and
# can brute-force a weak secret offline. Shorter secrets count as unconfigured.
MIN_SECRET_LENGTH = 32

TOKEN_INVALID_DETAIL = "Invalid or missing team token."
NOT_CONFIGURED_DETAIL = "Team access is not configured."


def _wall_now() -> float:
    """Wall clock (unix seconds) for token expiry."""
    return time.time()


def _secret() -> str:
    """TEAM_SESSION_SECRET, or "" when it is unset, too short, or the organizer code."""
    secret = (os.getenv("TEAM_SESSION_SECRET") or "").strip()
    if len(secret) < MIN_SECRET_LENGTH:
        return ""
    # A cracked team secret must not also reveal the organizer code.
    if secret == (os.getenv("ORGANIZER_DEMO_CODE") or "").strip():
        return ""
    return secret


def is_configured() -> bool:
    """Whether team tokens can be issued and verified. Check before doing route work."""
    return bool(_secret())


def _derive_key(secret: str) -> bytes:
    return hmac.new(_KEY_CONTEXT, secret.encode("utf-8"), hashlib.sha256).digest()


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    padded = text + "=" * (-len(text) % 4)
    raw = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
    # Only the canonical unpadded form is accepted. Otherwise several strings decode to
    # the same bytes (unused trailing bits, "+"/"/", stray "="), so a tampered token
    # could still verify.
    if _b64encode(raw) != text:
        raise ValueError("non-canonical base64")
    return raw


def _sign(secret: str, payload_b64: str) -> bytes:
    return hmac.new(_derive_key(secret), payload_b64.encode("ascii"), hashlib.sha256).digest()


def canonical_team_id(team_id: str) -> Optional[str]:
    """The lowercase hyphenated form of a UUID string, or None if it is not a UUID."""
    try:
        return str(uuid.UUID(str(team_id)))
    except (ValueError, AttributeError, TypeError):
        return None


def issue_team_token(team_id: str) -> Tuple[str, int]:
    """Create a signed token for ``team_id``. Returns ``(token, expires_at)``.

    ``expires_at`` is unix seconds; use ``format_expiry`` for the ISO form. Raises
    ValueError if ``team_id`` is not a UUID, and RuntimeError if TEAM_SESSION_SECRET
    is not configured.
    """
    canonical = canonical_team_id(team_id)
    if canonical is None:
        raise ValueError("team_id must be a UUID")
    secret = _secret()
    if not secret:
        raise RuntimeError("TEAM_SESSION_SECRET is not configured")  # see is_configured()
    expires_at = int(_wall_now()) + TEAM_TOKEN_TTL_SECONDS
    payload = f"{canonical}:{expires_at}:{secrets.token_hex(8)}"
    payload_b64 = _b64encode(payload.encode("ascii"))
    signature_b64 = _b64encode(_sign(secret, payload_b64))
    return f"{payload_b64}.{signature_b64}", expires_at


def verify_team_token(token: str) -> Optional[Tuple[str, int]]:
    """Return ``(team_id, expires_at)`` if the token is authentic and unexpired.

    Returns None for anything else (including an unset secret). Never raises.
    """
    try:
        secret = _secret()
        if not secret or not token or len(token) > _MAX_TOKEN_LENGTH:
            return None
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, signature_b64 = parts
        signature = _b64decode(signature_b64)
        if not hmac.compare_digest(signature, _sign(secret, payload_b64)):
            return None
        fields = _b64decode(payload_b64).decode("ascii").split(":")
        if len(fields) != 3:
            return None
        team_id = canonical_team_id(fields[0])
        if team_id is None:
            return None
        expires_at = int(fields[1])
    except Exception:
        return None
    if _wall_now() >= expires_at:
        return None
    return team_id, expires_at


def require_team(
    request: Request,
    x_team_token: Optional[str] = Header(default=None, alias="X-Team-Token"),
) -> str:
    """Guard for team routes. Returns the team id from a valid ``X-Team-Token``.

    Also sets ``request.state.team_id``. A missing, blank or invalid token gives 401;
    an unset or blank TEAM_SESSION_SECRET gives 500. The token is never logged.
    """
    if not _secret():
        logger.error(
            "Team access attempted but TEAM_SESSION_SECRET is missing, shorter than %d "
            "characters, or equal to ORGANIZER_DEMO_CODE",
            MIN_SECRET_LENGTH,
        )
        raise HTTPException(status_code=500, detail=NOT_CONFIGURED_DETAIL)

    verified = verify_team_token((x_team_token or "").strip())
    if verified is None:
        raise HTTPException(status_code=401, detail=TOKEN_INVALID_DETAIL)

    team_id, _expires_at = verified
    request.state.team_id = team_id
    return team_id
