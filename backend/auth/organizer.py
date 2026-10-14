from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Optional, Tuple

from fastapi import Header, HTTPException, Request

from services.rate_limit import SlidingWindowLimiter, client_ip, too_many_requests

logger = logging.getLogger(__name__)

# --- Failed-code rate limit ------------------------------------------------
# Wrong organizer codes are rate limited in memory, per client IP. After
# MAX_FAILURES failures within WINDOW_SECONDS, that IP receives 429 on code
# checks until its oldest failure ages out of the window. See
# services/rate_limit.py for the limiter (per process, bounded memory).
MAX_FAILURES = 10
WINDOW_SECONDS = 5 * 60

_limiter = SlidingWindowLimiter(MAX_FAILURES, WINDOW_SECONDS)

# --- Session tokens --------------------------------------------------------
# Stateless HMAC-SHA256 tokens: "<b64url(payload)>.<b64url(signature)>" where the
# payload is "<expiry unix seconds>:<random nonce>". The signing key is derived
# from ORGANIZER_DEMO_CODE, so changing the code invalidates every token.
TOKEN_TTL_SECONDS = 24 * 60 * 60
_MAX_TOKEN_LENGTH = 512
_KEY_CONTEXT = b"sapsut-organizer-session-v1"

CODE_REQUIRED_DETAIL = "Invalid or missing X-Organizer-Code for organizer access."
TOKEN_INVALID_DETAIL = "Invalid or expired organizer session token."
RATE_LIMITED_DETAIL = "Too many failed organizer code attempts. Try again later."
NOT_CONFIGURED_DETAIL = "Organizer access is not configured."


def _wall_now() -> float:
    """Wall clock (unix seconds) for token expiry."""
    return time.time()


def reset_rate_limit() -> None:
    """Clear all recorded failures (used by tests)."""
    _limiter.reset()


def _derive_key(code: str) -> bytes:
    return hmac.new(_KEY_CONTEXT, code.encode("utf-8"), hashlib.sha256).digest()


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


def _sign(code: str, payload_b64: str) -> bytes:
    return hmac.new(_derive_key(code), payload_b64.encode("ascii"), hashlib.sha256).digest()


def format_expiry(expires_at: int) -> str:
    """ISO 8601 UTC timestamp for a token expiry (unix seconds)."""
    return datetime.fromtimestamp(expires_at, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def issue_session_token(code: str) -> Tuple[str, int]:
    """Create a signed token valid for TOKEN_TTL_SECONDS. Returns (token, expiry)."""
    expires_at = int(_wall_now()) + TOKEN_TTL_SECONDS
    payload_b64 = _b64encode(f"{expires_at}:{secrets.token_hex(8)}".encode("ascii"))
    signature_b64 = _b64encode(_sign(code, payload_b64))
    return f"{payload_b64}.{signature_b64}", expires_at


def verify_session_token(token: str, code: str) -> Optional[int]:
    """Return the token's expiry (unix seconds) if it is authentic and unexpired."""
    try:
        if not token or len(token) > _MAX_TOKEN_LENGTH:
            return None
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, signature_b64 = parts
        signature = _b64decode(signature_b64)
        if not hmac.compare_digest(signature, _sign(code, payload_b64)):
            return None
        expires_text = _b64decode(payload_b64).decode("ascii").split(":", 1)[0]
        expires_at = int(expires_text)
    except (ValueError, UnicodeError):
        return None
    if _wall_now() >= expires_at:
        return None
    return expires_at


def _bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Token from an ``Authorization: Bearer <token>`` header, "" if malformed.

    Returns None when the header is absent or uses another scheme.
    """
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if not parts or parts[0].lower() != "bearer":
        return None
    return parts[1].strip() if len(parts) == 2 else ""


def require_organizer(
    request: Request,
    x_organizer_code: Optional[str] = Header(default=None, alias="X-Organizer-Code"),
    authorization: Optional[str] = Header(default=None),
) -> None:
    """Guard for organizer routes.

    Accepts ``Authorization: Bearer <token>`` (checked first; never rate limited and
    never counted as a failure) or ``X-Organizer-Code`` (rate limited; only a wrong
    code counts as a failure). A request with neither header gets 401 without
    counting. On success ``request.state.organizer_auth`` is "token" or "code" and
    ``request.state.organizer_expires_at`` is the token expiry (unix seconds) or None.
    """
    expected = (os.getenv("ORGANIZER_DEMO_CODE") or "").strip()
    if not expected:
        logger.error("Organizer access attempted but ORGANIZER_DEMO_CODE is not configured")
        raise HTTPException(status_code=500, detail=NOT_CONFIGURED_DETAIL)

    token = _bearer_token(authorization)
    if token is not None:
        expires_at = verify_session_token(token, expected)
        if expires_at is None:
            raise HTTPException(status_code=401, detail=TOKEN_INVALID_DETAIL)
        request.state.organizer_auth = "token"
        request.state.organizer_expires_at = expires_at
        return

    received = (x_organizer_code or "").strip()
    if not received:
        raise HTTPException(status_code=401, detail=CODE_REQUIRED_DETAIL)

    ip = client_ip(request)
    retry_after, reserved_at = _limiter.reserve(ip)
    if retry_after is not None:
        raise too_many_requests(retry_after, RATE_LIMITED_DETAIL)

    if not secrets.compare_digest(received.encode("utf-8"), expected.encode("utf-8")):
        # The reserved slot stays: it is this IP's recorded failure.
        raise HTTPException(status_code=401, detail=CODE_REQUIRED_DETAIL)

    _limiter.release(ip, reserved_at)
    request.state.organizer_auth = "code"
    request.state.organizer_expires_at = None
