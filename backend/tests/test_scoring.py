import pytest

from services import scoring


def test_threshold_default_is_one(monkeypatch):
    monkeypatch.delenv("AUTO_APPROVE_CONFIDENCE_THRESHOLD", raising=False)
    assert scoring._auto_approve_threshold() == 1.0


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("0.9", 0.9),
        ("0.95", 0.95),
        ("1.0", 1.0),
        ("0.1", 0.9),  # clamp low
        ("2.0", 1.0),  # clamp high
        ("not-a-number", 1.0),  # fallback
    ],
)
def test_threshold_clamped(monkeypatch, raw, expected):
    monkeypatch.setenv("AUTO_APPROVE_CONFIDENCE_THRESHOLD", raw)
    assert scoring._auto_approve_threshold() == expected


def test_max_score_threshold_default(monkeypatch):
    monkeypatch.delenv("AUTO_APPROVE_MAX_SCORE_CONFIDENCE_THRESHOLD", raising=False)
    assert scoring._auto_approve_max_score_threshold() == 0.95


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("0.8", 0.8),
        ("0.9", 0.9),
        ("1.0", 1.0),
        ("0.1", 0.8),  # clamp low
        ("2.0", 1.0),  # clamp high
        ("not-a-number", 0.95),  # fallback
    ],
)
def test_max_score_threshold_clamped(monkeypatch, raw, expected):
    monkeypatch.setenv("AUTO_APPROVE_MAX_SCORE_CONFIDENCE_THRESHOLD", raw)
    assert scoring._auto_approve_max_score_threshold() == expected


def test_parse_score_json_valid():
    res = scoring._parse_score_json('{"score": 3, "confidence": 0.92, "rationale": "ok"}', max_points=5)
    assert res.score == 3
    assert res.confidence == 0.92
    assert res.rationale == "ok"


@pytest.mark.parametrize(
    "text",
    [
        "not json",
        "[]",
        "{}",
        '{"score": 1, "confidence": 0.5}',  # missing rationale
        '{"score": -1, "confidence": 0.5, "rationale": "x"}',
        '{"score": 999, "confidence": 0.5, "rationale": "x"}',
        '{"score": 1, "confidence": 2.0, "rationale": "x"}',
        '{"score": 1, "confidence": -0.1, "rationale": "x"}',
        '{"score": 1, "confidence": 0.5, "rationale": ""}',
    ],
)
def test_parse_score_json_invalid(text):
    with pytest.raises(Exception):
        scoring._parse_score_json(text, max_points=5)


def test_cosine_similarity_happy_path():
    assert scoring._cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert scoring._cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_cosine_similarity_mismatched_lengths_is_neg_inf():
    assert scoring._cosine_similarity([1.0], [1.0, 2.0]) == float("-inf")


def test_cosine_similarity_empty_is_neg_inf():
    assert scoring._cosine_similarity([], []) == float("-inf")


def test_cosine_similarity_zero_norm_is_neg_inf():
    assert scoring._cosine_similarity([0.0, 0.0], [1.0, 0.0]) == float("-inf")


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self.filters = []
        self._single = False
        self._select = None

    def select(self, cols="*"):
        self._select = cols
        return self

    def eq(self, k, v):
        self.filters.append((k, v))
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        # Only supports the lookups needed for idempotency test.
        if self.name == "submissions" and self._select == "status":
            sid = dict(self.filters).get("id")
            return _FakeResp({"status": self.db["submissions"][sid]["status"]})
        raise AssertionError("Unexpected query in fake table")


class _FakeSupabase:
    def __init__(self, status):
        self.db = {"submissions": {"sub1": {"status": status}}}

    def table(self, name):
        return _FakeTable(self.db, name)


@pytest.mark.asyncio
async def test_score_submission_idempotent(monkeypatch):
    # If a submission is already in a terminal state, score_submission should no-op early (unless forced).
    fake = _FakeSupabase(status="approved")
    monkeypatch.setattr(scoring, "get_supabase", lambda: fake)

    # If it doesn't early return, it will try to build clients and/or query tasks and the fake will explode.
    await scoring.score_submission("sub1", "task1", "team1", "hello", None)


# ---------------------------------------------------------------------------
# Failure stages must not leak exception text or storage paths into the row.
# ---------------------------------------------------------------------------

SENTINEL = "SENTINEL-secret-error-text"
PHOTO_PATH = "team1/task1/SENTINEL-photo-path.jpg"


