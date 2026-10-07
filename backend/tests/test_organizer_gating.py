import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self._db = db
        self._name = name
        self._filters = {}
        self._order = None
        self._single = False
        self._delete = False

    def select(self, _cols="*"):
        return self

    def eq(self, k, v):
        self._filters[k] = v
        return self

    def order(self, k, desc=False):
        self._order = (k, bool(desc))
        return self

    def delete(self):
        self._delete = True
        return self

    def insert(self, _row):
        return self

    def maybe_single(self):
        self._single = True
        return self

    def execute(self):
        rows = list(self._db.get(self._name, []))
        for k, v in self._filters.items():
            rows = [r for r in rows if r.get(k) == v]
        if self._delete:
            doomed = [id(r) for r in rows]
            self._db[self._name] = [r for r in self._db.get(self._name, []) if id(r) not in doomed]
            return _Resp(rows)
        if self._order:
            key, desc = self._order
            rows.sort(key=lambda r: r.get(key), reverse=desc)
        if self._single:
            return _Resp(rows[0] if rows else None)
        return _Resp(rows)


class _FakeSupabase:
    def __init__(self):
        self.db = {
            "review_queue": [
                {
                    "id": "rq1",
                    "submission_id": "sub1",
                    "claude_score": 3,
                    "claude_rationale": "ok",
                    "confidence": 0.5,
                    "created_at": "2026-01-01T00:00:00Z",
                }
            ],
            "submissions": [
                {
                    "id": "sub1",
                    "task_id": "task1",
                    "team_id": "team1",
                    "text_answer": "hi",
                    "photo_url": None,
                    "status": "flagged",
                }
            ],
            "tasks": [{"id": "task1", "title": "T", "type": "text", "max_points": 5}],
        }

    def table(self, name):
        return _Query(self.db, name)


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    from auth.organizer import reset_rate_limit

    reset_rate_limit()
    yield
    reset_rate_limit()


