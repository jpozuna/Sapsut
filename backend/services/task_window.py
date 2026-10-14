"""Task availability rules, shared by the task list and submission create.

``is_listed``: the task is active and has opened. Closed tasks stay listed so
participants can still see them.
``is_open``: listed and not yet closed. Only open tasks accept submissions.

``now`` must be timezone-aware (UTC). A null ``is_active`` counts as active and a
null ``opens_at`` / ``closes_at`` means no bound. A timestamp that cannot be
parsed makes the task not listed, so a bad row is hidden rather than exposed.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Optional

# Python 3.9's fromisoformat rejects "Z" and fractions that are not 3 or 6
# digits, so parse the shapes PostgREST can return by hand.
_TS_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?"
    r"(Z|z|[+-]\d{2}(?::?\d{2})?)?$"
)


class _Unparseable(Exception):
    pass


def _parse_timestamp(value: Any) -> Optional[datetime]:
    """Aware UTC datetime for ``value``; None for null; ``_Unparseable`` otherwise."""
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        match = _TS_RE.match(value.strip())
        if not match:
            raise _Unparseable()
        year, month, day, hour, minute, second, fraction, zone = match.groups()
        micro = int((fraction or "0")[:6].ljust(6, "0"))
        tz: timezone
        if zone is None or zone in ("Z", "z"):
            tz = timezone.utc
        else:
            digits = zone[1:].replace(":", "")
            offset = timedelta(hours=int(digits[:2]), minutes=int(digits[2:] or 0))
            tz = timezone(-offset if zone[0] == "-" else offset)
        try:
            parsed = datetime(
                int(year), int(month), int(day), int(hour), int(minute),
                int(second or 0), micro, tzinfo=tz,
            )
        except (ValueError, OverflowError):
            raise _Unparseable()
    else:
        raise _Unparseable()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _window(task: Mapping[str, Any]) -> Optional[tuple]:
    """(opens_at, closes_at), or None if the task is inactive or a timestamp is bad."""
    is_active = task.get("is_active")
    if is_active is not None and is_active is not True:
        return None
    try:
        return _parse_timestamp(task.get("opens_at")), _parse_timestamp(task.get("closes_at"))
    except (_Unparseable, OverflowError, ValueError):
        return None


def is_listed(task: Mapping[str, Any], now: datetime) -> bool:
    """Active and opened (``opens_at <= now``). Closed tasks are still listed."""
    window = _window(task)
    if window is None:
        return False
    opens_at, _closes_at = window
    return opens_at is None or opens_at <= now


def is_open(task: Mapping[str, Any], now: datetime) -> bool:
    """Listed and not closed (``now <= closes_at``)."""
    window = _window(task)
    if window is None:
        return False
    opens_at, closes_at = window
    if opens_at is not None and opens_at > now:
        return False
    return closes_at is None or now <= closes_at
