import base64
import hashlib
import hmac
import logging
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from auth import organizer as organizer_auth
from auth import team as team_auth
from auth.team import (
    NOT_CONFIGURED_DETAIL,
    TEAM_TOKEN_TTL_SECONDS,
    TOKEN_INVALID_DETAIL,
    format_expiry,
    issue_team_token,
    require_team,
    verify_team_token,
)

SECRET = "t" * 40
TEAM_ID = "8f14e45f-ceea-4e7a-9a1b-0c5f7a3d2b11"
OTHER_TEAM_ID = "11111111-2222-4333-8444-555555555555"
ENV_EXAMPLE = Path(__file__).resolve().parents[1] / ".env.example"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("TEAM_SESSION_SECRET", SECRET)
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "organizer-code-123")


@pytest.fixture()
def client():
    app = FastAPI()

    @app.get("/guarded")
    def guarded(request: Request, team_id: str = Depends(require_team)):
        return {"team_id": team_id, "state": request.state.team_id}

    return TestClient(app)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _forge(payload: str, secret: str = SECRET) -> str:
    """A token signed with the team key scheme, for arbitrary payloads."""
    payload_b64 = _b64(payload.encode("ascii"))
    sig = team_auth._sign(secret, payload_b64)
    return f"{payload_b64}.{_b64(sig)}"


# --- Issue and verify ------------------------------------------------------


def test_round_trip(monkeypatch):
    monkeypatch.setattr(team_auth, "_wall_now", lambda: 1_000_000.0)
    token, expires_at = issue_team_token(TEAM_ID)
    assert expires_at == 1_000_000 + TEAM_TOKEN_TTL_SECONDS
    assert TEAM_TOKEN_TTL_SECONDS == 7 * 24 * 60 * 60
    assert verify_team_token(token) == (TEAM_ID, expires_at)


def test_token_shape_is_payload_dot_signature():
    token, expires_at = issue_team_token(TEAM_ID)
    payload_b64, signature_b64 = token.split(".")
    padded = payload_b64 + "=" * (-len(payload_b64) % 4)
    team_id, expiry, nonce = base64.urlsafe_b64decode(padded).decode().split(":")
    assert team_id == TEAM_ID
    assert int(expiry) == expires_at
    assert nonce
    assert "=" not in token


def test_tokens_are_unique_per_issue():
    assert issue_team_token(TEAM_ID)[0] != issue_team_token(TEAM_ID)[0]


def test_uppercase_team_id_is_normalized():
    token, expires_at = issue_team_token(TEAM_ID.upper())
    assert verify_team_token(token) == (TEAM_ID, expires_at)


@pytest.mark.parametrize(
    "form",
    [
        TEAM_ID.replace("-", ""),
        TEAM_ID.replace("-", "").upper(),
        "{" + TEAM_ID + "}",
        "urn:uuid:" + TEAM_ID,
    ],
)
def test_non_canonical_uuid_forms_round_trip_to_lowercase_hyphenated(form):
    token, expires_at = issue_team_token(form)
    assert verify_team_token(token) == (TEAM_ID, expires_at)
    padded = token.split(".")[0] + "="
    payload = base64.urlsafe_b64decode(padded + "=" * (-len(padded) % 4)).decode()
    assert payload.split(":")[0] == TEAM_ID


def test_signed_payload_with_non_canonical_uuid_verifies_as_canonical():
    assert verify_team_token(_forge(f"{TEAM_ID.upper()}:9999999999:abcd")) == (
        TEAM_ID,
        9999999999,
    )
    assert verify_team_token(_forge(f"{TEAM_ID.replace('-', '')}:9999999999:abcd")) == (
        TEAM_ID,
        9999999999,
    )


def test_issue_rejects_non_uuid_team_id():
    with pytest.raises(ValueError):
        issue_team_token("not-a-uuid")


