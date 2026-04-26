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


class _Query:
    def __init__(self, db, name):
        self._db = db
        self._name = name
        self._filters = {}
        self._single = False
        self._insert_payloads = []

    def select(self, _cols="*"):
        return self

    def eq(self, k, v):
        self._filters[k] = v
        return self

    def maybe_single(self):
        self._single = True
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
        if self._single:
            return _Resp(rows[0] if rows else None)
        return _Resp(rows)


class _FakeSupabase:
    def __init__(self, submission_row):
        self.db = {"submissions": [submission_row], "review_queue": []}

    def table(self, name):
        return _Query(self.db, name)


@pytest.fixture()
def app_client(monkeypatch):
    if not _HAVE_MULTIPART:
        pytest.skip('FastAPI Form/File routes require "python-multipart"')

    from routes import submissions as submissions_routes

    called = {"calls": [], "review_queue_rows": None}

    def _fake_score_submission(*args, **kwargs):
        called["calls"].append((args, kwargs))

    submission = {
        "id": "sub1",
        "task_id": "task1",
        "team_id": "team1",
        "text_answer": "hi",
        "photo_url": None,
        "status": "pending",
        "score": 3,
        "rationale": "ok",
        "ai_result": None,
    }
    fake = _FakeSupabase(submission)

    monkeypatch.setattr(submissions_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(submissions_routes, "score_submission", _fake_score_submission)

    app = FastAPI()
    app.include_router(submissions_routes.router, prefix="/submissions")

    return TestClient(app), fake, called


def test_rescore_requires_organizer_header(monkeypatch, app_client):
    client, _fake, _called = app_client
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = client.post("/submissions/sub1/rescore", json={"force": False})
    assert resp.status_code == 401
    assert "X-Organizer-Code" in resp.json()["detail"]


def test_rescore_non_terminal_queues_and_logs(monkeypatch, app_client):
    client, fake, called = app_client
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = client.post("/submissions/sub1/rescore", headers={"X-Organizer-Code": "secret"}, json={"force": False})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "queued"
    assert body["submission_id"] == "sub1"
    assert body["force"] is False

    assert fake.db["review_queue"], "expected audit row inserted into review_queue"
    audit = fake.db["review_queue"][0]
    assert audit["submission_id"] == "sub1"
    assert audit["suggested_score"] == 3
    assert audit["claude_rationale"] == "ok"

    assert called["calls"], "expected score_submission to be queued via BackgroundTasks"
    args, _kwargs = called["calls"][0]
    assert args[-1] is False  # force


def test_rescore_terminal_without_force_returns_400(monkeypatch, app_client):
    client, fake, called = app_client
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    fake.db["submissions"][0]["status"] = "reviewed"

    resp = client.post("/submissions/sub1/rescore", headers={"X-Organizer-Code": "secret"}, json={"force": False})
    assert resp.status_code == 400
    assert called["calls"] == []


def test_rescore_terminal_with_force_queues(monkeypatch, app_client):
    client, fake, called = app_client
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    fake.db["submissions"][0]["status"] = "reviewed"

    resp = client.post("/submissions/sub1/rescore", headers={"X-Organizer-Code": "secret"}, json={"force": True})
    assert resp.status_code == 200
    assert resp.json()["force"] is True

    assert called["calls"], "expected score_submission to be queued"
    args, _kwargs = called["calls"][0]
    assert args[-1] is True  # force

