import uuid as _uuid

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


class _TableQuery:
    def __init__(self, db, name):
        self._db = db
        self._name = name
        self._filters = {}
        self._neq = {}
        self._limit = None
        self._order = None
        self._insert_payloads = []
        self._select_cols = "*"
        self._single = False

    def select(self, cols="*"):
        self._select_cols = cols
        return self

    def eq(self, k, v):
        self._filters[k] = v
        return self

    def neq(self, k, v):
        self._neq[k] = v
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, k, desc=False):
        self._order = (k, bool(desc))
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
        for k, v in self._neq.items():
            rows = [r for r in rows if r.get(k) != v]
        if self._order:
            key, desc = self._order
            rows.sort(key=lambda r: r.get(key), reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._single:
            return _Resp(rows[0] if rows else None)
        return _Resp(rows)


class _StorageBucket:
    def __init__(self, parent):
        self._parent = parent

    def upload(self, path, data, file_options=None):
        if self._parent.fail_upload:
            raise RuntimeError("boom-secret-storage-detail")
        self._parent.upload_calls.append((path, data, file_options))
        return {"path": path}

    def create_signed_url(self, path, expires_in):
        self._parent.sign_calls.append((path, expires_in))
        return {"signedURL": f"https://signed.example/{path}?exp={expires_in}"}


class _Storage:
    def __init__(self, parent):
        self._parent = parent

    def from_(self, bucket):
        self._parent.bucket_calls.append(bucket)
        return _StorageBucket(self._parent)


class _FakeSupabase:
    def __init__(self):
        self.db = {"submissions": [], "tasks": []}
        self.storage = _Storage(self)
        self.fail_upload = False
        self.upload_calls = []
        self.sign_calls = []
        self.bucket_calls = []

    def table(self, name):
        return _TableQuery(self.db, name)


TASK_ID = "11111111-1111-1111-1111-111111111111"
TEAM_ID = "22222222-2222-2222-2222-222222222222"
OTHER_TEAM_ID = "33333333-3333-3333-3333-333333333333"
LETTER_TEAM_ID = "abcdef12-3333-4333-8333-abcdefabcdef"
SUB1 = "aaaaaaaa-0000-4000-8000-000000000001"
SUB2 = "aaaaaaaa-0000-4000-8000-000000000002"


@pytest.fixture()
def app_and_client(monkeypatch):
    if not _HAVE_MULTIPART:
        pytest.skip('FastAPI Form/File routes require "python-multipart"')

    from routes import submissions as submissions_routes

    monkeypatch.setenv("TEAM_SESSION_SECRET", "t" * 40)
    monkeypatch.delenv("ORGANIZER_DEMO_CODE", raising=False)

    fake = _FakeSupabase()
    # Default: allow multiple to avoid the existing-submission branch.
    fake.db["tasks"].append({"id": TASK_ID, "allow_multiple_submissions": True})

    monkeypatch.setattr(submissions_routes, "get_supabase", lambda: fake)
    monkeypatch.setattr(submissions_routes, "score_submission", lambda *a, **kw: None)

    app = FastAPI()
    app.include_router(submissions_routes.router, prefix="/submissions")
    client = TestClient(app)
    client.headers.update(_team_headers(TEAM_ID))
    return fake, client


def _team_headers(team_id):
    from auth.team import issue_team_token

    token, _expires = issue_team_token(team_id)
    return {"X-Team-Token": token}


def _row(sub_id=SUB1, team_id=TEAM_ID, task_id=TASK_ID, **overrides):
    row = {
        "id": sub_id,
        "task_id": task_id,
        "team_id": team_id,
        "text_answer": "",
        "photo_url": f"{team_id}/{task_id}/{sub_id}.png",
        "status": "approved",
        "score": 3,
        "confidence": 0.95,
        "rationale": "ok",
        "gpt4o_description": "desc",
        "ai_result": {"mode": "llm"},
        "created_at": "2026-01-01T00:00:00Z",
    }
    row.update(overrides)
    return row


def test_post_submission_photo_upload_path_format(app_and_client, monkeypatch):
    fake, client = app_and_client

    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000123")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)

    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "text_answer": ""},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "pending"
    assert body["submission_id"] == str(fixed_id)

    assert fake.upload_calls, "expected storage upload to be called"
    uploaded_path, uploaded_bytes, file_options = fake.upload_calls[0]
    assert uploaded_path == f"{TEAM_ID}/{TASK_ID}/{fixed_id}.png"
    assert uploaded_bytes == b"pngbytes"
    assert file_options["content-type"] == "image/png"

    assert fake.db["submissions"], "expected submission to be inserted"
    inserted = fake.db["submissions"][0]
    assert inserted["photo_url"] == uploaded_path
    assert inserted["team_id"] == TEAM_ID
    assert inserted["status"] == "pending"


