"""Check that a stored photo path is one the server generated for a given row."""

from __future__ import annotations

import re
from typing import Any, Optional

from auth.team import canonical_team_id
from services.uploads import ALLOWED_IMAGE_TYPES

_UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
# Uploads before T-07 stored JPEGs as ".jpeg"; those rows are still server-generated.
_LEGACY_PHOTO_EXTENSIONS = {"jpeg"}
_PHOTO_EXTENSIONS = "|".join(
    sorted(re.escape(e) for e in set(ALLOWED_IMAGE_TYPES.values()) | _LEGACY_PHOTO_EXTENSIONS)
)


def server_photo_path(photo_url: Any, team_id: Any, task_id: Any) -> Optional[str]:
    """`photo_url` if the server could have generated it for this team and task, else None.

    Only `{team_id}/{task_id}/<uuid>.<ext>` built from the row's own ids passes.
    Older rows written through the removed `photo_path` field can hold any path.
    """
    if not isinstance(photo_url, str) or not photo_url:
        return None
    team = canonical_team_id(team_id)
    task = canonical_team_id(task_id)
    if team is None or task is None:
        return None
    pattern = f"{re.escape(team)}/{re.escape(task)}/{_UUID_PATTERN}\\.(?:{_PHOTO_EXTENSIONS})"
    return photo_url if re.fullmatch(pattern, photo_url) else None
