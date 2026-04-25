from __future__ import annotations

import os
from typing import Optional

from supabase import Client, create_client

_supabase: Optional[Client] = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is not None:
        return _supabase

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError(
            "Supabase env vars are missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
        )

    _supabase = create_client(supabase_url, supabase_key)
    return _supabase


# Back-compat for existing imports. (May be None until env vars exist.)
try:
    supabase = get_supabase()
except RuntimeError:
    supabase = None