@pytest.mark.parametrize("bad", ["", "   ", "1234", TEAM_ID[:-1], TEAM_ID + "0", None, 123])
def test_issue_rejects_invalid_team_ids(bad):
    with pytest.raises(ValueError):
        issue_team_token(bad)  # type: ignore[arg-type]


def test_issue_checks_team_id_before_secret(monkeypatch):
    monkeypatch.delenv("TEAM_SESSION_SECRET")
    with pytest.raises(ValueError):
        issue_team_token("not-a-uuid")


@pytest.mark.parametrize("mode", ["unset", "empty", "blank"])
def test_issue_raises_runtime_error_without_a_secret(monkeypatch, mode):
    if mode == "unset":
        monkeypatch.delenv("TEAM_SESSION_SECRET")
    else:
        monkeypatch.setenv("TEAM_SESSION_SECRET", "" if mode == "empty" else "  ")
    with pytest.raises(RuntimeError):
        issue_team_token(TEAM_ID)


def test_issue_requires_a_secret(monkeypatch):
    monkeypatch.setenv("TEAM_SESSION_SECRET", "  ")
    with pytest.raises(RuntimeError):
        issue_team_token(TEAM_ID)


def test_format_expiry_is_iso_utc():
    assert format_expiry(0) == "1970-01-01T00:00:00Z"
    assert format_expiry is organizer_auth.format_expiry


def test_tampered_payload_is_rejected():
    token, _ = issue_team_token(TEAM_ID)
    _, signature_b64 = token.split(".")
    forged_payload = _b64(f"{OTHER_TEAM_ID}:9999999999:abcd".encode())
    assert verify_team_token(f"{forged_payload}.{signature_b64}") is None


def test_tampered_signature_is_rejected():
    token, _ = issue_team_token(TEAM_ID)
    payload_b64, signature_b64 = token.split(".")
    flipped = ("A" if signature_b64[0] != "A" else "B") + signature_b64[1:]
    assert verify_team_token(f"{payload_b64}.{flipped}") is None


def test_expired_token_is_rejected(monkeypatch):
    now = [1_000_000.0]
    monkeypatch.setattr(team_auth, "_wall_now", lambda: now[0])
    token, expires_at = issue_team_token(TEAM_ID)
    now[0] = expires_at - 1
    assert verify_team_token(token) is not None
    now[0] = expires_at
    assert verify_team_token(token) is None


def test_token_valid_until_the_expiry_second_with_fractional_clock(monkeypatch):
    monkeypatch.setattr(team_auth, "_wall_now", lambda: 1_000_000.0)
    token, expires_at = issue_team_token(TEAM_ID)
    monkeypatch.setattr(team_auth, "_wall_now", lambda: expires_at - 0.5)
    assert verify_team_token(token) == (TEAM_ID, expires_at)
    monkeypatch.setattr(team_auth, "_wall_now", lambda: expires_at + 0.0)
    assert verify_team_token(token) is None
    monkeypatch.setattr(team_auth, "_wall_now", lambda: expires_at + 86_400.0)
    assert verify_team_token(token) is None


def test_validly_signed_but_expired_payload_is_rejected():
    assert verify_team_token(_forge(f"{TEAM_ID}:1:abcd")) is None
    assert verify_team_token(_forge(f"{TEAM_ID}:-5:abcd")) is None


def test_whitespace_around_a_token_is_not_accepted_by_verify():
    token, _ = issue_team_token(TEAM_ID)
    assert verify_team_token(f" {token}") is None
    assert verify_team_token(f"{token}\n") is None


def test_wrong_secret_is_rejected(monkeypatch):
    token, _ = issue_team_token(TEAM_ID)
    monkeypatch.setenv("TEAM_SESSION_SECRET", "x" * 40)
    assert verify_team_token(token) is None