class _Query:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self.filters = []
        self._op = "select"
        self._cols = None
        self._payload = None

    def select(self, cols="*"):
        self._cols = cols
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def eq(self, k, v):
        self.filters.append((k, v))
        return self

    def single(self):
        return self

    def execute(self):
        if self._op in ("update", "insert"):
            self.db["writes"].append((self.name, self._op, self._payload))
            return _FakeResp(None)
        if self.name == "submissions":
            return _FakeResp({"status": "pending", "score": None})
        if self.name == "tasks":
            return _FakeResp({"max_points": 5, "title": "t", "description": "d"})
        return _FakeResp([])


class _FakeStorage:
    def __init__(self, exc=None):
        self.exc = exc

    def from_(self, bucket):
        return self

    def download(self, path):
        if self.exc:
            raise self.exc
        return b"fake-bytes"


class _RecordingSupabase:
    def __init__(self, download_exc=None):
        self.db = {"writes": []}
        self.storage = _FakeStorage(download_exc)

    def table(self, name):
        return _Query(self.db, name)

    def submission_updates(self):
        return [w[2] for w in self.db["writes"] if w[0] == "submissions" and w[1] == "update"]


class _Boom:
    """Callable stand-in for an SDK method that raises the sentinel."""

    def __call__(self, *a, **kw):
        raise RuntimeError(SENTINEL)


class _FakeOpenAI:
    def __init__(self, describe_exc=False, embed_exc=False):
        create_desc = _Boom() if describe_exc else (
            lambda **kw: type(
                "R", (), {"choices": [type("C", (), {"message": type("M", (), {"content": "a cat"})()})()]}
            )()
        )
        create_emb = _Boom() if embed_exc else (
            lambda **kw: type("R", (), {"data": [type("D", (), {"embedding": [0.1, 0.2]})()]})()
        )
        self.chat = type("Chat", (), {"completions": type("Comp", (), {"create": staticmethod(create_desc)})()})()
        self.embeddings = type("Emb", (), {"create": staticmethod(create_emb)})()


class _FakeAnthropic:
    def __init__(self, text="not json", exc=False):
        def create(**kw):
            if exc:
                raise RuntimeError(SENTINEL)
            return type("Msg", (), {"content": [type("B", (), {"text": text})()]})()

        self.messages = type("Msgs", (), {"create": staticmethod(create)})()


def _patch(monkeypatch, supa, openai_client=None, anthropic_client=None):
    monkeypatch.setattr(scoring, "get_supabase", lambda: supa)
    monkeypatch.setattr(scoring, "_get_openai_client", lambda: openai_client or _FakeOpenAI())
    monkeypatch.setattr(scoring, "_get_anthropic_client", lambda: anthropic_client or _FakeAnthropic())


def _assert_no_leak(updates, expected_mode, expected_status):
    assert len(updates) == 1
    row = updates[0]
    assert row["status"] == expected_status
    assert row["ai_result"]["mode"] == expected_mode
    assert row["rationale"].strip()
    assert row["ai_result"]["error"].strip()
    dumped = repr(row)
    assert SENTINEL not in dumped
    assert "SENTINEL" not in dumped
    assert PHOTO_PATH not in dumped
    assert "photo_path" not in dumped


@pytest.mark.asyncio
async def test_storage_download_failure_is_sanitized(monkeypatch, caplog):
    supa = _RecordingSupabase(download_exc=RuntimeError(f"{SENTINEL} {PHOTO_PATH}"))
    _patch(monkeypatch, supa)
    with caplog.at_level("ERROR"):
        await scoring.score_submission("sub1", "task1", "team1", None, PHOTO_PATH)
    _assert_no_leak(supa.submission_updates(), "storage_download", "error")
    assert any(r.exc_info and SENTINEL in str(r.exc_info[1]) for r in caplog.records)


@pytest.mark.asyncio
async def test_image_description_failure_is_sanitized(monkeypatch):
    supa = _RecordingSupabase()
    _patch(monkeypatch, supa, openai_client=_FakeOpenAI(describe_exc=True))
    await scoring.score_submission("sub1", "task1", "team1", None, PHOTO_PATH)
    _assert_no_leak(supa.submission_updates(), "gpt4o_describe", "error")


