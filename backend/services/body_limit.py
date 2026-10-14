"""Pure ASGI middleware that caps the request body size on every route.

Starlette spools multipart bodies to disk before a route runs, so the cap has
to apply below the routes. A `Content-Length` over the cap is refused with 413
before the body is read or the app is called. Without a trustworthy
`Content-Length` (chunked, or a lying header) bytes are counted as the app
reads them, and the request is stopped with 413 once the count passes the cap.
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, MutableMapping, Optional

from services.uploads import MAX_UPLOAD_BYTES

MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024  # 11 MiB: the photo plus form overhead

TOO_LARGE_DETAIL = "Request body is too large. The maximum image size is 10 MB."
BAD_LENGTH_DETAIL = "Invalid Content-Length header."

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

# Longer digit strings are always over the cap; this also avoids huge int() parses.
_MAX_LENGTH_DIGITS = 19


class _BodyTooLarge(Exception):
    """Raised from the wrapped `receive` when the counted body passes the cap."""


def _parse_content_length(scope: Scope) -> Optional[int]:
    """Return the declared length, None when absent, or raise ValueError when malformed."""
    values = [v for k, v in scope.get("headers", []) if k == b"content-length"]
    if not values:
        return None
    if len(values) > 1:
        raise ValueError("multiple Content-Length headers")
    raw = values[0].strip()
    if not raw or not raw.isdigit() or not raw.isascii():
        raise ValueError("malformed Content-Length")
    if len(raw) > _MAX_LENGTH_DIGITS:
        return 10**_MAX_LENGTH_DIGITS
    return int(raw)


async def _send_json(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodyLimitMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]], max_bytes: int = MAX_REQUEST_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        try:
            declared = _parse_content_length(scope)
        except ValueError:
            await _send_json(send, 400, BAD_LENGTH_DETAIL)
            return
        if declared is not None and declared > self.max_bytes:
            await _send_json(send, 413, TOO_LARGE_DETAIL)
            return

        received = 0
        exceeded = False
        started = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            if exceeded:
                raise _BodyTooLarge()
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    raise _BodyTooLarge()
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            # Once the cap is passed, whatever the app answers (FastAPI turns the
            # receive error into a 400) is dropped in favour of our own 413.
            if exceeded:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except Exception:  # CancelledError (BaseException) still propagates
            if not exceeded:
                raise
        if exceeded and not started:
            await _send_json(send, 413, TOO_LARGE_DETAIL)
        # If the response had already started it cannot be replaced; returning
        # without completing it makes the server close the connection.
