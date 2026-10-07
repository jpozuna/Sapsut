import uuid as _uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

try:
    import python_multipart as _pm  # noqa: F401

    _HAVE_MULTIPART = True
except Exception:
    try:
        import multipart as _mp  # type: ignore  # noqa: F401

        _HAVE_MULTIPART = True
    except Exception:
        _HAVE_MULTIPART = False


class _Resp:
    def __init__(self, data):
        self.data = data


class _TableQuery:
    def __init__(self, db, name):
        self._db = db
        self._name = name
        self._filters = {}
        self._neq = {}
        self._limit = None
        self._order = None
        self._insert_payloads = []
        self._select_cols = "*"
        self._single = False

    def select(self, cols="*"):
        self._select_cols = cols
        return self

    def eq(self, k, v):
        self._filters[k] = v
        return self

    def neq(self, k, v):
        self._neq[k] = v
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, k, desc=False):
        self._order = (k, bool(desc))
        return self

    def single(self):
        self._single = True
        return self

    def insert(self, payload):
        self._insert_payloads.append(payload)
        if isinstance(payload, dict):
            self._db.setdefault(self._name, []).append(payload)
        elif isinstance(payload, list):
            self._db.setdefault(self._name, []).extend(payload)
        return self

    def execute(self):
        rows = list(self._db.get(self._name, []))
        for k, v in self._filters.items():
            rows = [r for r in rows if r.get(k) == v]
        for k, v in self._neq.items():
            rows = [r for r in rows if r.get(k) != v]
        if self._order:
            key, desc = self._order
            rows.sort(key=lambda r: r.get(key), reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._single:
            return _Resp(rows[0] if rows else None)
        return _Resp(rows)


class _StorageBucket:
    def __init__(self, parent):
        self._parent = parent

    def upload(self, path, data, file_options=None):
        if self._parent.fail_upload:
            raise RuntimeError("boom-secret-storage-detail")
        self._parent.upload_calls.append((path, data, file_options))
        return {"path": path}

    def create_signed_url(self, path, expires_in):
        self._parent.sign_calls.append((path, expires_in))
        return {"signedURL": f"https://signed.example/{path}?exp={expires_in}"}


class _Storage:
    def __init__(self, parent):
        self._parent = parent

    def from_(self, bucket):
        self._parent.bucket_calls.append(bucket)
        return _StorageBucket(self._parent)


class _FakeSupabase:
    def __init__(self):
        self.db = {"submissions": [], "tasks": []}
        self.storage = _Storage(self)
        self.fail_upload = False
        self.upload_calls = []
        self.sign_calls = []
        self.bucket_calls = []

    def table(self, name):
        return _TableQuery(self.db, name)


@pytest.fixture()
def app_and_client(monkeypatch):
    if not _HAVE_MULTIPART:
        pytest.skip('FastAPI Form/File routes require "python-multipart"')

    from routes import submissions as submissions_routes

    fake = _FakeSupabase()
    # Default: allow multiple to avoid the existing-submission branch.
    task_id = "11111111-1111-1111-1111-111111111111"
    fake.db["tasks"].append({"id": task_id, "allow_multiple_submissions": True})

    monkeypatch.setattr(submissions_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(submissions_routes, "score_submission", lambda *a, **kw: None)

    app = FastAPI()
    app.include_router(submissions_routes.router, prefix="/submissions")
    return fake, TestClient(app)


def test_post_submission_photo_upload_path_format(app_and_client, monkeypatch):
    fake, client = app_and_client
    task_id = "11111111-1111-1111-1111-111111111111"
    team_id = "22222222-2222-2222-2222-222222222222"

    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000123")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)

    resp = client.post(
        "/submissions/",
        data={"task_id": task_id, "team_id": team_id, "text_answer": ""},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "pending"
    assert body["submission_id"] == str(fixed_id)

    assert fake.upload_calls, "expected storage upload to be called"
    uploaded_path, uploaded_bytes, file_options = fake.upload_calls[0]
    assert uploaded_path == f"{team_id}/{task_id}/{fixed_id}.png"
    assert uploaded_bytes == b"pngbytes"
    assert file_options["content-type"] == "image/png"

    assert fake.db["submissions"], "expected submission to be inserted"
    inserted = fake.db["submissions"][0]
    assert inserted["photo_url"] == uploaded_path
    assert inserted["status"] == "pending"


def test_post_submission_upload_failure_sets_error_status(app_and_client, monkeypatch):
    fake, client = app_and_client
    fake.fail_upload = True
    task_id = "11111111-1111-1111-1111-111111111111"
    team_id = "22222222-2222-2222-2222-222222222222"

    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000999")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)

    resp = client.post(
        "/submissions/",
        data={"task_id": task_id, "team_id": team_id, "text_answer": "hi"},
        files={"photo": ("x.jpg", b"jpgbytes", "image/jpeg")},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"

    assert fake.db["submissions"], "expected error submission row to be inserted"
    inserted = fake.db["submissions"][0]
    assert inserted["id"] == str(fixed_id)
    assert inserted["status"] == "error"
    assert inserted["photo_url"] is None
    assert "boom-secret-storage-detail" not in str(inserted["rationale"])
    assert "boom-secret-storage-detail" not in str(inserted["ai_result"])
    assert inserted["rationale"] == "Photo upload failed"
    assert inserted["ai_result"]["error"] == "Photo upload failed"

    # The stored row is readable through GET /submissions/{id}; ensure nothing leaks.
    got = client.get(f"/submissions/{fixed_id}")
    assert got.status_code == 200
    assert "boom-secret-storage-detail" not in got.text


def test_get_submission_by_id_includes_signed_url_when_photo_exists(app_and_client):
    fake, client = app_and_client
    task_id = "11111111-1111-1111-1111-111111111111"
    team_id = "22222222-2222-2222-2222-222222222222"
    fake.db["submissions"].append(
        {
            "id": "sub1",
            "task_id": task_id,
            "team_id": team_id,
            "text_answer": "",
            "photo_url": f"{team_id}/{task_id}/sub1.png",
            "status": "approved",
            "score": 3,
            "confidence": 0.95,
            "rationale": "ok",
            "gpt4o_description": "desc",
            "ai_result": {"mode": "llm"},
            "created_at": "2026-01-01T00:00:00Z",
        }
    )

    resp = client.get("/submissions/sub1")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "sub1"
    assert "photo_url" not in data
    assert data["photo_signed_url"].startswith("https://signed.example/")
    assert fake.sign_calls == [(f"{team_id}/{task_id}/sub1.png", 600)]


def test_list_submissions_omits_signed_urls(app_and_client):
    fake, client = app_and_client
    task_id = "11111111-1111-1111-1111-111111111111"
    team_id = "22222222-2222-2222-2222-222222222222"
    fake.db["submissions"].extend(
        [
            {
                "id": "sub1",
                "task_id": task_id,
                "team_id": team_id,
                "text_answer": "",
                "photo_url": f"{team_id}/{task_id}/sub1.png",
                "status": "approved",
                "score": 3,
                "confidence": 0.95,
                "rationale": "ok",
                "gpt4o_description": "desc",
                "ai_result": {"mode": "llm"},
                "created_at": "2026-01-02T00:00:00Z",
            },
            {
                "id": "sub2",
                "task_id": "task2",
                "team_id": team_id,
                "text_answer": "hi",
                "photo_url": None,
                "status": "pending",
                "score": None,
                "confidence": None,
                "rationale": None,
                "gpt4o_description": None,
                "ai_result": None,
                "created_at": "2026-01-03T00:00:00Z",
            },
        ]
    )

    resp = client.get(f"/submissions/?team_id={team_id}")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert [r["id"] for r in rows] == ["sub2", "sub1"]
    assert all("photo_signed_url" not in r for r in rows)


_REMOVED_FIELDS = ("ai_result", "confidence", "gpt4o_description", "photo_url")
_ALLOWED_DETAIL = {
    "id",
    "task_id",
    "team_id",
    "text_answer",
    "status",
    "score",
    "rationale",
    "created_at",
    "photo_signed_url",
}
_SECRET = "Hunter2-Expected-Answer"


def _secret_row(sub_id, status, rationale):
    task_id = "11111111-1111-1111-1111-111111111111"
    team_id = "22222222-2222-2222-2222-222222222222"
    return {
        "id": sub_id,
        "task_id": task_id,
        "team_id": team_id,
        "text_answer": "my guess",
        "photo_url": f"{team_id}/{task_id}/{sub_id}.png",
        "status": status,
        "score": 5,
        "confidence": 0.99,
        "rationale": rationale,
        "gpt4o_description": f"a sign reading {_SECRET}",
        "ai_result": {"mode": "exact_match", "criteria": _SECRET},
        "created_at": "2026-01-01T00:00:00Z",
    }


def test_get_submission_hides_scoring_internals(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(
        _secret_row("sub1", "flagged", f"Answer should be {_SECRET}")
    )

    resp = client.get("/submissions/sub1")
    assert resp.status_code == 200
    data = resp.json()
    for field in _REMOVED_FIELDS:
        assert field not in data
    assert set(data) <= _ALLOWED_DETAIL
    assert data["photo_signed_url"].startswith("https://signed.example/")
    assert _SECRET not in resp.text
    assert data["rationale"] == "Your submission is awaiting organizer review."


def test_list_submissions_hides_scoring_internals(app_and_client):
    fake, client = app_and_client
    team_id = "22222222-2222-2222-2222-222222222222"
    fake.db["submissions"].append(
        _secret_row("sub1", "approved", f"Matches {_SECRET}")
    )

    resp = client.get(f"/submissions/?team_id={team_id}")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    for field in _REMOVED_FIELDS:
        assert field not in rows[0]
    assert set(rows[0]) <= _ALLOWED_DETAIL - {"photo_signed_url"}
    assert _SECRET not in resp.text
    assert rows[0]["score"] == 5
    assert rows[0]["rationale"] == "Your submission was approved."


@pytest.mark.parametrize("status", ["approved", "auto_approved", "reviewed", "flagged", "error"])
def test_participant_rationale_is_fixed_per_status(app_and_client, status):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row("sub1", status, f"leak {_SECRET}"))

    data = client.get("/submissions/sub1").json()
    assert _SECRET not in data["rationale"]
    assert data["rationale"]


def test_pending_submission_has_no_rationale(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row("sub1", "pending", f"leak {_SECRET}"))

    data = client.get("/submissions/sub1").json()
    assert data["rationale"] is None
    assert _SECRET not in str(data)


@pytest.mark.parametrize("status", ["approved", "auto_approved", "reviewed"])
def test_final_status_shows_score(app_and_client, status):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row("sub1", status, "r"))

    assert client.get("/submissions/sub1").json()["score"] is not None


@pytest.mark.parametrize("status", ["pending", "flagged", "error"])
def test_unreviewed_status_hides_score(app_and_client, status):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row("sub1", status, "r"))
    team_id = fake.db["submissions"][0]["team_id"]

    assert client.get("/submissions/sub1").json()["score"] is None
    rows = client.get(f"/submissions/?team_id={team_id}").json()
    assert rows[0]["score"] is None


def test_post_submission_insert_failure_returns_generic_detail(app_and_client, monkeypatch):
    from postgrest.exceptions import APIError

    from routes import submissions as submissions_routes

    fake, client = app_and_client
    task_id = "11111111-1111-1111-1111-111111111111"
    team_id = "22222222-2222-2222-2222-222222222222"

    class _FailingInsert(_TableQuery):
        def execute(self):
            if self._insert_payloads:
                raise APIError(
                    {"message": 'insert into "submissions" violates fk secret_constraint_xyz'}
                )
            return super().execute()

    monkeypatch.setattr(fake, "table", lambda name: _FailingInsert(fake.db, name))
    monkeypatch.setattr(submissions_routes, "get_supabase", lambda: fake)

    resp = client.post(
        "/submissions/",
        data={"task_id": task_id, "team_id": team_id, "text_answer": "hi"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid submission payload"
    assert "secret_constraint_xyz" not in resp.text


TASK_ID = "11111111-1111-1111-1111-111111111111"
TEAM_ID = "22222222-2222-2222-2222-222222222222"


def _post_photo(client, data, content_type, filename="x.png"):
    return client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "team_id": TEAM_ID, "text_answer": ""},
        files={"photo": (filename, data, content_type)},
    )


def test_post_submission_normalizes_jpg_content_type(app_and_client):
    fake, client = app_and_client
    resp = _post_photo(client, b"jpgbytes", "image/jpg", filename="a.jpg")
    assert resp.status_code == 200
    path, _, options = fake.upload_calls[0]
    assert path.endswith(".jpg")
    assert options == {"content-type": "image/jpeg"}
    assert "upsert" not in options


@pytest.mark.parametrize(
    "content_type", ["image/png", "image/webp", "image/heic", "image/heif", "IMAGE/JPEG"]
)
def test_post_submission_accepts_allowed_types(app_and_client, content_type):
    fake, client = app_and_client
    resp = _post_photo(client, b"bytes", content_type)
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"
    assert len(fake.upload_calls) == 1


def test_post_submission_disallowed_type_is_415_with_no_row_or_upload(app_and_client):
    fake, client = app_and_client
    resp = _post_photo(client, b"GIF89a", "image/gif", filename="x.gif")
    assert resp.status_code == 415
    assert isinstance(resp.json()["detail"], str)
    assert fake.upload_calls == []
    assert fake.db["submissions"] == []


def test_post_submission_oversized_is_413_with_no_row_or_upload(app_and_client):
    from services.uploads import MAX_UPLOAD_BYTES

    fake, client = app_and_client
    resp = _post_photo(client, b"a" * (MAX_UPLOAD_BYTES + 1), "image/png")
    assert resp.status_code == 413
    assert isinstance(resp.json()["detail"], str)
    assert fake.upload_calls == []
    assert fake.db["submissions"] == []


def test_resubmit_allowed_after_error_row_but_not_after_pending(app_and_client):
    fake, client = app_and_client
    # Single-submission task.
    fake.db["tasks"][0]["allow_multiple_submissions"] = False
    fake.db["tasks"][0]["type"] = "photo"

    fake.fail_upload = True
    first = _post_photo(client, b"bytes", "image/png")
    assert first.json()["status"] == "error"
    assert [r["status"] for r in fake.db["submissions"]] == ["error"]

    fake.fail_upload = False
    second = _post_photo(client, b"bytes", "image/png")
    assert second.status_code == 200
    assert second.json()["status"] == "pending"
    assert len(fake.upload_calls) == 1

    # A non-error row still blocks further submissions.
    third = _post_photo(client, b"bytes", "image/png")
    assert third.status_code == 200
    body = third.json()
    assert "only allows one submission" in body["error"]
    assert body["existing_submission_id"] == second.json()["submission_id"]