def test_post_submission_matching_team_id_field_is_accepted(app_and_client):
    fake, client = app_and_client
    resp = client.post(
        "/submissions/",
        # Different case still names the same team.
        data={"task_id": TASK_ID, "team_id": TEAM_ID.upper(), "text_answer": "hi"},
    )
    assert resp.status_code == 200
    assert fake.db["submissions"][0]["team_id"] == TEAM_ID


def test_post_submission_team_comes_from_token_not_client(app_and_client):
    fake, client = app_and_client
    resp = client.post("/submissions/", data={"task_id": TASK_ID, "text_answer": "hi"})
    assert resp.status_code == 200
    assert fake.db["submissions"][0]["team_id"] == TEAM_ID


def test_post_submission_requires_team_token(app_and_client):
    fake, client = app_and_client
    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "text_answer": "hi"},
        headers={"X-Team-Token": ""},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or missing team token."

    bad = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "text_answer": "hi"},
        headers={"X-Team-Token": "not-a-token"},
    )
    assert bad.status_code == 401
    assert fake.db["submissions"] == []
    assert fake.upload_calls == []


@pytest.mark.parametrize("team_field", [OTHER_TEAM_ID, "not-a-uuid"])
def test_post_submission_team_mismatch_is_403(app_and_client, team_field):
    fake, client = app_and_client
    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "team_id": team_field, "text_answer": "hi"},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Team mismatch."
    assert fake.db["submissions"] == []
    assert fake.upload_calls == []


def test_post_submission_photo_path_field_is_ignored(app_and_client, monkeypatch):
    fake, client = app_and_client
    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000456")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)

    foreign = f"{OTHER_TEAM_ID}/{TASK_ID}/stolen.png"
    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "photo_path": foreign, "text_answer": ""},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 200
    expected = f"{TEAM_ID}/{TASK_ID}/{fixed_id}.png"
    assert fake.db["submissions"][0]["photo_url"] == expected
    assert fake.upload_calls[0][0] == expected


def test_post_submission_photo_path_alone_is_not_an_input(app_and_client):
    fake, client = app_and_client
    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "photo_path": f"{TEAM_ID}/{TASK_ID}/x.png"},
    )
    assert resp.status_code == 200
    assert "error" in resp.json()
    assert fake.db["submissions"] == []


def test_post_submission_canonicalizes_task_id_in_path(app_and_client, monkeypatch):
    fake, client = app_and_client
    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000789")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)
    fake.db["tasks"][0]["id"] = TASK_ID
    task_upper = "AAAAAAAA-1111-1111-1111-111111111111"
    fake.db["tasks"].append({"id": task_upper.lower(), "allow_multiple_submissions": True})

    resp = client.post(
        "/submissions/",
        data={"task_id": task_upper, "text_answer": ""},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 200
    assert fake.upload_calls[0][0] == f"{TEAM_ID}/{task_upper.lower()}/{fixed_id}.png"


def _capture_scoring(monkeypatch):
    from routes import submissions as submissions_routes

    calls = []
    monkeypatch.setattr(submissions_routes, "score_submission", lambda *a, **kw: calls.append((a, kw)))
    return calls


def test_post_submission_uppercase_task_id_is_canonical_end_to_end(app_and_client, monkeypatch):
    fake, client = app_and_client
    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000abc")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)
    calls = _capture_scoring(monkeypatch)
    task_lower = "abcdef12-1111-4111-8111-abcdefabcdef"
    fake.db["tasks"].append({"id": task_lower, "allow_multiple_submissions": True})

    resp = client.post(
        "/submissions/",
        data={"task_id": task_lower.upper(), "text_answer": ""},
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 200
    expected = f"{TEAM_ID}/{task_lower}/{fixed_id}.png"
    assert fake.upload_calls[0][0] == expected
    stored = fake.db["submissions"][0]
    assert stored["task_id"] == task_lower
    assert stored["photo_url"] == expected
    assert calls == [((str(fixed_id), task_lower, TEAM_ID, "", expected, False), {})]

    # The stored path matches the signing check, so GET signs it.
    got = client.get(f"/submissions/{fixed_id}")
    assert got.status_code == 200
    assert got.json()["photo_signed_url"].startswith("https://signed.example/")
    assert fake.sign_calls == [(expected, 600)]


def test_post_submission_stores_token_team_when_form_team_differs_only_in_case(app_and_client):
    fake, client = app_and_client
    client.headers.update(_team_headers(LETTER_TEAM_ID))
    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "team_id": LETTER_TEAM_ID.upper(), "text_answer": "hi"},
    )
    assert resp.status_code == 200
    assert fake.db["submissions"][0]["team_id"] == LETTER_TEAM_ID


