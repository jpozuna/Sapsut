import os

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
    # If a submission is already approved/flagged/rejected, score_submission should no-op early.
    fake = _FakeSupabase(status="approved")
    monkeypatch.setattr(scoring, "get_supabase", lambda: fake)

    # If it doesn't early return, it will try to build clients and/or query tasks and the fake will explode.
    await scoring.score_submission("sub1", "task1", "team1", "hello", None)

