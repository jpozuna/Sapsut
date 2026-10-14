from fastapi.testclient import TestClient


class _Resp:
    def __init__(self, data):
        self.data = data


class _TasksTable:
    def __init__(self, rows):
        self._rows = rows
        self.selected = None

    def select(self, cols: str = "*"):
        self.selected = cols
        return self

    def execute(self):
        return _Resp([dict(r) for r in self._rows])


class _FakeSupabase:
    def __init__(self, rows):
        self.tasks = _TasksTable(rows)

    def table(self, name):
        assert name == "tasks"
        return self.tasks


def _client(monkeypatch, rows):
    import main
    from routes import tasks as tasks_routes

    fake = _FakeSupabase(rows)
    monkeypatch.setattr(tasks_routes, "get_supabase", lambda: fake)
    return fake, TestClient(main.app)


def test_list_tasks_hides_rubric(monkeypatch):
    row = {
        "id": "t1",
        "title": "Find the statue",
        "description": "d",
        "type": "text",
        "max_points": 5,
        "rubric": {"answer": "secret-answer"},
        "is_active": True,
        "opens_at": None,
        "closes_at": None,
        "allow_multiple_submissions": False,
        "created_at": "2026-10-07T00:00:00Z",
    }
    fake, client = _client(monkeypatch, [row])

    resp = client.get("/tasks/")
    assert resp.status_code == 200
    (task,) = resp.json()
    assert "rubric" not in task
    assert "secret-answer" not in resp.text
    assert task["title"] == "Find the statue"
    assert task["max_points"] == 5
    assert "rubric" not in fake.tasks.selected
    assert "*" not in fake.tasks.selected


def test_list_tasks_empty(monkeypatch):
    _, client = _client(monkeypatch, [])
    assert client.get("/tasks/").json() == []


# --- Task window rules ---------------------------------------------------------

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402

from services.task_window import is_listed, is_open  # noqa: E402

NOW = datetime(2026, 10, 14, 12, 0, 0, tzinfo=timezone.utc)


def _task(**overrides):
    task = {"is_active": True, "opens_at": None, "closes_at": None}
    task.update(overrides)
    return task


def test_window_null_fields_mean_listed_and_open():
    assert is_listed({}, NOW) and is_open({}, NOW)
    assert is_listed(_task(is_active=None), NOW) and is_open(_task(is_active=None), NOW)


def test_window_inactive_is_neither_listed_nor_open():
    task = _task(is_active=False)
    assert not is_listed(task, NOW)
    assert not is_open(task, NOW)


def test_window_opens_at_boundary_is_inclusive():
    assert is_listed(_task(opens_at="2026-10-14T12:00:00Z"), NOW)
    assert is_open(_task(opens_at="2026-10-14T12:00:00Z"), NOW)
    later = _task(opens_at="2026-10-14T12:00:01Z")
    assert not is_listed(later, NOW)
    assert not is_open(later, NOW)


def test_window_closes_at_boundary_is_inclusive_and_closed_stays_listed():
    assert is_open(_task(closes_at="2026-10-14T12:00:00Z"), NOW)
    closed = _task(closes_at="2026-10-14T11:59:59Z")
    assert is_listed(closed, NOW)
    assert not is_open(closed, NOW)


def test_window_opens_after_closes_is_never_open():
    task = _task(opens_at="2026-10-14T13:00:00Z", closes_at="2026-10-14T11:00:00Z")
    assert not is_listed(task, NOW)
    assert not is_open(task, NOW)


@pytest.mark.parametrize(
    "value",
    [
        "2026-10-14T12:00:00Z",
        "2026-10-14T12:00:00+00:00",
        "2026-10-14T12:00:00.000+00",
        "2026-10-14T12:00:00.000000Z",
        "2026-10-14T14:00:00+02:00",
        "2026-10-14T07:00:00-0500",
        "2026-10-14 12:00:00+00:00",
        "2026-10-14T12:00:00",  # naive counts as UTC
        datetime(2026, 10, 14, 12, 0, 0, tzinfo=timezone.utc),
    ],
)
def test_window_parses_iso_forms_to_the_same_instant(value):
    assert is_open(_task(opens_at=value, closes_at=value), NOW)
    after = NOW + timedelta(seconds=1)
    assert not is_open(_task(closes_at=value), after)


@pytest.mark.parametrize("field", ["opens_at", "closes_at"])
@pytest.mark.parametrize("bad", ["", "soon", "2026-13-40T00:00:00Z", "2026-10-14", 12345, "2026-10-14T99:00:00Z"])
def test_window_unparseable_timestamp_is_not_listed(field, bad):
    task = _task(**{field: bad})
    assert not is_listed(task, NOW)
    assert not is_open(task, NOW)


def test_window_odd_fraction_lengths_parse():
    assert not is_open(_task(closes_at="2026-10-14T11:59:59.99999Z"), NOW)
    assert is_open(_task(closes_at="2026-10-14T12:00:00.12345Z"), NOW)
    assert is_open(_task(closes_at="2026-10-14T12:00:00.1234567890Z"), NOW)


def test_window_non_true_is_active_value_is_not_listed():
    assert not is_listed(_task(is_active="false"), NOW)


# --- GET /tasks/ filtering -----------------------------------------------------


def _public(task_id, **overrides):
    row = {
        "id": task_id,
        "title": task_id,
        "description": "d",
        "type": "text",
        "max_points": 1,
        "is_active": True,
        "opens_at": None,
        "closes_at": None,
        "allow_multiple_submissions": False,
        "created_at": "2026-10-07T00:00:00Z",
    }
    row.update(overrides)
    return row


def test_list_tasks_hides_inactive_and_unopened_but_keeps_closed(monkeypatch):
    now = datetime.now(timezone.utc)
    past = (now - timedelta(days=1)).isoformat()
    future = (now + timedelta(days=1)).isoformat()
    rows = [
        _public("open"),
        _public("null-active", is_active=None),
        _public("windowed", opens_at=past, closes_at=future),
        _public("inactive", is_active=False),
        _public("unopened", opens_at=future),
        _public("closed", opens_at=past, closes_at=past),
        _public("garbled", opens_at="soon"),
    ]
    _, client = _client(monkeypatch, rows)

    ids = [t["id"] for t in client.get("/tasks/").json()]
    assert ids == ["open", "null-active", "windowed", "closed"]


def test_list_tasks_response_fields_are_unchanged(monkeypatch):
    from routes.tasks import _PUBLIC_TASK_FIELDS

    _, client = _client(monkeypatch, [_public("a", rubric={"answer": "x"})])
    (task,) = client.get("/tasks/").json()
    assert tuple(task) == _PUBLIC_TASK_FIELDS
