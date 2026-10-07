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
    assert audit["claude_score"] == 3
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



# ---------------------------------------------------------------------------
# End to end through the real score_submission: a rescore of a row whose
# photo_url is not server-generated for its own team and task does no storage
# download and no vision call. Own paths still do (positive control).
# ---------------------------------------------------------------------------

_TEAM = "22222222-2222-2222-2222-222222222222"
_TASK = "44444444-4444-4444-4444-444444444444"
_OTHER = "33333333-3333-3333-3333-333333333333"
_FILE = "55555555-5555-4555-8555-555555555555.png"
_OWN = f"{_TEAM}/{_TASK}/{_FILE}"
_HEADERS = {"X-Organizer-Code": "secret"}


class _ScoringQuery:
    def __init__(self, db, name):
        self._db = db
        self._name = name

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def single(self):
        return self

    def update(self, _payload):
        return self

    def insert(self, _payload):
        return self

    def execute(self):
        if self._name == "submissions":
            return _Resp({"status": "pending", "score": None})
        if self._name == "tasks":
            return _Resp({"max_points": 5, "title": "t", "description": "d"})
        return _Resp([])


class _ScoringStorage:
    def __init__(self):
        self.downloads = []

    def from_(self, _bucket):
        return self

    def download(self, path):
        self.downloads.append(path)
        return b"bytes"


class _ScoringSupabase:
    def __init__(self):
        self.db = {}
        self.storage = _ScoringStorage()

    def table(self, name):
        return _ScoringQuery(self.db, name)


class _VisionSpy:
    def __init__(self):
        self.vision_calls = 0
        spy = self

        def create(**_kw):
            spy.vision_calls += 1
            msg = type("M", (), {"content": "a cat"})()
            return type("R", (), {"choices": [type("C", (), {"message": msg})()]})()

        def embed(**_kw):
            return type("R", (), {"data": [type("D", (), {"embedding": [0.1]})()]})()

        self.chat = type("Chat", (), {"completions": type("Comp", (), {"create": staticmethod(create)})()})()
        self.embeddings = type("Emb", (), {"create": staticmethod(embed)})()


class _AnthropicStub:
    def __init__(self):
        def create(**_kw):
            return type("Msg", (), {"content": [type("B", (), {"text": "not json"})()]})()

        self.messages = type("Msgs", (), {"create": staticmethod(create)})()


@pytest.fixture()
def real_scoring_client(monkeypatch):
    if not _HAVE_MULTIPART:
        pytest.skip('FastAPI Form/File routes require "python-multipart"')

    from routes import organizer as organizer_routes
    from routes import submissions as submissions_routes
    from services import scoring

    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "secret")
    scoring_db = _ScoringSupabase()
    vision = _VisionSpy()
    monkeypatch.setattr(scoring, "get_supabase", lambda: scoring_db)
    monkeypatch.setattr(scoring, "_get_openai_client", lambda: vision)
    monkeypatch.setattr(scoring, "_get_anthropic_client", lambda: _AnthropicStub())

    def make(photo_url, team_id=_TEAM, task_id=_TASK):
        row = {
            "id": "sub1",
            "task_id": task_id,
            "team_id": team_id,
            "text_answer": "hi",
            "photo_url": photo_url,
            "status": "pending",
            "score": 3,
            "rationale": "ok",
            "ai_result": None,
        }
        route_db = _FakeSupabase(row)
        monkeypatch.setattr(submissions_routes, "get_supabase", lambda: route_db)
        monkeypatch.setattr(organizer_routes, "get_supabase", lambda: route_db)
        monkeypatch.setattr(submissions_routes, "score_submission", scoring.score_submission)
        monkeypatch.setattr(organizer_routes, "score_submission", scoring.score_submission)
        app = FastAPI()
        app.include_router(submissions_routes.router, prefix="/submissions")
        app.include_router(organizer_routes.router, prefix="/organizer")
        return TestClient(app)

    return make, scoring_db, vision


_RESCORE_URLS = ["/submissions/sub1/rescore", "/organizer/submissions/sub1/rescore"]


@pytest.mark.parametrize("url", _RESCORE_URLS)
@pytest.mark.parametrize(
    "bad_path",
    [
        f"{_OTHER}/{_TASK}/{_FILE}",  # another team's folder
        f"{_TEAM}/{_OTHER}/{_FILE}",  # another task's folder
        f"{_TEAM}/{_TASK}/../{_OTHER}/{_TASK}/{_FILE}",  # traversal
        "arbitrary/path.png",
    ],
)
def test_rescore_with_foreign_photo_path_does_no_download_or_vision_call(real_scoring_client, url, bad_path):
    make, scoring_db, vision = real_scoring_client
    client = make(bad_path)

    resp = client.post(url, headers=_HEADERS, json={"force": False})

    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"
    assert scoring_db.storage.downloads == []
    assert vision.vision_calls == 0


@pytest.mark.parametrize("url", _RESCORE_URLS)
def test_rescore_with_non_uuid_row_ids_does_no_download(real_scoring_client, url):
    make, scoring_db, vision = real_scoring_client
    # A path shaped like {team}/{task}/<uuid>.png but for ids that are not UUIDs.
    client = make(f"team1/task1/{_FILE}", team_id="team1", task_id="task1")

    assert client.post(url, headers=_HEADERS, json={"force": False}).status_code == 200
    assert scoring_db.storage.downloads == []
    assert vision.vision_calls == 0


@pytest.mark.parametrize("url", _RESCORE_URLS)
def test_rescore_with_own_photo_path_still_downloads_and_describes(real_scoring_client, url):
    make, scoring_db, vision = real_scoring_client
    client = make(_OWN)

    assert client.post(url, headers=_HEADERS, json={"force": False}).status_code == 200
    assert scoring_db.storage.downloads == [_OWN]
    assert vision.vision_calls == 1
