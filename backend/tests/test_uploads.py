import asyncio
import io

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from services import uploads
from services.uploads import (
    MAX_UPLOAD_BYTES,
    ValidatedImage,
    normalize_content_type,
    read_validated_image,
)

TASK_UUID = "11111111-1111-1111-1111-111111111111"
AUTH = {"X-Organizer-Code": "secret"}


def _upload(data: bytes, content_type, filename="x.bin") -> UploadFile:
    headers = Headers({"content-type": content_type}) if content_type else Headers({})
    return UploadFile(file=io.BytesIO(data), filename=filename, headers=headers)


def _validate(data: bytes, content_type) -> ValidatedImage:
    return asyncio.run(read_validated_image(_upload(data, content_type)))


def test_limit_matches_bucket():
    assert MAX_UPLOAD_BYTES == 10485760
    assert set(uploads.ALLOWED_IMAGE_TYPES) == {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
    }


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("image/jpg", "image/jpeg"),
        ("IMAGE/JPEG", "image/jpeg"),
        ("image/png; charset=binary", "image/png"),
        ("  image/webp  ", "image/webp"),
        (None, ""),
    ],
)
def test_normalize_content_type(raw, expected):
    assert normalize_content_type(raw) == expected


@pytest.mark.parametrize(
    "content_type,ext,normalized",
    [
        ("image/jpeg", "jpg", "image/jpeg"),
        ("image/jpg", "jpg", "image/jpeg"),
        ("Image/PNG", "png", "image/png"),
        ("image/webp", "webp", "image/webp"),
        ("image/heic", "heic", "image/heic"),
        ("image/heif; q=1", "heif", "image/heif"),
    ],
)
def test_allowed_types_are_accepted(content_type, ext, normalized):
    result = _validate(b"abc", content_type)
    assert result.content_type == normalized
    assert result.ext == ext
    assert result.data == b"abc"


@pytest.mark.parametrize(
    "content_type",
    ["image/gif", "image/svg+xml", "text/html", "application/octet-stream", "../../etc/passwd", None],
)
def test_disallowed_types_raise_415(content_type):
    with pytest.raises(HTTPException) as exc:
        _validate(b"abc", content_type)
    assert exc.value.status_code == 415


def test_oversized_raises_413_and_exact_limit_passes():
    assert len(_validate(b"a" * MAX_UPLOAD_BYTES, "image/png").data) == MAX_UPLOAD_BYTES
    with pytest.raises(HTTPException) as exc:
        _validate(b"a" * (MAX_UPLOAD_BYTES + 1), "image/png")
    assert exc.value.status_code == 413


def test_oversized_read_is_bounded():
    class _Spy(io.BytesIO):
        requested = []

        def read(self, n=-1):
            _Spy.requested.append(n)
            return super().read(n)

    up = UploadFile(
        file=_Spy(b"a" * (MAX_UPLOAD_BYTES + 5)),
        filename="x.png",
        headers=Headers({"content-type": "image/png"}),
    )
    with pytest.raises(HTTPException):
        asyncio.run(read_validated_image(up))
    assert _Spy.requested == [MAX_UPLOAD_BYTES + 1]


def test_empty_body_raises_400():
    with pytest.raises(HTTPException) as exc:
        _validate(b"", "image/png")
    assert exc.value.status_code == 400


# --- Organizer routes ------------------------------------------------------


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, parent, name):
        self._parent = parent
        self._name = name

    def insert(self, row):
        self._parent.inserts.append((self._name, row))
        self._row = row
        return self

    def execute(self):
        return _Resp([self._row])


class _Bucket:
    def __init__(self, parent):
        self._parent = parent

    def upload(self, path, data, file_options=None):
        self._parent.uploads.append((path, data, file_options))
        return {"path": path}


class _Storage:
    def __init__(self, parent):
        self._parent = parent

    def from_(self, _bucket):
        return _Bucket(self._parent)


class _FakeSupabase:
    def __init__(self):
        self.uploads = []
        self.inserts = []
        self.storage = _Storage(self)

    def table(self, name):
        return _Table(self, name)


@pytest.fixture()
def organizer(monkeypatch):
    from routes import organizer as organizer_routes

    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")
    fake = _FakeSupabase()
    monkeypatch.setattr(organizer_routes, "get_supabase", lambda: fake)
    app = FastAPI()
    app.include_router(organizer_routes.router, prefix="/organizer")
    return organizer_routes, fake, TestClient(app)


def _post_photo(client, data, content_type, filename="p.png"):
    return client.post(
        f"/organizer/tasks/{TASK_UUID}/photos",
        files={"photo": (filename, data, content_type)},
        headers=AUTH,
    )


def test_task_photo_upload_normalizes_type_and_drops_upsert(organizer):
    _, fake, client = organizer
    resp = _post_photo(client, b"jpgbytes", "image/jpg", filename="evil.php")
    assert resp.status_code == 200
    path, data, options = fake.uploads[0]
    assert path.startswith(f"tasks/{TASK_UUID}/")
    assert path.endswith(".jpg")
    assert data == b"jpgbytes"
    assert options == {"content-type": "image/jpeg"}
    assert "upsert" not in options
    assert fake.inserts and fake.inserts[0][0] == "task_photos"


def test_task_photo_disallowed_type_is_415_and_nothing_stored(organizer):
    _, fake, client = organizer
    resp = _post_photo(client, b"<svg/>", "image/svg+xml", filename="a.svg")
    assert resp.status_code == 415
    assert isinstance(resp.json()["detail"], str)
    assert fake.uploads == []
    assert fake.inserts == []


def test_task_photo_oversized_is_413_and_nothing_stored(organizer):
    _, fake, client = organizer
    resp = _post_photo(client, b"a" * (MAX_UPLOAD_BYTES + 1), "image/png")
    assert resp.status_code == 413
    assert fake.uploads == []
    assert fake.inserts == []


def _post_ocr(client, data, content_type):
    return client.post(
        f"/organizer/tasks/{TASK_UUID}/rubric-ocr",
        files={"image": ("r.png", data, content_type)},
        headers=AUTH,
    )


def test_rubric_ocr_rejects_bad_type_and_size_before_ocr(organizer, monkeypatch):
    organizer_routes, _, client = organizer
    calls = []

    def fake_client():
        calls.append(1)
        raise RuntimeError("should not be reached")

    monkeypatch.setattr(organizer_routes, "_get_openai_client", fake_client)

    assert _post_ocr(client, b"abc", "application/pdf").status_code == 415
    assert _post_ocr(client, b"a" * (MAX_UPLOAD_BYTES + 1), "image/png").status_code == 413
    assert calls == []


def test_rubric_ocr_accepts_valid_image(organizer, monkeypatch):
    organizer_routes, _, client = organizer
    seen = {}

    class _Msg:
        content = "Line one\n- Line two"

    class _Choice:
        message = _Msg()

    class _Completion:
        choices = [_Choice()]

    class _Completions:
        def create(self, **kw):
            seen["url"] = kw["messages"][0]["content"][0]["image_url"]["url"]
            return _Completion()

    class _Chat:
        completions = _Completions()

    class _OpenAI:
        chat = _Chat()

    monkeypatch.setattr(organizer_routes, "_get_openai_client", lambda: _OpenAI())
    resp = _post_ocr(client, b"abc", "image/jpg")
    assert resp.status_code == 200
    assert resp.json()["criteria"] == ["Line one", "Line two"]
    assert seen["url"].startswith("data:image/jpeg;base64,")