def test_secret_changed_then_restored_verifies_again(monkeypatch):
    token, expires_at = issue_team_token(TEAM_ID)
    monkeypatch.setenv("TEAM_SESSION_SECRET", "x" * 40)
    assert verify_team_token(token) is None
    monkeypatch.setenv("TEAM_SESSION_SECRET", SECRET)
    assert verify_team_token(token) == (TEAM_ID, expires_at)


def test_token_issued_under_another_secret_verifies_only_under_it(monkeypatch):
    other = "x" * 40
    monkeypatch.setenv("TEAM_SESSION_SECRET", other)
    token, expires_at = issue_team_token(TEAM_ID)
    assert verify_team_token(token) == (TEAM_ID, expires_at)
    monkeypatch.setenv("TEAM_SESSION_SECRET", SECRET)
    assert verify_team_token(token) is None


def test_unset_secret_never_verifies(monkeypatch):
    token, _ = issue_team_token(TEAM_ID)
    monkeypatch.delenv("TEAM_SESSION_SECRET")
    assert verify_team_token(token) is None


def test_non_uuid_team_id_in_signed_payload_is_rejected():
    assert verify_team_token(_forge("not-a-uuid:9999999999:abcd")) is None
    assert verify_team_token(_forge(":9999999999:abcd")) is None


def test_wrong_field_count_or_expiry_is_rejected():
    assert verify_team_token(_forge(f"{TEAM_ID}:9999999999")) is None
    assert verify_team_token(_forge(f"{TEAM_ID}:9999999999:a:b")) is None
    assert verify_team_token(_forge(f"{TEAM_ID}:soon:abcd")) is None
    # Sanity: the same forging helper with valid fields does verify.
    assert verify_team_token(_forge(f"{TEAM_ID}:9999999999:abcd")) == (TEAM_ID, 9999999999)


@pytest.mark.parametrize(
    "token",
    [
        "",
        ".",
        "abc",
        "a.b.c",
        "!!!.!!!",
        "é.é",
        "a" * 600 + "." + "b" * 10,
        "====.====",
        "\x00.\x00",
    ],
)
def test_garbage_tokens_never_raise(token):
    assert verify_team_token(token) is None


def test_non_ascii_or_extra_colon_payload_is_rejected():
    payload_b64 = _b64("é:9999999999:abcd".encode())
    token = f"{payload_b64}.{_b64(team_auth._sign(SECRET, payload_b64))}"
    assert verify_team_token(token) is None
    assert verify_team_token(_forge(f"{TEAM_ID}:9999999999:abcd:")) is None
    assert verify_team_token(_forge(f"{TEAM_ID}::9999999999:abcd")) is None
    assert verify_team_token(_forge(f"{TEAM_ID}:9999999999:abcd:extra:more")) is None


def test_token_at_the_length_cap_boundary():
    token = _forge(f"{TEAM_ID}:9999999999:" + "a" * 200)
    assert len(token) <= 512
    assert verify_team_token(token) == (TEAM_ID, 9999999999)
    over = _forge(f"{TEAM_ID}:9999999999:" + "a" * 400)
    assert len(over) > 512
    assert verify_team_token(over) is None


def test_overlong_token_is_rejected():
    token = _forge(f"{TEAM_ID}:9999999999:" + "a" * 600)
    assert len(token) > 512
    assert verify_team_token(token) is None


def test_non_string_token_never_raises():
    assert verify_team_token(None) is None  # type: ignore[arg-type]
    assert verify_team_token(123) is None  # type: ignore[arg-type]


# --- Separation from organizer tokens --------------------------------------


def test_organizer_token_is_not_a_team_token():
    token, _ = organizer_auth.issue_session_token("organizer-code-123")
    assert verify_team_token(token) is None


def test_organizer_token_signed_with_same_secret_is_not_a_team_token():
    token, _ = organizer_auth.issue_session_token(SECRET)
    assert verify_team_token(token) is None


def test_team_token_is_not_an_organizer_token():
    token, _ = issue_team_token(TEAM_ID)
    assert organizer_auth.verify_session_token(token, "organizer-code-123") is None
    assert organizer_auth.verify_session_token(token, SECRET) is None


