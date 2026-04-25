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
            raise RuntimeError("boom")
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
    fake.db["tasks"].append({"id": "task1", "allow_multiple_submissions": True})

    monkeypatch.setattr(submissions_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(submissions_routes, "score_submission", lambda *a, **kw: None)

    app = FastAPI()
    app.include_router(submissions_routes.router, prefix="/submissions")
    return fake, TestClient(app)


def test_post_submission_photo_upload_path_format(app_and_client, monkeypatch):
    fake, client = app_and_client

    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000123")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)

    resp = client.post(
        "/submissions/",
        data={"task_id": "task1", "team_id": "teamA", "text_answer": ""},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "pending"
    assert body["submission_id"] == str(fixed_id)

    assert fake.upload_calls, "expected storage upload to be called"
    uploaded_path, uploaded_bytes, file_options = fake.upload_calls[0]
    assert uploaded_path == f"teamA/task1/{fixed_id}.png"
    assert uploaded_bytes == b"pngbytes"
    assert file_options["content-type"] == "image/png"

    assert fake.db["submissions"], "expected submission to be inserted"
    inserted = fake.db["submissions"][0]
    assert inserted["photo_url"] == uploaded_path
    assert inserted["status"] == "pending"


def test_post_submission_upload_failure_sets_error_status(app_and_client, monkeypatch):
    fake, client = app_and_client
    fake.fail_upload = True

    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000999")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)

    resp = client.post(
        "/submissions/",
        data={"task_id": "task1", "team_id": "teamA", "text_answer": "hi"},
        files={"photo": ("x.jpg", b"jpgbytes", "image/jpeg")},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"

    assert fake.db["submissions"], "expected error submission row to be inserted"
    inserted = fake.db["submissions"][0]
    assert inserted["id"] == str(fixed_id)
    assert inserted["status"] == "error"
    assert inserted["photo_url"] is None


def test_get_submission_by_id_includes_signed_url_when_photo_exists(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(
        {
            "id": "sub1",
            "task_id": "task1",
            "team_id": "teamA",
            "text_answer": "",
            "photo_url": "teamA/task1/sub1.png",
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
    assert data["photo_url"] == "teamA/task1/sub1.png"
    assert data["photo_signed_url"].startswith("https://signed.example/")
    assert fake.sign_calls == [("teamA/task1/sub1.png", 600)]


def test_list_submissions_omits_signed_urls(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].extend(
        [
            {
                "id": "sub1",
                "task_id": "task1",
                "team_id": "teamA",
                "text_answer": "",
                "photo_url": "teamA/task1/sub1.png",
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
                "team_id": "teamA",
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

    resp = client.get("/submissions/?team_id=teamA")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert [r["id"] for r in rows] == ["sub2", "sub1"]
    assert all("photo_signed_url" not in r for r in rows)

