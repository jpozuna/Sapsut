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