def test_post_submission_scoring_gets_token_team_and_server_path(app_and_client, monkeypatch):
    fake, client = app_and_client
    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000def")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)
    calls = _capture_scoring(monkeypatch)

    foreign = f"{OTHER_TEAM_ID}/{TASK_ID}/stolen.png"
    resp = client.post(
        "/submissions/",
        data={
            "task_id": TASK_ID,
            "team_id": TEAM_ID.upper(),
            "photo_path": foreign,
            "text_answer": "hi",
        },
        files={"photo": ("x.png", b"pngbytes", "image/png")},
    )
    assert resp.status_code == 200
    server_path = f"{TEAM_ID}/{TASK_ID}/{fixed_id}.png"
    assert calls == [((str(fixed_id), TASK_ID, TEAM_ID, "hi", server_path, False), {})]
    assert foreign not in str(calls)


def test_post_submission_text_only_scoring_gets_no_photo_path(app_and_client, monkeypatch):
    fake, client = app_and_client
    calls = _capture_scoring(monkeypatch)

    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "photo_path": f"{TEAM_ID}/{TASK_ID}/x.png", "text_answer": "hi"},
    )
    assert resp.status_code == 200
    assert len(calls) == 1
    args, _kwargs = calls[0]
    assert args[2] == TEAM_ID
    assert args[4] is None
    assert fake.db["submissions"][0]["photo_url"] is None


def test_post_submission_403_mismatch_does_not_score(app_and_client, monkeypatch):
    _fake, client = app_and_client
    calls = _capture_scoring(monkeypatch)
    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "team_id": OTHER_TEAM_ID, "text_answer": "hi"},
    )
    assert resp.status_code == 403
    assert calls == []


def test_post_submission_one_submission_check_uses_token_team(app_and_client):
    fake, client = app_and_client
    fake.db["tasks"][0]["allow_multiple_submissions"] = False
    fake.db["tasks"][0]["type"] = "text"
    # Another team already answered; that must not block this team.
    fake.db["submissions"].append(_row(sub_id=SUB2, team_id=OTHER_TEAM_ID, status="pending"))

    first = client.post("/submissions/", data={"task_id": TASK_ID, "text_answer": "hi"})
    assert first.status_code == 200
    assert first.json()["status"] == "pending"

    # This team's own row blocks it, and a form team_id cannot change who is checked.
    second = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "team_id": TEAM_ID.upper(), "text_answer": "again"},
    )
    assert second.json()["existing_submission_id"] == first.json()["submission_id"]

    # Another team's token is checked against that team's rows only.
    third = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "text_answer": "x"},
        headers=_team_headers(OTHER_TEAM_ID),
    )
    assert third.json()["existing_submission_id"] == SUB2


def test_post_submission_upload_failure_sets_error_status(app_and_client, monkeypatch):
    fake, client = app_and_client
    fake.fail_upload = True

    fixed_id = _uuid.UUID("00000000-0000-0000-0000-000000000999")
    from routes import submissions as submissions_routes

    monkeypatch.setattr(submissions_routes.uuid, "uuid4", lambda: fixed_id)

    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "text_answer": "hi"},
        files={"photo": ("x.jpg", b"jpgbytes", "image/jpeg")},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"

    assert fake.db["submissions"], "expected error submission row to be inserted"
    inserted = fake.db["submissions"][0]
    assert inserted["id"] == str(fixed_id)
    assert inserted["team_id"] == TEAM_ID
    assert inserted["status"] == "error"
    assert inserted["photo_url"] is None
    assert "boom-secret-storage-detail" not in str(inserted["rationale"])
    assert "boom-secret-storage-detail" not in str(inserted["ai_result"])
    assert inserted["rationale"] == "Photo upload failed"
    assert inserted["ai_result"]["error"] == "Photo upload failed"

    # The stored row is readable through GET /submissions/{id}; ensure nothing leaks.
    got = client.get(f"/submissions/{fixed_id}")
    assert got.status_code == 200
    assert "boom-secret-storage-detail" not in got.text


