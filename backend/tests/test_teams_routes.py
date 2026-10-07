import uuid
from datetime import datetime, timezone
from typing import Optional

import pytest
from fastapi.testclient import TestClient

from auth import team as team_auth
from auth.organizer import issue_session_token, reset_rate_limit

ORGANIZER_CODE = "organizer-code-for-tests"
ORG = {"X-Organizer-Code": ORGANIZER_CODE}
SECRET = "t" * 40


class _Resp:
    def __init__(self, data):
        self.data = data


class _TeamsTable:
    """Fake `teams` table that records every select column list."""

    def __init__(
        self,
        store,
        *,
        fail_first_insert: bool = False,
        always_fail_with: Optional[str] = None,
    ):
        self._store = store
        self._always_fail_with = always_fail_with
        self._fail_first_insert = fail_first_insert
        self._insert_calls = 0
        self._reset()

    def _reset(self):
        self._filters = {}
        self._pending_insert = None
        self._columns = None
        self._order = None
        self._limit = None

    def select(self, cols: str = "*"):
        self._columns = cols
        self._store["selects"].append(cols)
        return self

    def insert(self, payload):
        self._pending_insert = payload
        return self

    def eq(self, k, v):
        self._filters[k] = v
        return self

    def order(self, column):
        self._order = column
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self._pending_insert is not None:
            payload = self._pending_insert
            self._insert_calls += 1
            self._reset()
            if self._always_fail_with is not None:
                raise Exception(self._always_fail_with)
            if self._fail_first_insert and self._insert_calls == 1:
                raise Exception(
                    'duplicate key value violates unique constraint "teams_invite_code_key"'
                )
            row = {
                "id": str(uuid.uuid4()),
                "name": payload["name"],
                "invite_code": payload["invite_code"],
                "total_score": 0,
                "created_at": "2026-10-07T00:00:00+00:00",
                "created_by": "organizer-secret-id",
            }
            self._store["teams"].append(row)
            self._store["inserts"].append(payload)
            return _Resp([dict(row)])

        columns = self._columns
        filters = self._filters
        order = self._order
        limit = self._limit
        self._reset()
        assert columns is not None and columns != "*"
        wanted = [c.strip() for c in columns.split(",")]

        rows = [r for r in self._store["teams"] if all(r.get(k) == v for k, v in filters.items())]
        if order:
            rows = sorted(rows, key=lambda r: r[order])
        if limit is not None:
            rows = rows[:limit]
        return _Resp([{c: r[c] for c in wanted} for r in rows])


class _FakeSupabase:
    def __init__(
        self, *, fail_first_insert: bool = False, always_fail_with: Optional[str] = None
    ):
        self.store = {"teams": [], "selects": [], "inserts": []}
        self._teams = _TeamsTable(
            self.store,
            fail_first_insert=fail_first_insert,
            always_fail_with=always_fail_with,
        )

    def add_team(self, name, invite_code, total_score=0):
        row = {
            "id": str(uuid.uuid4()),
            "name": name,
            "invite_code": invite_code,
            "total_score": total_score,
            "created_at": "2026-10-07T00:00:00+00:00",
            "created_by": "organizer-secret-id",
        }
        self.store["teams"].append(row)
        return row

    def table(self, name):
        assert name == "teams"
        return self._teams


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", ORGANIZER_CODE)
    monkeypatch.setenv("TEAM_SESSION_SECRET", SECRET)
    reset_rate_limit()
    yield
    reset_rate_limit()


def _make_client(monkeypatch, fake):
    import main
    import routes.teams as teams_routes

    monkeypatch.setattr(teams_routes, "get_supabase", lambda: fake)
    return TestClient(main.app)


def _team_headers(token):
    return {"X-Team-Token": token}


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _organizer_bearer():
    token, _ = issue_session_token(ORGANIZER_CODE)
    return _bearer(token)


def _join(client, code):
    res = client.post("/teams/join", json={"invite_code": code})
    assert res.status_code == 200, res.text
    return res.json()


# --- POST /teams/ -----------------------------------------------------------


def test_post_teams_creates_team_and_returns_id_name_and_invite_code(monkeypatch):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/", json={"name": "Team A"}, headers=ORG)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"id", "name", "invite_code"}
    assert body["name"] == "Team A"
    assert len(body["invite_code"]) == 8
    assert fake.store["teams"][0]["id"] == body["id"]
    assert "created_by" not in res.text


