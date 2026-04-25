import uuid

from fastapi.testclient import TestClient


class _Resp:
    def __init__(self, data):
        self.data = data


class _TeamsTable:
    def __init__(self, store, *, fail_first_insert: bool = False):
        self._store = store
        self._filters = {}
        self._pending_insert = None
        self._fail_first_insert = fail_first_insert
        self._insert_calls = 0

    def select(self, cols: str = "*"):
        return self

    def insert(self, payload):
        self._pending_insert = payload
        return self

    def eq(self, k, v):
        self._filters[k] = v
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if self._pending_insert is not None:
            self._insert_calls += 1
            if self._fail_first_insert and self._insert_calls == 1:
                raise Exception(
                    'duplicate key value violates unique constraint "teams_invite_code_key"'
                )

            tid = str(uuid.uuid4())
            row = {
                "id": tid,
                "name": self._pending_insert["name"],
                "invite_code": self._pending_insert["invite_code"],
                "total_score": 0,
            }
            self._store["teams_by_id"][tid] = row
            self._store["teams_by_invite"][row["invite_code"]] = row
            return _Resp([{"id": tid, "invite_code": row["invite_code"]}])

        if "id" in self._filters:
            row = self._store["teams_by_id"].get(self._filters["id"])
            return _Resp(row if row is not None else None)

        if "invite_code" in self._filters:
            row = self._store["teams_by_invite"].get(self._filters["invite_code"])
            return _Resp(row if row is not None else None)

        raise AssertionError("Unexpected query in fake teams table")


class _FakeSupabase:
    def __init__(self, *, fail_first_insert: bool = False):
        self._store = {"teams_by_id": {}, "teams_by_invite": {}}
        self._teams = _TeamsTable(self._store, fail_first_insert=fail_first_insert)

    def table(self, name):
        assert name == "teams"
        return self._teams


def _make_client(monkeypatch, fake):
    import main
    import routes.teams as teams_routes

    monkeypatch.setattr(teams_routes, "get_supabase", lambda: fake)
    return TestClient(main.app)


def test_post_teams_creates_team_and_returns_id_and_invite_code(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase())
    res = client.post("/teams/", json={"name": "Team A"})
    assert res.status_code == 200
    body = res.json()
    assert "id" in body
    assert "invite_code" in body


def test_get_teams_by_id_includes_total_score(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase())
    created = client.post("/teams/", json={"name": "Team B"}).json()

    res = client.get(f"/teams/{created['id']}")
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == created["id"]
    assert body["total_score"] == 0


def test_get_teams_by_invite_code_returns_team_or_404(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase())
    created = client.post("/teams/", json={"name": "Team C"}).json()

    ok = client.get("/teams/", params={"invite_code": created["invite_code"]})
    assert ok.status_code == 200
    assert ok.json()["invite_code"] == created["invite_code"]

    missing = client.get("/teams/", params={"invite_code": "DOESNOTEXIST"})
    assert missing.status_code == 404


def test_post_teams_retries_on_invite_code_unique_violation(monkeypatch):
    client = _make_client(monkeypatch, _FakeSupabase(fail_first_insert=True))
    res = client.post("/teams/", json={"name": "Team D"})
    assert res.status_code == 200
    body = res.json()
    assert "id" in body and "invite_code" in body
