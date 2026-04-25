from __future__ import annotations

import os


def storage_bucket() -> str:
    """
    Shared Supabase Storage bucket selector for uploads/downloads.
    """
    return os.getenv("SUPABASE_STORAGE_BUCKET", "submissions").strip() or "submissions"

