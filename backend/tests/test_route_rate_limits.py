"""Rate limits on POST /teams/join (failures per IP) and POST /submissions/ (per team)."""

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

SECRET = "t" * 40
TEAM_A = "22222222-2222-2222-2222-222222222222"
TEAM_B = "33333333-3333-3333-3333-333333333333"
TASK_ID = "11111111-1111-1111-1111-111111111111"
JOIN_DETAIL = "Too many invite code attempts. Try again later."
SUBMIT_DETAIL = "Too many submissions. Wait a few minutes and try again."


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, fake):
        self._fake = fake
        self._code = None

    def select(self, *_a, **_kw):
        return self

    def eq(self, _k, v):
        self._code = v
        return self

    def limit(self, _n):
        return self

    def execute(self):
        self._fake.lookups += 1
        if self._fake.fail:
            raise RuntimeError("db down")
        team = self._fake.teams.get(self._code)
        return _Resp([team] if team else [])


class _FakeTeamsDb:
    def __init__(self):
        self.teams = {"GOOD2345": {"id": TEAM_A, "name": "Team A"}}
        self.lookups = 0
        self.fail = False

    def table(self, _name):
        return _Query(self)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("TEAM_SESSION_SECRET", SECRET)
    monkeypatch.delenv("ORGANIZER_DEMO_CODE", raising=False)


# --- POST /teams/join -------------------------------------------------------


@pytest.fixture()
def join_env(monkeypatch):
    import main
    import routes.teams as teams_routes

    fake = _FakeTeamsDb()
    monkeypatch.setattr(teams_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(teams_routes, "JOIN_MAX_FAILURES", 3)
    clock = [1000.0]
    monkeypatch.setattr(teams_routes._join_limiter, "clock", lambda: clock[0])

    def client(ip="10.0.0.1"):
        return TestClient(main.app, client=(ip, 50000))

    return teams_routes, fake, client, clock


def _join(client, code):
    return client.post("/teams/join", json={"invite_code": code})


def test_join_constants_match_the_spec():
    import routes.teams as teams_routes

    assert teams_routes.JOIN_MAX_FAILURES == 200
    assert teams_routes.JOIN_WINDOW_SECONDS == 600


def test_join_blocks_after_max_failures_even_for_a_correct_code(join_env):
    _routes, fake, make_client, _clock = join_env
    client = make_client()
    for _ in range(3):
        assert _join(client, "ZZZZZZZZ").status_code == 404
    lookups = fake.lookups

    res = _join(client, "GOOD2345")
    assert res.status_code == 429
    assert res.json() == {"detail": JOIN_DETAIL}
    assert int(res.headers["Retry-After"]) >= 1
    assert fake.lookups == lookups


def test_join_bad_format_counts_as_a_failure(join_env):
    _routes, fake, make_client, _clock = join_env
    client = make_client()
    for code in ("", "   ", "bad code!", "x" * 100):
        res = _join(client, code)
        if res.status_code == 429:
            break
        assert res.status_code == 404
    assert _join(client, "GOOD2345").status_code == 429
    assert fake.lookups == 0


def test_join_success_does_not_count(join_env):
    _routes, _fake, make_client, _clock = join_env
    client = make_client()
    for _ in range(10):
        assert _join(client, "GOOD2345").status_code == 200
    for _ in range(3):
        assert _join(client, "ZZZZZZZZ").status_code == 404
    assert _join(client, "ZZZZZZZZ").status_code == 429


def test_join_server_errors_do_not_count(join_env, monkeypatch):
    _routes, fake, make_client, _clock = join_env
    client = make_client()
    fake.fail = True
    for _ in range(10):
        assert _join(client, "GOOD2345").status_code == 500
    # A token issue failure is a 500 too.
    fake.fail = False
    fake.teams["BADID234"] = {"id": "not-a-uuid", "name": "Bad"}
    for _ in range(10):
        assert _join(client, "BADID234").status_code == 500
    # Unconfigured secret is a 500 as well.
    monkeypatch.delenv("TEAM_SESSION_SECRET")
    for _ in range(10):
        assert _join(client, "GOOD2345").status_code == 500
    monkeypatch.setenv("TEAM_SESSION_SECRET", SECRET)
    # None of that used up the budget.
    for _ in range(3):
        assert _join(client, "ZZZZZZZZ").status_code == 404
    assert _join(client, "ZZZZZZZZ").status_code == 429


def test_join_blocked_ip_does_not_block_another_ip(join_env):
    _routes, _fake, make_client, _clock = join_env
    a = make_client("10.0.0.1")
    b = make_client("10.0.0.2")
    for _ in range(3):
        _join(a, "ZZZZZZZZ")
    assert _join(a, "GOOD2345").status_code == 429
    assert _join(b, "GOOD2345").status_code == 200


def test_join_block_lifts_when_the_clock_advances(join_env):
    routes, _fake, make_client, clock = join_env
    client = make_client()
    for _ in range(3):
        _join(client, "ZZZZZZZZ")
    res = _join(client, "GOOD2345")
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) <= routes.JOIN_WINDOW_SECONDS + 1

    clock[0] += routes.JOIN_WINDOW_SECONDS + 1
    assert _join(client, "GOOD2345").status_code == 200