def test_team_key_differs_from_organizer_key():
    assert team_auth._derive_key(SECRET) != organizer_auth._derive_key(SECRET)
    expected = hmac.new(b"sapsut-team-session-v1", SECRET.encode(), hashlib.sha256).digest()
    assert team_auth._derive_key(SECRET) == expected


# --- require_team ----------------------------------------------------------


def test_guard_accepts_a_valid_token_and_sets_state(client):
    token, _ = issue_team_token(TEAM_ID)
    resp = client.get("/guarded", headers={"X-Team-Token": token})
    assert resp.status_code == 200
    assert resp.json() == {"team_id": TEAM_ID, "state": TEAM_ID}


def test_guard_rejects_missing_header(client):
    resp = client.get("/guarded")
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}
    assert TOKEN_INVALID_DETAIL == "Invalid or missing team token."


@pytest.mark.parametrize("value", ["", "   "])
def test_guard_rejects_blank_header(client, value):
    resp = client.get("/guarded", headers={"X-Team-Token": value})
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}


@pytest.mark.parametrize("value", ["garbage", "a.b", "Bearer abc"])
def test_guard_rejects_garbage_header(client, value):
    resp = client.get("/guarded", headers={"X-Team-Token": value})
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}


def test_guard_trims_whitespace_around_a_valid_header_value(client):
    token, _ = issue_team_token(TEAM_ID)
    resp = client.get("/guarded", headers={"X-Team-Token": f"  {token}  "})
    assert resp.status_code == 200
    assert resp.json()["team_id"] == TEAM_ID


def test_guard_rejects_whitespace_inside_the_token(client):
    token, _ = issue_team_token(TEAM_ID)
    resp = client.get("/guarded", headers={"X-Team-Token": token[:10] + " " + token[10:]})
    assert resp.status_code == 401


def test_guard_rejects_token_exactly_at_expiry_second(client, monkeypatch):
    token, expires_at = issue_team_token(TEAM_ID)
    monkeypatch.setattr(team_auth, "_wall_now", lambda: expires_at - 1.0)
    assert client.get("/guarded", headers={"X-Team-Token": token}).status_code == 200
    monkeypatch.setattr(team_auth, "_wall_now", lambda: float(expires_at))
    resp = client.get("/guarded", headers={"X-Team-Token": token})
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}


def test_guard_returns_canonical_id_for_non_canonical_issue(client):
    token, _ = issue_team_token(TEAM_ID.replace("-", "").upper())
    resp = client.get("/guarded", headers={"X-Team-Token": token})
    assert resp.json() == {"team_id": TEAM_ID, "state": TEAM_ID}


def test_guard_rejects_tampered_and_expired(client, monkeypatch):
    token, expires_at = issue_team_token(TEAM_ID)
    payload_b64, signature_b64 = token.split(".")
    forged = _b64(f"{OTHER_TEAM_ID}:{expires_at}:abcd".encode())
    resp = client.get("/guarded", headers={"X-Team-Token": f"{forged}.{signature_b64}"})
    assert resp.status_code == 401

    monkeypatch.setattr(team_auth, "_wall_now", lambda: float(expires_at))
    resp = client.get("/guarded", headers={"X-Team-Token": token})
    assert resp.status_code == 401


def test_guard_rejects_organizer_token_and_bearer(client):
    token, _ = organizer_auth.issue_session_token("organizer-code-123")
    assert client.get("/guarded", headers={"X-Team-Token": token}).status_code == 401
    team_token, _ = issue_team_token(TEAM_ID)
    resp = client.get("/guarded", headers={"Authorization": f"Bearer {team_token}"})
    assert resp.status_code == 401


