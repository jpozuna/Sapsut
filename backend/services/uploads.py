"""Shared validation for image uploads.

Limits mirror the `submission-photos` bucket in
supabase/migrations/20261007000000_enable_rls_lockdown.sql (10 MB, JPEG, PNG,
WebP, HEIC, HEIF). The bucket rejects anything else, even for service-role
uploads, so the backend validates first and answers with a clear 4xx before
any database row is created.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, UploadFile

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10485760, matches the bucket file_size_limit

# Normalized content type -> file extension. The extension never comes from the client.
ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
}

_TYPE_ALIASES = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
}

UNSUPPORTED_TYPE_DETAIL = "Unsupported image type. Use JPEG, PNG, WebP, HEIC or HEIF."
TOO_LARGE_DETAIL = "Image is too large. The maximum size is 10 MB."
EMPTY_DETAIL = "Uploaded image is empty."


@dataclass(frozen=True)
class ValidatedImage:
    data: bytes
    content_type: str
    ext: str


def normalize_content_type(raw: Optional[str]) -> str:
    """Lowercase, strip parameters (`; charset=...`) and map aliases like image/jpg."""
    base = (raw or "").split(";", 1)[0].strip().lower()
    return _TYPE_ALIASES.get(base, base)


def check_content_type(raw: Optional[str]) -> str:
    """Return the normalized content type or raise 415 if it is not allowed."""
    normalized = normalize_content_type(raw)
    if normalized not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail=UNSUPPORTED_TYPE_DETAIL)
    return normalized


def extension_for(content_type: str) -> str:
    return ALLOWED_IMAGE_TYPES[content_type]


async def read_validated_image(upload: UploadFile) -> ValidatedImage:
    """Validate type and size of an uploaded image and return its bytes.

    Raises 415 for a disallowed type, 413 when larger than MAX_UPLOAD_BYTES and
    400 for an empty body. The type is checked before reading, and at most
    MAX_UPLOAD_BYTES + 1 bytes are read from the upload.
    """
    content_type = check_content_type(upload.content_type)
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=TOO_LARGE_DETAIL)
    if not data:
        raise HTTPException(status_code=400, detail=EMPTY_DETAIL)
    return ValidatedImage(data=data, content_type=content_type, ext=extension_for(content_type))