# --- POST /submissions/ -----------------------------------------------------


class _SubTable:
    def __init__(self, fake):
        self._fake = fake

    def select(self, *_a, **_kw):
        return self

    def eq(self, *_a):
        return self

    def neq(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def single(self):
        return self

    def insert(self, _payload):
        self._fake.inserts += 1
        return self

    def execute(self):
        return _Resp({"id": TASK_ID, "type": "text", "allow_multiple_submissions": True})


class _FakeSubDb:
    def __init__(self):
        self.calls = 0
        self.inserts = 0
        self.uploads = 0

    def table(self, _name):
        self.calls += 1
        return _SubTable(self)


@pytest.fixture()
def submit_env(monkeypatch):
    if not _HAVE_MULTIPART:
        pytest.skip('FastAPI Form/File routes require "python-multipart"')
    from auth.team import issue_team_token
    from routes import submissions as sub_routes

    fake = _FakeSubDb()
    scored = []
    monkeypatch.setattr(sub_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(sub_routes, "score_submission", lambda *a, **kw: scored.append(a))
    monkeypatch.setattr(sub_routes, "SUBMIT_MAX_PER_TEAM", 3)
    clock = [1000.0]
    monkeypatch.setattr(sub_routes._submit_limiter, "clock", lambda: clock[0])

    app = FastAPI()
    app.include_router(sub_routes.router, prefix="/submissions")
    client = TestClient(app)

    def headers(team_id):
        token, _ = issue_team_token(team_id)
        return {"X-Team-Token": token}

    return sub_routes, fake, scored, client, headers, clock


def _submit(client, headers, text="hello"):
    return client.post(
        "/submissions/", data={"task_id": TASK_ID, "text_answer": text}, headers=headers
    )


def test_submit_constants_match_the_spec():
    from routes import submissions as sub_routes

    assert sub_routes.SUBMIT_MAX_PER_TEAM == 50
    assert sub_routes.SUBMIT_WINDOW_SECONDS == 600


def test_submit_blocks_a_team_before_any_side_effect(submit_env):
    _routes, fake, scored, client, headers, _clock = submit_env
    for _ in range(3):
        assert _submit(client, headers(TEAM_A)).status_code == 200
    calls, inserts, tasks = fake.calls, fake.inserts, len(scored)

    res = _submit(client, headers(TEAM_A))
    assert res.status_code == 429
    assert res.json() == {"detail": SUBMIT_DETAIL}
    assert int(res.headers["Retry-After"]) >= 1
    assert (fake.calls, fake.inserts, len(scored)) == (calls, inserts, tasks)


def test_submit_blocked_photo_is_not_uploaded(submit_env, monkeypatch):
    sub_routes, fake, _scored, client, headers, _clock = submit_env
    uploads = []

    class _Bucket:
        def upload(self, *a, **kw):
            uploads.append(a)

    class _Storage:
        def from_(self, _bucket):
            return _Bucket()

    fake.storage = _Storage()
    for _ in range(3):
        _submit(client, headers(TEAM_A))
    res = client.post(
        "/submissions/",
        data={"task_id": TASK_ID},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
        headers=headers(TEAM_A),
    )
    assert res.status_code == 429
    assert uploads == []


def test_submit_counts_attempts_that_fail_validation(submit_env):
    _routes, _fake, _scored, client, headers, _clock = submit_env
    for _ in range(3):
        res = client.post(
            "/submissions/", data={"task_id": "not-a-uuid"}, headers=headers(TEAM_A)
        )
        assert res.status_code == 400
    assert _submit(client, headers(TEAM_A)).status_code == 429


def test_submit_other_team_is_not_affected(submit_env):
    _routes, _fake, _scored, client, headers, _clock = submit_env
    for _ in range(3):
        _submit(client, headers(TEAM_A))
    assert _submit(client, headers(TEAM_A)).status_code == 429
    assert _submit(client, headers(TEAM_B)).status_code == 200


def test_submit_without_a_valid_token_is_401_and_does_not_count(submit_env):
    _routes, _fake, _scored, client, headers, _clock = submit_env
    for _ in range(10):
        assert _submit(client, {}).status_code == 401
        assert _submit(client, {"X-Team-Token": "garbage"}).status_code == 401
    for _ in range(3):
        assert _submit(client, headers(TEAM_A)).status_code == 200


def test_submit_block_lifts_when_the_clock_advances(submit_env):
    routes, _fake, _scored, client, headers, clock = submit_env
    for _ in range(3):
        _submit(client, headers(TEAM_A))
    res = _submit(client, headers(TEAM_A))
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) <= routes.SUBMIT_WINDOW_SECONDS + 1

    clock[0] += routes.SUBMIT_WINDOW_SECONDS + 1
    assert _submit(client, headers(TEAM_A)).status_code == 200