def test_post_teams_trims_the_name(monkeypatch):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/", json={"name": "  Team A  "}, headers=ORG)
    assert res.status_code == 200
    assert res.json()["name"] == "Team A"
    assert fake.store["inserts"][0]["name"] == "Team A"


@pytest.mark.parametrize("name", ["", "   ", "x" * 81, "  " + "x" * 81 + "  "])
def test_post_teams_rejects_blank_or_overlong_names(monkeypatch, name):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/", json={"name": name}, headers=ORG)
    assert res.status_code == 422
    assert fake.store["teams"] == []


def test_post_teams_accepts_an_80_character_name(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase())
    res = client.post("/teams/", json={"name": "x" * 80}, headers=ORG)
    assert res.status_code == 200


def test_post_teams_accepts_an_80_character_name_after_trimming(monkeypatch):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/", json={"name": "  " + "x" * 80 + "\n"}, headers=ORG)
    assert res.status_code == 200
    assert res.json()["name"] == "x" * 80
    assert fake.store["inserts"][0]["name"] == "x" * 80


def test_post_teams_rejects_missing_or_non_string_name(monkeypatch):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)
    for body in ({}, {"name": None}, {"name": 5}):
        assert client.post("/teams/", json=body, headers=ORG).status_code == 422
    assert fake.store["teams"] == []


def test_post_teams_accepts_an_organizer_bearer_token(monkeypatch):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/", json={"name": "Team A"}, headers=_organizer_bearer())
    assert res.status_code == 200
    assert set(res.json()) == {"id", "name", "invite_code"}
    assert [t["name"] for t in fake.store["teams"]] == ["Team A"]


def test_post_teams_rejects_a_team_token_sent_as_bearer(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Existing", "ABCDEFGH")
    client = _make_client(monkeypatch, fake)
    token = _join(client, "ABCDEFGH")["token"]
    res = client.post("/teams/", json={"name": "Team A"}, headers=_bearer(token))
    assert res.status_code == 401
    # A valid organizer code does not rescue an invalid Bearer token.
    res = client.post("/teams/", json={"name": "Team A"}, headers={**_bearer(token), **ORG})
    assert res.status_code == 401
    assert [t["name"] for t in fake.store["teams"]] == ["Existing"]


def test_post_teams_requires_organizer_auth(monkeypatch):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)
    body = {"name": "Team A"}
    assert client.post("/teams/", json=body).status_code == 401
    assert client.post("/teams/", json=body, headers={"X-Organizer-Code": "wrong"}).status_code == 401
    assert fake.store["teams"] == []


