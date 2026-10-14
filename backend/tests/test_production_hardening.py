import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

AUTH = {"X-Organizer-Code": "secret"}
TASK = "11111111-1111-1111-1111-111111111111"
QUEUE = "22222222-2222-2222-2222-222222222222"
SUB = "33333333-3333-3333-3333-333333333333"


# --- Production mode: docs hidden, /health has no env --------------------------


@pytest.fixture()
def load_main(monkeypatch):
    """Reload `main` under the current ENV; restore afterwards."""
    import main

    def _load(env):
        if env is None:
            monkeypatch.delenv("ENV", raising=False)
        else:
            monkeypatch.setenv("ENV", env)
        return importlib.reload(main)

    yield _load
    monkeypatch.undo()
    importlib.reload(main)


@pytest.mark.parametrize("env", ["prod", "production", "PROD", " Production ", "  prod\t"])
def test_docs_hidden_in_production(load_main, env):
    client = TestClient(load_main(env).app)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path
    assert client.get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize("env", [None, "dev", "", "staging", "production-ish"])
def test_docs_available_outside_production(load_main, env):
    client = TestClient(load_main(env).app)
    assert client.get("/docs").status_code == 200
    assert client.get("/redoc").status_code == 200
    assert client.get("/openapi.json").status_code == 200


@pytest.mark.parametrize("env", [None, "dev", "prod", "production", "staging"])
def test_health_is_exactly_status_ok(load_main, env):
    resp = TestClient(load_main(env).app).get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


# --- Organizer id validation ---------------------------------------------------


class _Boom:
    """Fails the test if anything touches Supabase."""

    def __getattr__(self, name):
        raise AssertionError(f"Supabase was called: {name}")


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    """Records the `.eq` filter values, returns one row for any lookup."""

    def __init__(self, log, name):
        self._log = log
        self._name = name

    def __getattr__(self, _name):
        def call(*a, **kw):
            self._log.append((self._name, _name, a))
            return self

        return call

    def execute(self):
        return _Resp(
            {
                "id": SUB,
                "task_id": TASK,
                "team_id": "44444444-4444-4444-4444-444444444444",
                "status": "flagged",
                "score": 1,
                "submission_id": SUB,
                "claude_score": 1,
                "max_points": 5,
            }
        )


class _Recording:
    def __init__(self):
        self.log = []

    def table(self, name):
        return _Table(self.log, name)

    def rpc(self, name, params):
        self.log.append(("rpc", name, params))
        return _Table(self.log, "rpc")


def _client(monkeypatch, fake):
    from routes import organizer as organizer_routes

    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")
    from auth.organizer import reset_rate_limit

    reset_rate_limit()
    monkeypatch.setattr(organizer_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(organizer_routes, "score_submission", lambda *a, **kw: None)
    monkeypatch.setattr(organizer_routes, "_finalize_score", lambda *a, **kw: None)
    app = FastAPI()
    app.include_router(organizer_routes.router, prefix="/organizer")
    return TestClient(app)


BAD = "not-a-uuid"
_CRIT = {"criteria": [{"criteria_type": "exact", "value": "a"}]}
_PNG = {"photo": ("p.png", b"123", "image/png")}


@pytest.mark.parametrize(
    "method,path,name,kwargs",
    [
        ("get", f"/organizer/tasks/{BAD}", "task_id", {}),
        ("put", f"/organizer/tasks/{BAD}", "task_id", {"json": {"title": "x", "type": "text", "max_points": 1}}),
        ("put", f"/organizer/tasks/{BAD}/criteria", "task_id", {"json": _CRIT}),
        ("get", f"/organizer/tasks/{BAD}/photos", "task_id", {}),
        ("post", f"/organizer/tasks/{BAD}/photos", "task_id", {"files": _PNG}),
        ("post", f"/organizer/tasks/{BAD}/rubric-ocr", "task_id", {"files": {"image": _PNG["photo"]}}),
        ("post", f"/organizer/review-queue/{BAD}/approve", "queue_id", {}),
        ("post", f"/organizer/review-queue/{BAD}/override", "queue_id", {"json": {"score": 1}}),
        ("post", f"/organizer/submissions/{BAD}/rescore", "submission_id", {"json": {}}),
    ],
)
def test_malformed_ids_give_400_without_calling_supabase(monkeypatch, method, path, name, kwargs):
    client = _client(monkeypatch, _Boom())
    resp = getattr(client, method)(path, headers=AUTH, **kwargs)
    assert resp.status_code == 400
    assert resp.json() == {"detail": f"{name} must be a UUID"}


def test_valid_ids_are_passed_on_in_canonical_form(monkeypatch):
    fake = _Recording()
    client = _client(monkeypatch, fake)
    upper = TASK.upper()

    assert client.get(f"/organizer/tasks/{upper}", headers=AUTH).status_code == 200
    assert ("tasks", "eq", ("id", TASK)) in fake.log

    fake.log.clear()
    resp = client.post(f"/organizer/review-queue/{QUEUE.upper()}/approve", headers=AUTH)
    assert resp.status_code == 200
    assert ("review_queue", "eq", ("id", QUEUE)) in fake.log

    fake.log.clear()
    resp = client.post(f"/organizer/submissions/{SUB.upper()}/rescore", headers=AUTH, json={})
    assert resp.status_code == 200
    assert resp.json()["submission_id"] == SUB
    assert ("submissions", "eq", ("id", SUB)) in fake.log


# --- Atomic criteria replace ---------------------------------------------------


def test_criteria_replace_is_a_single_rpc_call(monkeypatch):
    rows = [{"id": "x", "task_id": TASK, "criteria_type": "exact", "value": "a"}]

    class _Fake:
        def __init__(self):
            self.calls = []

        def table(self, name):
            raise AssertionError(f"unexpected table access: {name}")

        def rpc(self, name, params):
            self.calls.append((name, params))
            return type("R", (), {"execute": lambda self_: _Resp(rows)})()

    fake = _Fake()
    client = _client(monkeypatch, fake)
    resp = client.put(
        f"/organizer/tasks/{TASK.upper()}/criteria",
        json={
            "criteria": [
                {"criteria_type": "exact", "value": "a"},
                {"value": "b"},
            ]
        },
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert resp.json() == {"task_id": TASK, "inserted": rows}
    assert fake.calls == [
        (
            "replace_task_criteria",
            {
                "p_task_id": TASK,
                "p_criteria": [
                    {"criteria_type": "exact", "value": "a"},
                    {"criteria_type": "exact", "value": "b"},
                ],
            },
        )
    ]


def test_criteria_replace_empty_list_still_calls_rpc(monkeypatch):
    class _Fake:
        def __init__(self):
            self.calls = []

        def rpc(self, name, params):
            self.calls.append((name, params))
            return type("R", (), {"execute": lambda self_: _Resp(None)})()

    fake = _Fake()
    client = _client(monkeypatch, fake)
    resp = client.put(f"/organizer/tasks/{TASK}/criteria", json={"criteria": []}, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == {"task_id": TASK, "inserted": []}
    assert fake.calls == [("replace_task_criteria", {"p_task_id": TASK, "p_criteria": []})]
