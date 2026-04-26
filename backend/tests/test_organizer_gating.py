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

    def select(self, _cols="*"):
        return self

    def eq(self, k, v):
        self._filters[k] = v
        return self

    def order(self, k, desc=False):
        self._order = (k, bool(desc))
        return self

    def maybe_single(self):
        self._single = True
        return self

    def execute(self):
        rows = list(self._db.get(self._name, []))
        for k, v in self._filters.items():
            rows = [r for r in rows if r.get(k) == v]
        if self._order:
            key, desc = self._order
            rows.sort(key=lambda r: r.get(key), reverse=desc)
        if self._single:
            return _Resp(rows[0] if rows else None)
        return _Resp(rows)


class _FakeSupabase:
    def __init__(self):
        self.db = {
            "review_queue": [{"id": "rq1", "created_at": "2026-01-01T00:00:00Z"}],
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


@pytest.fixture()
def app_client(monkeypatch):
    from routes import organizer as organizer_routes
    from routes import tasks as tasks_routes

    fake = _FakeSupabase()
    monkeypatch.setattr(organizer_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(tasks_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(organizer_routes, "score_submission", lambda *a, **kw: None)

    app = FastAPI()
    app.include_router(organizer_routes.router, prefix="/organizer")
    app.include_router(tasks_routes.router, prefix="/tasks")
    return TestClient(app)


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