@pytest.fixture()
def app_client(monkeypatch):
    from routes import organizer as organizer_routes
    from routes import tasks as tasks_routes

    fake = _FakeSupabase()
    monkeypatch.setattr(organizer_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(tasks_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(organizer_routes, "score_submission", lambda *a, **kw: None)

    finalized = []
    monkeypatch.setattr(organizer_routes, "_finalize_score", lambda *a, **kw: finalized.append(kw))

    app = FastAPI()
    app.include_router(organizer_routes.router, prefix="/organizer")
    app.include_router(tasks_routes.router, prefix="/tasks")
    client = TestClient(app)
    client.fake = fake
    client.finalized = finalized
    return client


def test_organizer_endpoints_require_header(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = app_client.get("/organizer/review-queue")
    assert resp.status_code == 401
    assert "X-Organizer-Code" in resp.json()["detail"]


def test_organizer_endpoints_reject_mismatch(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = app_client.get("/organizer/review-queue", headers={"X-Organizer-Code": "nope"})
    assert resp.status_code == 401
    assert "Invalid" in resp.json()["detail"]


def test_organizer_endpoints_allow_match(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = app_client.get("/organizer/review-queue", headers={"X-Organizer-Code": "secret"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_non_organizer_endpoints_unaffected(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = app_client.get("/tasks/")
    assert resp.status_code == 200


def test_public_task_creation_route_removed(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = app_client.post(
        "/tasks/",
        json={"title": "x", "type": "text", "max_points": 1},
        headers={"X-Organizer-Code": "secret"},
    )
    assert resp.status_code == 405


# --- Override score cap ----------------------------------------------------


def _override(client, score):
    return client.post(
        "/organizer/review-queue/rq1/override",
        json={"score": score, "rationale": "because"},
        headers={"X-Organizer-Code": "secret"},
    )


def test_override_above_max_points_is_rejected(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = _override(app_client, 6)  # task max_points is 5
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Score cannot exceed the task's maximum of 5 points."}
    # Nothing was finalized and the queue item is still there.
    assert app_client.finalized == []
    assert [r["id"] for r in app_client.fake.db["review_queue"]] == ["rq1"]


def test_override_at_max_points_succeeds(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    resp = _override(app_client, 5)
    assert resp.status_code == 200
    assert resp.json() == {"submission_id": "sub1", "status": "reviewed", "score": 5}
    assert [f["score"] for f in app_client.finalized] == [5]
    assert app_client.fake.db["review_queue"] == []


def test_override_below_max_points_succeeds(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    assert _override(app_client, 0).status_code == 200


def test_override_missing_task_is_404(monkeypatch, app_client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")
    app_client.fake.db["tasks"] = []

    resp = _override(app_client, 1)
    assert resp.status_code == 404
    assert app_client.finalized == []


# --- Error responses must not leak raw exception text ---------------------

LEAK = "SECRET-DB-DETAIL host=db.internal password=hunter2"
TASK_UUID = "11111111-1111-1111-1111-111111111111"
AUTH = {"X-Organizer-Code": "secret"}
TASK_BODY = {"title": "x", "type": "text", "max_points": 1}


class _Boom:
    """Any attribute access or call raises an error carrying sensitive text."""

    def __getattr__(self, _name):
        raise RuntimeError(LEAK)

    def __call__(self, *a, **kw):
        raise RuntimeError(LEAK)


class _FailingSupabase:
    def __init__(self, fail_tables=None, fail_storage=False):
        self._fail_tables = fail_tables
        self.storage = _Boom() if fail_storage else _OkStorage()

    def table(self, name):
        if self._fail_tables is None or name in self._fail_tables:
            raise RuntimeError(LEAK)
        return _OkTable()


class _OkTable:
    def __getattr__(self, _name):
        return lambda *a, **kw: _OkTable()

    def execute(self):
        return _Resp([])


class _OkStorage:
    def from_(self, _bucket):
        return self

    def upload(self, *a, **kw):
        return None


@pytest.fixture()
def failing_client(monkeypatch):
    from routes import organizer as organizer_routes

    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")

    def build(fake):
        monkeypatch.setattr(organizer_routes, "get_supabase", lambda: fake)
        app = FastAPI()
        app.include_router(organizer_routes.router, prefix="/organizer")
        return TestClient(app)

    return build


def _assert_no_leak(resp, status):
    assert resp.status_code == status
    body = resp.text
    assert "SECRET-DB-DETAIL" not in body
    assert "hunter2" not in body
    assert "RuntimeError" not in body
    assert isinstance(resp.json()["detail"], str) and resp.json()["detail"]


def test_create_task_error_is_generic_and_logged(failing_client, caplog):
    client = failing_client(_FailingSupabase())
    with caplog.at_level("ERROR"):
        resp = client.post("/organizer/tasks", json=TASK_BODY, headers=AUTH)
    _assert_no_leak(resp, 400)
    # The detail is logged server-side instead.
    assert any(LEAK in (r.exc_text or "") or LEAK in r.getMessage() for r in caplog.records)


def test_get_task_error_is_generic(failing_client):
    client = failing_client(_FailingSupabase())
    _assert_no_leak(client.get(f"/organizer/tasks/{TASK_UUID}", headers=AUTH), 404)


def test_update_task_error_is_generic(failing_client):
    client = failing_client(_FailingSupabase())
    _assert_no_leak(client.put(f"/organizer/tasks/{TASK_UUID}", json=TASK_BODY, headers=AUTH), 400)


def test_criteria_delete_error_is_generic(failing_client):
    client = failing_client(_FailingSupabase())
    resp = client.put(
        f"/organizer/tasks/{TASK_UUID}/criteria",
        json={"criteria": [{"criteria_type": "exact", "value": "a"}]},
        headers=AUTH,
    )
    _assert_no_leak(resp, 400)


def test_criteria_insert_error_is_generic(failing_client):
    class _InsertFails(_OkTable):
        def insert(self, *a, **kw):
            raise RuntimeError(LEAK)

    class _Fake:
        def table(self, _name):
            return _InsertFails()

    client = failing_client(_Fake())
    resp = client.put(
        f"/organizer/tasks/{TASK_UUID}/criteria",
        json={"criteria": [{"criteria_type": "exact", "value": "a"}]},
        headers=AUTH,
    )
    _assert_no_leak(resp, 400)


def test_photo_upload_storage_error_is_generic(failing_client):
    client = failing_client(_FailingSupabase(fail_tables=set(), fail_storage=True))
    resp = client.post(
        f"/organizer/tasks/{TASK_UUID}/photos",
        files={"photo": ("p.png", b"123", "image/png")},
        headers=AUTH,
    )
    _assert_no_leak(resp, 400)


def test_photo_record_error_is_generic(failing_client):
    client = failing_client(_FailingSupabase(fail_tables={"task_photos"}))
    resp = client.post(
        f"/organizer/tasks/{TASK_UUID}/photos",
        files={"photo": ("p.png", b"123", "image/png")},
        headers=AUTH,
    )
    _assert_no_leak(resp, 400)


def test_rubric_ocr_error_is_generic(monkeypatch, failing_client):
    from routes import organizer as organizer_routes

    def boom():
        raise RuntimeError(LEAK)

    monkeypatch.setattr(organizer_routes, "_get_openai_client", boom)
    client = failing_client(_FailingSupabase())
    resp = client.post(
        f"/organizer/tasks/{TASK_UUID}/rubric-ocr",
        files={"image": ("r.png", b"123", "image/png")},
        headers=AUTH,
    )
    _assert_no_leak(resp, 400)


def test_organizer_routes_do_not_interpolate_exceptions():
    import inspect
    import re

    from routes import organizer as organizer_routes

    src = inspect.getsource(organizer_routes)
    assert not re.search(r"detail\s*=\s*(?:f?[\"'].*\{e\}|str\(e\))", src)
    assert "str(e)" not in src