@pytest.mark.asyncio
async def test_embedding_failure_is_sanitized(monkeypatch):
    supa = _RecordingSupabase()
    _patch(monkeypatch, supa, openai_client=_FakeOpenAI(embed_exc=True))
    await scoring.score_submission("sub1", "task1", "team1", "some answer", None)
    _assert_no_leak(supa.submission_updates(), "embed_submission", "error")


@pytest.mark.asyncio
async def test_invalid_json_is_sanitized(monkeypatch):
    supa = _RecordingSupabase()
    _patch(monkeypatch, supa, anthropic_client=_FakeAnthropic(text="definitely not json"))

    def _bad_parse(text, *, max_points):
        raise ValueError(f"{SENTINEL} {PHOTO_PATH}")

    monkeypatch.setattr(scoring, "_parse_score_json", _bad_parse)
    await scoring.score_submission("sub1", "task1", "team1", "some answer", None)
    updates = supa.submission_updates()
    _assert_no_leak(updates, "invalid_json", "flagged")
    # Behaviour preserved: still flagged with no score.
    assert updates[0]["score"] is None


@pytest.mark.asyncio
async def test_generic_exception_is_sanitized(monkeypatch, caplog):
    supa = _RecordingSupabase()
    _patch(monkeypatch, supa, anthropic_client=_FakeAnthropic(exc=True))
    with caplog.at_level("ERROR"):
        await scoring.score_submission("sub1", "task1", "team1", "some answer", None)
    _assert_no_leak(supa.submission_updates(), "exception", "error")
    assert any(r.exc_info and SENTINEL in str(r.exc_info[1]) for r in caplog.records)


@pytest.mark.asyncio
async def test_invalid_json_with_real_parser_is_sanitized(monkeypatch, caplog):
    supa = _RecordingSupabase()
    _patch(monkeypatch, supa, anthropic_client=_FakeAnthropic(text="definitely not json"))
    with caplog.at_level("ERROR"):
        await scoring.score_submission("sub1", "task1", "team1", "some answer", None)
    updates = supa.submission_updates()
    _assert_no_leak(updates, "invalid_json", "flagged")
    assert updates[0]["score"] is None
    assert updates[0]["confidence"] is None
    assert updates[0]["rationale"] == "Scoring output was invalid"
    assert updates[0]["ai_result"]["error"] == "Scoring output was invalid"
    # The real exception is logged, not stored.
    assert any(r.exc_info for r in caplog.records)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "stage",
    ["storage_download", "gpt4o_describe", "embed_submission", "exception"],
)
async def test_failure_stage_logs_exception_and_prints_nothing(monkeypatch, caplog, capsys, stage):
    if stage == "storage_download":
        supa = _RecordingSupabase(download_exc=RuntimeError(SENTINEL))
        _patch(monkeypatch, supa)
        args = (None, PHOTO_PATH)
    elif stage == "gpt4o_describe":
        supa = _RecordingSupabase()
        _patch(monkeypatch, supa, openai_client=_FakeOpenAI(describe_exc=True))
        args = (None, PHOTO_PATH)
    elif stage == "embed_submission":
        supa = _RecordingSupabase()
        _patch(monkeypatch, supa, openai_client=_FakeOpenAI(embed_exc=True))
        args = ("some answer", None)
    else:
        supa = _RecordingSupabase()
        _patch(monkeypatch, supa, anthropic_client=_FakeAnthropic(exc=True))
        args = ("some answer", None)

    with caplog.at_level("ERROR"):
        await scoring.score_submission("sub1", "task1", "team1", *args)

    # Real exception goes to logging with traceback.
    assert any(
        r.levelname == "ERROR" and r.exc_info and SENTINEL in str(r.exc_info[1])
        for r in caplog.records
    )
    # Nothing is printed to stdout/stderr.
    captured = capsys.readouterr()
    assert SENTINEL not in captured.out
    assert "Scoring error" not in captured.out


@pytest.mark.asyncio
async def test_failure_recording_error_is_logged_not_raised(monkeypatch, caplog):
    """If writing the error row itself fails, scoring logs it and does not raise."""
    supa = _RecordingSupabase()
    _patch(monkeypatch, supa, anthropic_client=_FakeAnthropic(exc=True))

    def _boom(*a, **kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(scoring, "_mark_submission_error", _boom)
    with caplog.at_level("ERROR"):
        await scoring.score_submission("sub1", "task1", "team1", "some answer", None)
    assert any("Failed to record scoring error" in r.getMessage() for r in caplog.records)
    assert supa.submission_updates() == []
