from __future__ import annotations

import os

from fastapi import Header, HTTPException
from typing import Optional


def require_organizer(
    x_organizer_code: Optional[str] = Header(default=None, alias="X-Organizer-Code"),
) -> None:
    expected = (os.getenv("ORGANIZER_DEMO_CODE") or "").strip()
    if not expected:
        raise HTTPException(
            status_code=500,
            detail="Organizer access is not configured (missing ORGANIZER_DEMO_CODE).",
        )

    received = (x_organizer_code or "").strip()
    if received != expected:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing X-Organizer-Code for organizer access.",
        )