def test_post_teams_rejects_a_team_token(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Existing", "ABCDEFGH")
    client = _make_client(monkeypatch, fake)
    token = _join(client, "ABCDEFGH")["token"]
    res = client.post("/teams/", json={"name": "Team A"}, headers=_team_headers(token))
    assert res.status_code == 401
    assert [t["name"] for t in fake.store["teams"]] == ["Existing"]


def test_post_teams_retries_on_invite_code_unique_violation(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase(fail_first_insert=True))
    res = client.post("/teams/", json={"name": "Team D"}, headers=ORG)
    assert res.status_code == 200
    body = res.json()
    assert "id" in body and "invite_code" in body


def test_post_teams_failure_returns_generic_detail(monkeypatch):
    secret = "connection to db.internal:5432 refused, password=hunter2"
    client = _make_client(monkeypatch, _FakeSupabase(always_fail_with=secret))
    res = client.post("/teams/", json={"name": "Team E"}, headers=ORG)
    assert res.status_code == 400
    assert res.json()["detail"] == "Failed to create team"
    assert "hunter2" not in res.text
    assert "db.internal" not in res.text


def test_post_teams_exhausted_retries_returns_generic_detail(monkeypatch):
    msg = 'duplicate key value violates unique constraint "teams_invite_code_key" secret-detail'
    client = _make_client(monkeypatch, _FakeSupabase(always_fail_with=msg))
    res = client.post("/teams/", json={"name": "Team F"}, headers=ORG)
    assert res.status_code == 500
    assert res.json()["detail"] == "Failed to create team"
    assert "secret-detail" not in res.text
    assert "duplicate" not in res.text


# --- GET /teams/ ------------------------------------------------------------


def test_get_teams_requires_organizer_auth(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("A", "AAAAAAAA")
    client = _make_client(monkeypatch, fake)
    assert client.get("/teams/").status_code == 401
    assert client.get("/teams/", headers={"X-Organizer-Code": "wrong"}).status_code == 401
    assert fake.store["selects"] == []


def test_get_teams_accepts_an_organizer_bearer_token(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("B", "BBBBBBBB")
    fake.add_team("A", "AAAAAAAA")
    client = _make_client(monkeypatch, fake)
    res = client.get("/teams/", headers=_organizer_bearer())
    assert res.status_code == 200
    assert [t["name"] for t in res.json()] == ["A", "B"]


def test_get_teams_rejects_a_team_token_sent_as_bearer(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Mine", "MINE2222")
    client = _make_client(monkeypatch, fake)
    token = _join(client, "MINE2222")["token"]
    fake.store["selects"].clear()
    res = client.get("/teams/", headers=_bearer(token))
    assert res.status_code == 401
    assert "MINE2222" not in res.text
    assert fake.store["selects"] == []
    # The team header does not unlock the organizer list either.
    assert client.get("/teams/", headers=_team_headers(token)).status_code == 401


def test_get_teams_lists_teams_ordered_by_name_with_exact_fields(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Zebras", "ZZZZZZZZ", total_score=5)
    fake.add_team("Aardvarks", "AAAAAAAA", total_score=9)
    client = _make_client(monkeypatch, fake)

    res = client.get("/teams/", headers=ORG)
    assert res.status_code == 200
    body = res.json()
    assert [t["name"] for t in body] == ["Aardvarks", "Zebras"]
    for team in body:
        assert set(team) == {"id", "name", "invite_code", "total_score", "created_at"}
    assert body[0]["invite_code"] == "AAAAAAAA"
    assert body[0]["total_score"] == 9
    assert "created_by" not in res.text
    assert fake.store["selects"] == ["id,name,invite_code,total_score,created_at"]


def test_get_teams_empty_list(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase())
    res = client.get("/teams/", headers=ORG)
    assert res.status_code == 200
    assert res.json() == []


def test_get_teams_ignores_the_removed_invite_code_query(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("A", "AAAAAAAA")
    fake.add_team("B", "BBBBBBBB")
    client = _make_client(monkeypatch, fake)
    # The invite_code lookup is gone: it needs organizer auth and returns the full list.
    assert client.get("/teams/", params={"invite_code": "AAAAAAAA"}).status_code == 401
    res = client.get("/teams/", params={"invite_code": "AAAAAAAA"}, headers=ORG)
    assert [t["name"] for t in res.json()] == ["A", "B"]


# --- POST /teams/join -------------------------------------------------------


def test_join_returns_team_token_and_expiry(monkeypatch):
    fake = _FakeSupabase()
    team = fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)

    before = datetime.now(timezone.utc).timestamp()
    res = client.post("/teams/join", json={"invite_code": "ABCD2345"})
    after = datetime.now(timezone.utc).timestamp()

    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"team", "token", "expires_at"}
    assert body["team"] == {"id": team["id"], "name": "Team J"}

    verified = team_auth.verify_team_token(body["token"])
    assert verified is not None
    assert verified[0] == team["id"]
    expires = datetime.strptime(body["expires_at"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc
    )
    assert expires.timestamp() == verified[1]
    ttl = team_auth.TEAM_TOKEN_TTL_SECONDS
    assert before + ttl - 2 <= expires.timestamp() <= after + ttl + 2


def test_join_never_returns_invite_code_or_created_by(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/join", json={"invite_code": "ABCD2345"})
    assert res.status_code == 200
    assert "invite_code" not in res.text
    assert "created_by" not in res.text
    assert "ABCD2345" not in res.text
    assert "organizer-secret-id" not in res.text
    assert fake.store["selects"] == ["id,name"]


def test_join_normalizes_the_code(monkeypatch):
    fake = _FakeSupabase()
    team = fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    for code in ("abcd2345", "  abcd2345\n", " ABCD2345 ", "AbCd2345"):
        res = client.post("/teams/join", json={"invite_code": code})
        assert res.status_code == 200, code
        assert res.json()["team"]["id"] == team["id"]


def test_join_unknown_code_returns_404(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/join", json={"invite_code": "ZZZZZZZZ"})
    assert res.status_code == 404
    assert res.json() == {"detail": "Team not found"}
    assert "token" not in res.text


@pytest.mark.parametrize("code", ["", "   ", "\n", "x" * 500])
def test_join_blank_or_oversized_code_returns_404_without_lookup(monkeypatch, code):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/join", json={"invite_code": code})
    assert res.status_code == 404
    assert res.json() == {"detail": "Team not found"}
    assert fake.store["selects"] == []


def test_join_missing_or_non_string_code_is_422(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase())
    assert client.post("/teams/join", json={}).status_code == 422
    assert client.post("/teams/join", json={"invite_code": 123}).status_code == 422
    assert client.post("/teams/join", json={"invite_code": None}).status_code == 422


def test_join_is_public(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    # No organizer or team headers at all.
    assert client.post("/teams/join", json={"invite_code": "ABCD2345"}).status_code == 200


def _assert_not_configured(client, fake):
    res = client.post("/teams/join", json={"invite_code": "ABCD2345"})
    assert res.status_code == 500
    assert res.json() == {"detail": team_auth.NOT_CONFIGURED_DETAIL}
    assert fake.store["selects"] == []


@pytest.mark.parametrize("secret", ["", "short", "s" * (team_auth.MIN_SECRET_LENGTH - 1)])
def test_join_missing_or_short_secret_returns_contract_500_before_lookup(monkeypatch, secret):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    monkeypatch.setenv("TEAM_SESSION_SECRET", secret)
    _assert_not_configured(client, fake)


def test_join_unset_secret_returns_contract_500_before_lookup(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    monkeypatch.delenv("TEAM_SESSION_SECRET", raising=False)
    _assert_not_configured(client, fake)


def test_join_secret_equal_to_organizer_code_returns_contract_500(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    shared = "c" * 40
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", shared)
    monkeypatch.setenv("TEAM_SESSION_SECRET", shared)
    _assert_not_configured(client, fake)


def test_join_bad_team_id_from_db_is_a_generic_500(monkeypatch):
    fake = _FakeSupabase()
    row = fake.add_team("Team J", "ABCD2345")
    row["id"] = "not-a-uuid"
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/join", json={"invite_code": "ABCD2345"})
    assert res.status_code == 500
    assert res.json() == {"detail": "Failed to join team"}
    assert "not-a-uuid" not in res.text


# --- GET /teams/me ----------------------------------------------------------


def test_me_returns_the_tokens_team(monkeypatch):
    fake = _FakeSupabase()
    other = fake.add_team("Other", "OTHER222")
    mine = fake.add_team("Mine", "MINE2222", total_score=42)
    client = _make_client(monkeypatch, fake)
    token = _join(client, "MINE2222")["token"]

    res = client.get("/teams/me", headers=_team_headers(token))
    assert res.status_code == 200
    assert res.json() == {"id": mine["id"], "name": "Mine", "total_score": 42}
    assert other["id"] not in res.text
    assert "invite_code" not in res.text
    assert "created_by" not in res.text
    assert fake.store["selects"][-1] == "id,name,total_score"


def test_me_requires_a_team_token(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Mine", "MINE2222")
    client = _make_client(monkeypatch, fake)
    res = client.get("/teams/me")
    assert res.status_code == 401
    assert res.json() == {"detail": team_auth.TOKEN_INVALID_DETAIL}
    assert client.get("/teams/me", headers=_team_headers("garbage")).status_code == 401
    # Organizer auth is not team auth.
    assert client.get("/teams/me", headers=ORG).status_code == 401
    assert client.get("/teams/me", headers=_organizer_bearer()).status_code == 401
    assert fake.store["selects"] == []


def test_me_rejects_a_token_after_the_secret_rotates(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Mine", "MINE2222")
    client = _make_client(monkeypatch, fake)
    token = _join(client, "MINE2222")["token"]
    assert client.get("/teams/me", headers=_team_headers(token)).status_code == 200
    monkeypatch.setenv("TEAM_SESSION_SECRET", "rotated-" + "r" * 40)
    assert client.get("/teams/me", headers=_team_headers(token)).status_code == 401


def test_me_for_a_deleted_team_returns_404_and_no_other_team(monkeypatch):
    fake = _FakeSupabase()
    gone = fake.add_team("Gone", "GONE2222")
    fake.add_team("Other", "OTHER222", total_score=7)
    client = _make_client(monkeypatch, fake)
    token = _join(client, "GONE2222")["token"]

    fake.store["teams"].remove(gone)
    res = client.get("/teams/me", headers=_team_headers(token))
    assert res.status_code == 404
    assert res.json() == {"detail": "Team not found"}
    assert "Other" not in res.text


def test_me_unconfigured_secret_returns_500(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase())
    monkeypatch.delenv("TEAM_SESSION_SECRET", raising=False)
    res = client.get("/teams/me", headers=_team_headers("anything"))
    assert res.status_code == 500
    assert res.json() == {"detail": team_auth.NOT_CONFIGURED_DETAIL}


# --- Removed routes ---------------------------------------------------------


def test_get_team_by_id_is_removed(monkeypatch):
    fake = _FakeSupabase()
    team = fake.add_team("Mine", "MINE2222")
    client = _make_client(monkeypatch, fake)
    for headers in ({}, ORG):
        res = client.get(f"/teams/{team['id']}", headers=headers)
        assert res.status_code in (404, 405)
        assert "invite_code" not in res.text
    assert fake.store["selects"] == []


def test_teams_route_table_matches_the_contract():
    import main
    from fastapi.routing import APIRoute

    routes = {
        (m, r.path)
        for r in main.app.routes
        if isinstance(r, APIRoute) and r.path.startswith("/teams")
        for m in r.methods - {"HEAD", "OPTIONS"}
    }
    assert routes == {
        ("POST", "/teams/"),
        ("GET", "/teams/"),
        ("POST", "/teams/join"),
        ("GET", "/teams/me"),
    }


def test_teams_routes_never_select_star():
    from pathlib import Path

    source = (Path(__file__).resolve().parents[1] / "routes" / "teams.py").read_text()
    assert 'select("*")' not in source
    assert "select('*')" not in source


# --- Review round (manager) ---------------------------------------------------


@pytest.mark.parametrize("code", ["ABCD-2345", "ABCD 2345", "abcd\u00172345", "ABCD\x002345"])
def test_join_rejects_non_alphanumeric_codes_without_lookup(monkeypatch, code):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    res = client.post("/teams/join", json={"invite_code": code})
    assert res.status_code == 404
    assert res.json() == {"detail": "Team not found"}
    assert fake.store["selects"] == []


def test_join_rejects_non_ascii_that_upper_cases_to_a_real_code(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCDS234")
    client = _make_client(monkeypatch, fake)
    # "ſ" (long s) upper-cases to "S".
    res = client.post("/teams/join", json={"invite_code": "abcdſ234"})
    assert res.status_code == 404
    assert fake.store["selects"] == []


def test_join_lookup_failure_is_a_generic_500(monkeypatch, caplog):
    fake = _FakeSupabase()
    client = _make_client(monkeypatch, fake)

    def boom(name):
        raise Exception("Key (invite_code)=(ABCD2345) leaked-detail")

    monkeypatch.setattr(fake, "table", boom)
    with caplog.at_level("ERROR"):
        res = client.post("/teams/join", json={"invite_code": "ABCD2345"})
    assert res.status_code == 500
    assert res.json() == {"detail": "Failed to join team"}
    assert "leaked-detail" not in caplog.text
    assert "ABCD2345" not in caplog.text


def test_create_failure_logs_never_include_the_error_text(monkeypatch, caplog):
    msg = 'duplicate key value violates unique constraint "teams_invite_code_key" Key (invite_code)=(QQQQ2222)'
    client = _make_client(monkeypatch, _FakeSupabase(always_fail_with=msg))
    with caplog.at_level("ERROR"):
        client.post("/teams/", json={"name": "Team F"}, headers=ORG)
    assert "QQQQ2222" not in caplog.text
    assert "Failed to generate unique invite_code" in caplog.text

    other = "Failing row contains (Team G, ZZZZ9999)"
    client = _make_client(monkeypatch, _FakeSupabase(always_fail_with=other))
    caplog.clear()
    with caplog.at_level("ERROR"):
        client.post("/teams/", json={"name": "Team G"}, headers=ORG)
    assert "ZZZZ9999" not in caplog.text
    assert "Failed to create team" in caplog.text


def test_list_and_join_responses_are_not_cached(monkeypatch):
    fake = _FakeSupabase()
    fake.add_team("Team J", "ABCD2345")
    client = _make_client(monkeypatch, fake)
    assert client.get("/teams/", headers=ORG).headers["cache-control"] == "no-store"
    res = client.post("/teams/join", json={"invite_code": "ABCD2345"})
    assert res.status_code == 200
    assert res.headers["cache-control"] == "no-store"