def test_guard_rejects_token_after_secret_rotation(client, monkeypatch):
    token, _ = issue_team_token(TEAM_ID)
    monkeypatch.setenv("TEAM_SESSION_SECRET", "rotated-" + "z" * 32)
    resp = client.get("/guarded", headers={"X-Team-Token": token})
    assert resp.status_code == 401


@pytest.mark.parametrize("mode", ["unset", "empty", "blank"])
def test_guard_returns_500_when_not_configured(client, monkeypatch, caplog, mode):
    token, _ = issue_team_token(TEAM_ID)
    if mode == "unset":
        monkeypatch.delenv("TEAM_SESSION_SECRET")
    else:
        monkeypatch.setenv("TEAM_SESSION_SECRET", "" if mode == "empty" else "   ")
    with caplog.at_level(logging.ERROR, logger="auth.team"):
        resp = client.get("/guarded", headers={"X-Team-Token": token})
    assert resp.status_code == 500
    assert resp.json() == {"detail": NOT_CONFIGURED_DETAIL}
    assert NOT_CONFIGURED_DETAIL == "Team access is not configured."
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert errors
    assert all(token not in r.getMessage() for r in errors)


def test_not_configured_is_reported_even_without_a_token(client, monkeypatch):
    monkeypatch.delenv("TEAM_SESSION_SECRET")
    assert client.get("/guarded").status_code == 500


def test_guard_never_logs_the_token(client, caplog):
    with caplog.at_level(logging.DEBUG):
        client.get("/guarded", headers={"X-Team-Token": "super-secret-garbage"})
    assert "super-secret-garbage" not in caplog.text


# --- .env.example ----------------------------------------------------------


def test_env_example_documents_the_team_secret():
    lines = ENV_EXAMPLE.read_text().splitlines()
    assert "TEAM_SESSION_SECRET=" in lines
    idx = lines.index("TEAM_SESSION_SECRET=")
    comment = []
    for line in reversed(lines[:idx]):
        if not line.startswith("#"):
            break
        comment.append(line)
    assert comment, "TEAM_SESSION_SECRET needs a comment"
    assert "32+" in " ".join(comment)


# --- Secret strength -------------------------------------------------------


@pytest.mark.parametrize("length", [1, 8, team_auth.MIN_SECRET_LENGTH - 1])
def test_short_secret_counts_as_unconfigured(monkeypatch, client, length):
    monkeypatch.setenv("TEAM_SESSION_SECRET", "s" * length)
    assert team_auth.is_configured() is False
    with pytest.raises(RuntimeError):
        issue_team_token(TEAM_ID)
    resp = client.get("/guarded", headers={"X-Team-Token": "anything"})
    assert resp.status_code == 500
    assert resp.json()["detail"] == NOT_CONFIGURED_DETAIL


def test_secret_at_minimum_length_is_accepted(monkeypatch):
    monkeypatch.setenv("TEAM_SESSION_SECRET", "s" * team_auth.MIN_SECRET_LENGTH)
    assert team_auth.is_configured() is True
    token, expires_at = issue_team_token(TEAM_ID)
    assert verify_team_token(token) == (TEAM_ID, expires_at)


def test_secret_equal_to_organizer_code_counts_as_unconfigured(monkeypatch):
    shared = "o" * 40
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", shared)
    monkeypatch.setenv("TEAM_SESSION_SECRET", f"  {shared} ")
    assert team_auth.is_configured() is False
    with pytest.raises(RuntimeError):
        issue_team_token(TEAM_ID)


def test_token_stops_verifying_when_secret_becomes_too_short(monkeypatch):
    token, _ = issue_team_token(TEAM_ID)
    monkeypatch.setenv("TEAM_SESSION_SECRET", SECRET[: team_auth.MIN_SECRET_LENGTH - 1])
    assert verify_team_token(token) is None


def test_canonical_team_id_is_public():
    assert team_auth.canonical_team_id(TEAM_ID.upper()) == TEAM_ID
    assert team_auth.canonical_team_id("nope") is None