def test_get_submission_by_id_includes_signed_url_when_photo_exists(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(_row())

    resp = client.get(f"/submissions/{SUB1}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == SUB1
    assert "photo_url" not in data
    assert data["photo_signed_url"].startswith("https://signed.example/")
    assert fake.sign_calls == [(f"{TEAM_ID}/{TASK_ID}/{SUB1}.png", 600)]


def test_get_submission_requires_team_token(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(_row())

    resp = client.get(f"/submissions/{SUB1}", headers={"X-Team-Token": ""})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or missing team token."
    assert fake.sign_calls == []


def test_get_submission_of_other_team_is_404_like_missing(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(_row(sub_id=SUB2, team_id=OTHER_TEAM_ID))

    other = client.get(f"/submissions/{SUB2}")
    missing = client.get(f"/submissions/{_uuid.uuid4()}")
    assert other.status_code == 404
    assert other.json() == {"detail": "Submission not found"}
    assert missing.status_code == 404
    assert missing.json() == other.json()
    assert fake.sign_calls == []


def test_get_submission_team_match_ignores_db_id_case(app_and_client):
    fake, client = app_and_client
    client.headers.update(_team_headers(LETTER_TEAM_ID))
    path = f"{LETTER_TEAM_ID}/{TASK_ID}/{SUB1}.png"
    fake.db["submissions"].append(_row(team_id=LETTER_TEAM_ID.upper(), photo_url=path))

    resp = client.get(f"/submissions/{SUB1}")
    assert resp.status_code == 200
    assert resp.json()["photo_signed_url"].startswith("https://signed.example/")
    assert fake.sign_calls == [(path, 600)]


def test_get_submission_non_uuid_id_is_404_without_db_call(app_and_client, monkeypatch):
    from routes import submissions as submissions_routes

    _fake, client = app_and_client

    def _boom():
        raise AssertionError("database must not be touched")

    monkeypatch.setattr(submissions_routes, "get_supabase", _boom)
    resp = client.get("/submissions/not-a-uuid")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Submission not found"}


_BAD_PATHS = {
    "foreign_team": f"{OTHER_TEAM_ID}/{TASK_ID}/{SUB1}.png",
    "foreign_task": f"{TEAM_ID}/99999999-9999-9999-9999-999999999999/{SUB1}.png",
    "traversal": f"{TEAM_ID}/{TASK_ID}/../{OTHER_TEAM_ID}/{TASK_ID}/{SUB1}.png",
    "traversal_name": f"{TEAM_ID}/{TASK_ID}/..{SUB1}.png",
    "leading_slash": f"/{TEAM_ID}/{TASK_ID}/{SUB1}.png",
    "bad_extension": f"{TEAM_ID}/{TASK_ID}/{SUB1}.gif",
    "no_extension": f"{TEAM_ID}/{TASK_ID}/{SUB1}",
    "non_uuid_name": f"{TEAM_ID}/{TASK_ID}/photo.png",
    "trailing_junk": f"{TEAM_ID}/{TASK_ID}/{SUB1}.png/extra",
    "trailing_newline": f"{TEAM_ID}/{TASK_ID}/{SUB1}.png\n",
    "uppercase_team": f"{LETTER_TEAM_ID.upper()}/{TASK_ID}/{SUB1}.png",
    "other_bucket": f"private/{SUB1}.png",
}


@pytest.mark.parametrize("name", sorted(_BAD_PATHS))
def test_get_submission_withholds_signed_url_for_unexpected_path(app_and_client, caplog, name):
    fake, client = app_and_client
    team = LETTER_TEAM_ID if name == "uppercase_team" else TEAM_ID
    client.headers.update(_team_headers(team))
    fake.db["submissions"].append(_row(team_id=team, photo_url=_BAD_PATHS[name]))

    with caplog.at_level("WARNING", logger="routes.submissions"):
        resp = client.get(f"/submissions/{SUB1}")
    assert resp.status_code == 200
    assert "photo_signed_url" not in resp.json()
    assert fake.sign_calls == []
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any(SUB1 in w for w in warnings)
    # The path itself (which can embed another team's ids) is not logged.
    assert all(OTHER_TEAM_ID not in w for w in warnings)


@pytest.mark.parametrize("ext", ["jpg", "png", "webp", "heic", "heif"])
def test_get_submission_signs_every_allowed_extension(app_and_client, ext):
    fake, client = app_and_client
    path = f"{TEAM_ID}/{TASK_ID}/{SUB1}.{ext}"
    fake.db["submissions"].append(_row(photo_url=path))

    resp = client.get(f"/submissions/{SUB1}")
    assert resp.json()["photo_signed_url"].startswith("https://signed.example/")
    assert fake.sign_calls == [(path, 600)]


def test_get_submission_without_photo_has_no_signed_url_or_warning(app_and_client, caplog):
    fake, client = app_and_client
    fake.db["submissions"].append(_row(photo_url=None))

    with caplog.at_level("WARNING", logger="routes.submissions"):
        resp = client.get(f"/submissions/{SUB1}")
    assert resp.status_code == 200
    assert "photo_signed_url" not in resp.json()
    assert [r for r in caplog.records if r.levelname == "WARNING"] == []


def test_list_submissions_omits_signed_urls(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].extend(
        [
            _row(created_at="2026-01-02T00:00:00Z"),
            _row(
                sub_id=SUB2,
                task_id="22222222-aaaa-aaaa-aaaa-222222222222",
                text_answer="hi",
                photo_url=None,
                status="pending",
                score=None,
                confidence=None,
                rationale=None,
                gpt4o_description=None,
                ai_result=None,
                created_at="2026-01-03T00:00:00Z",
            ),
        ]
    )

    resp = client.get("/submissions/")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert [r["id"] for r in rows] == [SUB2, SUB1]
    assert all("photo_signed_url" not in r for r in rows)


def test_list_submissions_only_returns_token_team_and_filters_by_task(app_and_client):
    fake, client = app_and_client
    other_task = "22222222-aaaa-aaaa-aaaa-222222222222"
    fake.db["submissions"].extend(
        [
            _row(sub_id=SUB1),
            _row(sub_id=SUB2, task_id=other_task),
            _row(sub_id="aaaaaaaa-0000-4000-8000-000000000003", team_id=OTHER_TEAM_ID),
        ]
    )

    all_rows = client.get("/submissions/").json()
    assert sorted(r["id"] for r in all_rows) == [SUB1, SUB2]
    assert all(r["team_id"] == TEAM_ID for r in all_rows)

    by_task = client.get(f"/submissions/?task_id={other_task}").json()
    assert [r["id"] for r in by_task] == [SUB2]

    same_team = client.get(f"/submissions/?team_id={TEAM_ID}&task_id={TASK_ID}").json()
    assert [r["id"] for r in same_team] == [SUB1]


def test_list_submissions_requires_team_token(app_and_client):
    _fake, client = app_and_client
    resp = client.get(f"/submissions/?team_id={TEAM_ID}", headers={"X-Team-Token": ""})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or missing team token."


@pytest.mark.parametrize("team_param", [OTHER_TEAM_ID, "not-a-uuid"])
def test_list_submissions_team_mismatch_is_403(app_and_client, team_param):
    fake, client = app_and_client
    fake.db["submissions"].append(_row(team_id=OTHER_TEAM_ID))

    resp = client.get("/submissions/", params={"team_id": team_param})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Team mismatch."


def test_list_submissions_task_filter_stays_scoped_to_token_team(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].extend(
        [
            _row(sub_id=SUB1),
            _row(sub_id=SUB2, team_id=OTHER_TEAM_ID),
        ]
    )

    rows = client.get(f"/submissions/?task_id={TASK_ID}").json()
    assert [r["id"] for r in rows] == [SUB1]

    # Asking for the other team with the same task filter is refused, not served.
    resp = client.get(f"/submissions/?task_id={TASK_ID}&team_id={OTHER_TEAM_ID}")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Team mismatch."


def test_participant_routes_reject_organizer_bearer_without_team_token(
    app_and_client, monkeypatch
):
    from auth.organizer import issue_session_token

    fake, client = app_and_client
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "organizer-code-for-tests")
    token, _expires = issue_session_token("organizer-code-for-tests")
    client.headers.pop("X-Team-Token")
    client.headers.update({"Authorization": f"Bearer {token}"})
    fake.db["submissions"].append(_row())

    for resp in (
        client.get("/submissions/"),
        client.get(f"/submissions/{SUB1}"),
        client.post("/submissions/", data={"task_id": TASK_ID, "text_answer": "hi"}),
    ):
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid or missing team token."
    assert fake.db["submissions"] == [_row()]
    assert fake.sign_calls == []


def test_team_routes_return_500_when_unconfigured(app_and_client, monkeypatch):
    _fake, client = app_and_client
    monkeypatch.delenv("TEAM_SESSION_SECRET")
    resp = client.get("/submissions/")
    assert resp.status_code == 500
    assert resp.json()["detail"] == "Team access is not configured."


_REMOVED_FIELDS = ("ai_result", "confidence", "gpt4o_description", "photo_url")
_ALLOWED_DETAIL = {
    "id",
    "task_id",
    "team_id",
    "text_answer",
    "status",
    "score",
    "rationale",
    "created_at",
    "photo_signed_url",
}
_SECRET = "Hunter2-Expected-Answer"


def _secret_row(sub_id, status, rationale):
    return _row(
        sub_id=sub_id,
        text_answer="my guess",
        status=status,
        score=5,
        confidence=0.99,
        rationale=rationale,
        gpt4o_description=f"a sign reading {_SECRET}",
        ai_result={"mode": "exact_match", "criteria": _SECRET},
    )


def test_get_submission_hides_scoring_internals(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(
        _secret_row(SUB1, "flagged", f"Answer should be {_SECRET}")
    )

    resp = client.get(f"/submissions/{SUB1}")
    assert resp.status_code == 200
    data = resp.json()
    for field in _REMOVED_FIELDS:
        assert field not in data
    assert set(data) <= _ALLOWED_DETAIL
    assert data["photo_signed_url"].startswith("https://signed.example/")
    assert _SECRET not in resp.text
    assert data["rationale"] == "Your submission is awaiting organizer review."


def test_list_submissions_hides_scoring_internals(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row(SUB1, "approved", f"Matches {_SECRET}"))

    resp = client.get("/submissions/")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    for field in _REMOVED_FIELDS:
        assert field not in rows[0]
    assert set(rows[0]) <= _ALLOWED_DETAIL - {"photo_signed_url"}
    assert _SECRET not in resp.text
    assert rows[0]["score"] == 5
    assert rows[0]["rationale"] == "Your submission was approved."


@pytest.mark.parametrize("status", ["approved", "auto_approved", "reviewed", "flagged", "error"])
def test_participant_rationale_is_fixed_per_status(app_and_client, status):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row(SUB1, status, f"leak {_SECRET}"))

    data = client.get(f"/submissions/{SUB1}").json()
    assert _SECRET not in data["rationale"]
    assert data["rationale"]


def test_pending_submission_has_no_rationale(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row(SUB1, "pending", f"leak {_SECRET}"))

    data = client.get(f"/submissions/{SUB1}").json()
    assert data["rationale"] is None
    assert _SECRET not in str(data)


@pytest.mark.parametrize("status", ["approved", "auto_approved", "reviewed"])
def test_final_status_shows_score(app_and_client, status):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row(SUB1, status, "r"))

    assert client.get(f"/submissions/{SUB1}").json()["score"] is not None


@pytest.mark.parametrize("status", ["pending", "flagged", "error"])
def test_unreviewed_status_hides_score(app_and_client, status):
    fake, client = app_and_client
    fake.db["submissions"].append(_secret_row(SUB1, status, "r"))

    assert client.get(f"/submissions/{SUB1}").json()["score"] is None
    rows = client.get("/submissions/").json()
    assert rows[0]["score"] is None


def test_post_submission_insert_failure_returns_generic_detail(app_and_client, monkeypatch):
    from postgrest.exceptions import APIError

    from routes import submissions as submissions_routes

    fake, client = app_and_client

    class _FailingInsert(_TableQuery):
        def execute(self):
            if self._insert_payloads:
                raise APIError(
                    {"message": 'insert into "submissions" violates fk secret_constraint_xyz'}
                )
            return super().execute()

    monkeypatch.setattr(fake, "table", lambda name: _FailingInsert(fake.db, name))
    monkeypatch.setattr(submissions_routes, "get_supabase", lambda: fake)

    resp = client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "text_answer": "hi"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid submission payload"
    assert "secret_constraint_xyz" not in resp.text


def _post_photo(client, data, content_type, filename="x.png"):
    return client.post(
        "/submissions/",
        data={"task_id": TASK_ID, "text_answer": ""},
        files={"photo": (filename, data, content_type)},
    )


def test_post_submission_normalizes_jpg_content_type(app_and_client):
    fake, client = app_and_client
    resp = _post_photo(client, b"jpgbytes", "image/jpg", filename="a.jpg")
    assert resp.status_code == 200
    path, _, options = fake.upload_calls[0]
    assert path.endswith(".jpg")
    assert options == {"content-type": "image/jpeg"}
    assert "upsert" not in options


@pytest.mark.parametrize(
    "content_type", ["image/png", "image/webp", "image/heic", "image/heif", "IMAGE/JPEG"]
)
def test_post_submission_accepts_allowed_types(app_and_client, content_type):
    fake, client = app_and_client
    resp = _post_photo(client, b"bytes", content_type)
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"
    assert len(fake.upload_calls) == 1


def test_post_submission_disallowed_type_is_415_with_no_row_or_upload(app_and_client):
    fake, client = app_and_client
    resp = _post_photo(client, b"GIF89a", "image/gif", filename="x.gif")
    assert resp.status_code == 415
    assert isinstance(resp.json()["detail"], str)
    assert fake.upload_calls == []
    assert fake.db["submissions"] == []


def test_post_submission_oversized_is_413_with_no_row_or_upload(app_and_client):
    from services.uploads import MAX_UPLOAD_BYTES

    fake, client = app_and_client
    resp = _post_photo(client, b"a" * (MAX_UPLOAD_BYTES + 1), "image/png")
    assert resp.status_code == 413
    assert isinstance(resp.json()["detail"], str)
    assert fake.upload_calls == []
    assert fake.db["submissions"] == []


def test_resubmit_allowed_after_error_row_but_not_after_pending(app_and_client):
    fake, client = app_and_client
    # Single-submission task.
    fake.db["tasks"][0]["allow_multiple_submissions"] = False
    fake.db["tasks"][0]["type"] = "photo"

    fake.fail_upload = True
    first = _post_photo(client, b"bytes", "image/png")
    assert first.json()["status"] == "error"
    assert [r["status"] for r in fake.db["submissions"]] == ["error"]

    fake.fail_upload = False
    second = _post_photo(client, b"bytes", "image/png")
    assert second.status_code == 200
    assert second.json()["status"] == "pending"
    assert len(fake.upload_calls) == 1

    # A non-error row still blocks further submissions.
    third = _post_photo(client, b"bytes", "image/png")
    assert third.status_code == 200
    body = third.json()
    assert "only allows one submission" in body["error"]
    assert body["existing_submission_id"] == second.json()["submission_id"]


# --- Review round (manager) ---------------------------------------------------


def test_list_submissions_non_uuid_task_id_is_400(app_and_client):
    _fake, client = app_and_client
    resp = client.get("/submissions/?task_id=not-a-uuid")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "task_id must be a UUID"


def test_list_submissions_task_id_is_canonicalized(app_and_client):
    fake, client = app_and_client
    fake.db["submissions"].append(_row(sub_id=SUB1))
    rows = client.get(f"/submissions/?task_id={TASK_ID.upper()}").json()
    assert [r["id"] for r in rows] == [SUB1]


def test_get_submission_signing_failure_logs_the_id_only(app_and_client, monkeypatch, caplog):
    fake, client = app_and_client
    path = f"{TEAM_ID}/{TASK_ID}/{SUB1}.png"
    fake.db["submissions"].append(_row(photo_url=path))

    def boom(self, p, expires_in):
        raise RuntimeError("storage-secret-detail")

    monkeypatch.setattr(_StorageBucket, "create_signed_url", boom)
    with caplog.at_level("WARNING", logger="routes.submissions"):
        resp = client.get(f"/submissions/{SUB1}")
    assert resp.status_code == 200
    assert "photo_signed_url" not in resp.json()
    assert SUB1 in caplog.text
    assert path not in caplog.text
    assert "storage-secret-detail" not in caplog.text
