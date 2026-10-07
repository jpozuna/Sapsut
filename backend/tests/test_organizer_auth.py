import base64
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from auth import organizer as organizer_auth
from auth.organizer import (
    CODE_REQUIRED_DETAIL,
    MAX_FAILURES,
    NOT_CONFIGURED_DETAIL,
    RATE_LIMITED_DETAIL,
    TOKEN_INVALID_DETAIL,
    TOKEN_TTL_SECONDS,
    WINDOW_SECONDS,
    require_organizer,
    reset_rate_limit,
)

CODE = "secret"
GOOD = {"X-Organizer-Code": CODE}
BAD = {"X-Organizer-Code": "nope"}

# Non-GET routes intentionally open to participants.
PUBLIC_NON_GET = {("POST", "/submissions/"), ("POST", "/teams/")}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Non-APIRoute routes FastAPI registers itself (docs and schema); anything else is suspect.
NON_API_ALLOWLIST = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
ENV_EXAMPLE = Path(__file__).resolve().parents[1] / ".env.example"


@pytest.fixture(autouse=True)
def _env_and_reset(monkeypatch):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", CODE)
    reset_rate_limit()
    yield
    reset_rate_limit()


@pytest.fixture()
def real_app():
    import main

    return main.app


@pytest.fixture()
def client(real_app):
    return TestClient(real_app)


def _api_routes(app):
    return [r for r in app.routes if isinstance(r, APIRoute)]


def _has_guard(dependant) -> bool:
    for dep in dependant.dependencies:
        if dep.call is require_organizer or _has_guard(dep):
            return True
    return False


def _non_api_route_violations(app):
    return [
        (type(r).__name__, getattr(r, "path", None))
        for r in app.routes
        if not isinstance(r, APIRoute) and getattr(r, "path", None) not in NON_API_ALLOWLIST
    ]


def _mint(client, code=CODE):
    resp = client.post("/organizer/session", headers={"X-Organizer-Code": code})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "x", path)


def _guarded_targets(app):
    targets = []
    for r in _api_routes(app):
        is_rescore = r.path == "/submissions/{id}/rescore"
        if r.path.startswith("/organizer") or is_rescore:
            for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
                targets.append((m, r.path))
    return targets


def test_guarded_targets_are_found(real_app):
    targets = _guarded_targets(real_app)
    assert ("GET", "/organizer/session") in targets
    assert ("POST", "/organizer/tasks") in targets
    assert ("POST", "/submissions/{id}/rescore") in targets
    assert len(targets) >= 10


def test_organizer_routes_reject_missing_and_wrong_code(real_app, client):
    for method, path in _guarded_targets(real_app):
        url = _concrete(path)
        for headers in ({}, BAD):
            reset_rate_limit()  # many requests from one IP; keep the limiter out of this test
            resp = client.request(method, url, headers=headers)
            assert resp.status_code == 401, (method, path, headers, resp.status_code)


def test_all_non_get_routes_are_guarded_or_allowlisted(real_app):
    unguarded = []
    seen_public = set()
    for r in _api_routes(real_app):
        for m in r.methods - SAFE_METHODS:
            if (m, r.path) in PUBLIC_NON_GET:
                seen_public.add((m, r.path))
                continue
            if not _has_guard(r.dependant):
                unguarded.append((m, r.path))
    assert unguarded == []
    assert seen_public == PUBLIC_NON_GET


def test_all_non_api_routes_are_allowlisted(real_app):
    assert _non_api_route_violations(real_app) == []


def test_non_api_route_guard_flags_unlisted_routes():
    # Sanity check: a mounted app or raw Starlette route outside the allowlist is flagged,
    # while the docs routes FastAPI adds on its own are not.
    from fastapi import FastAPI
    from starlette.responses import PlainTextResponse
    from starlette.routing import Mount, Route

    app = FastAPI()
    assert _non_api_route_violations(app) == []

    app.router.routes.append(Route("/sneaky", lambda request: PlainTextResponse("hi"), methods=["POST"]))
    app.router.routes.append(Mount("/mounted", app=FastAPI()))
    flagged = {path for _, path in _non_api_route_violations(app)}
    assert flagged == {"/sneaky", "/mounted"}


def test_post_tasks_root_not_registered(real_app):
    assert not any(
        r.path in ("/tasks", "/tasks/") and "POST" in r.methods for r in _api_routes(real_app)
    )
    assert any(r.path == "/tasks/" and "GET" in r.methods for r in _api_routes(real_app))


def test_session_ok_with_valid_code(client):
    resp = client.get("/organizer/session", headers=GOOD)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "expires_at": None}


def test_session_rejects_missing_and_wrong_code(client):
    assert client.get("/organizer/session").status_code == 401
    assert client.get("/organizer/session", headers=BAD).status_code == 401


def test_code_is_trimmed_and_compared_exactly(client):
    assert client.get("/organizer/session", headers={"X-Organizer-Code": " secret "}).status_code == 200
    assert client.get("/organizer/session", headers={"X-Organizer-Code": "secre"}).status_code == 401
    assert client.get("/organizer/session", headers={"X-Organizer-Code": "secrets"}).status_code == 401


def test_uses_constant_time_compare(monkeypatch, client):
    calls = []
    real = organizer_auth.secrets.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(organizer_auth.secrets, "compare_digest", spy)
    client.get("/organizer/session", headers=BAD)
    assert len(calls) == 1


def test_unconfigured_code_returns_500(monkeypatch, client):
    monkeypatch.delenv("ORGANIZER_DEMO_CODE", raising=False)
    resp = client.get("/organizer/session", headers=GOOD)
    assert resp.status_code == 500
    assert resp.json() == {"detail": "Organizer access is not configured."}
    assert resp.json()["detail"] == NOT_CONFIGURED_DETAIL
    assert "ORGANIZER_DEMO_CODE" not in resp.text


def test_blank_configured_code_returns_500(monkeypatch, client):
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "   ")
    assert client.get("/organizer/session", headers={"X-Organizer-Code": "   "}).status_code == 500


def test_rate_limit_blocks_after_max_failures(client):
    for _ in range(MAX_FAILURES):
        assert client.get("/organizer/session", headers=BAD).status_code == 401

    blocked = client.get("/organizer/session", headers=BAD)
    assert blocked.status_code == 429
    assert "Too many" in blocked.json()["detail"]
    assert int(blocked.headers["Retry-After"]) > 0

    # Blocked even with the correct code, and on other organizer routes.
    assert client.get("/organizer/session", headers=GOOD).status_code == 429
    assert client.get("/organizer/review-queue", headers=GOOD).status_code == 429
    assert client.post("/submissions/x/rescore", headers=GOOD, json={}).status_code == 429


def test_missing_code_does_not_count_as_failure(client):
    for _ in range(MAX_FAILURES * 3):
        resp = client.get("/organizer/session")
        assert resp.status_code == 401
        assert resp.json() == {"detail": CODE_REQUIRED_DETAIL}
    assert organizer_auth._failures == {}
    assert client.get("/organizer/session", headers=GOOD).status_code == 200


def test_blank_code_does_not_count_as_failure(client):
    for _ in range(MAX_FAILURES * 3):
        assert client.get("/organizer/session", headers={"X-Organizer-Code": ""}).status_code == 401
        assert client.get("/organizer/session", headers={"X-Organizer-Code": "   "}).status_code == 401
    assert organizer_auth._failures == {}
    assert client.get("/organizer/session", headers=GOOD).status_code == 200


def test_missing_code_does_not_help_reach_the_limit(client):
    for _ in range(MAX_FAILURES - 1):
        assert client.get("/organizer/session", headers=BAD).status_code == 401
    for _ in range(5):
        assert client.get("/organizer/session").status_code == 401
    # Only the wrong codes counted, so one more wrong code is still a 401, not a 429.
    assert client.get("/organizer/session", headers=BAD).status_code == 401
    assert client.get("/organizer/session", headers=BAD).status_code == 429


def test_successful_checks_do_not_count(client):
    for _ in range(MAX_FAILURES * 3):
        assert client.get("/organizer/session", headers=GOOD).status_code == 200
    for _ in range(MAX_FAILURES - 1):
        assert client.get("/organizer/session", headers=BAD).status_code == 401
    assert client.get("/organizer/session", headers=GOOD).status_code == 200


def test_rate_limit_window_expires(monkeypatch, client):
    clock = [1000.0]
    monkeypatch.setattr(organizer_auth, "_now", lambda: clock[0])

    for _ in range(MAX_FAILURES):
        client.get("/organizer/session", headers=BAD)
    assert client.get("/organizer/session", headers=GOOD).status_code == 429

    clock[0] += WINDOW_SECONDS - 1
    assert client.get("/organizer/session", headers=GOOD).status_code == 429

    clock[0] += 2
    assert client.get("/organizer/session", headers=GOOD).status_code == 200


def test_rate_limit_is_per_ip(real_app):
    a = TestClient(real_app, client=("10.0.0.1", 50000))
    b = TestClient(real_app, client=("10.0.0.2", 50000))
    for _ in range(MAX_FAILURES):
        a.get("/organizer/session", headers=BAD)
    assert a.get("/organizer/session", headers=GOOD).status_code == 429
    assert b.get("/organizer/session", headers=GOOD).status_code == 200


def test_blocked_attempts_do_not_extend_the_window(monkeypatch, client):
    clock = [1000.0]
    monkeypatch.setattr(organizer_auth, "_now", lambda: clock[0])
    for _ in range(MAX_FAILURES):
        client.get("/organizer/session", headers=BAD)

    clock[0] += WINDOW_SECONDS - 1
    for _ in range(5):
        assert client.get("/organizer/session", headers=BAD).status_code == 429
    clock[0] += 2
    assert client.get("/organizer/session", headers=GOOD).status_code == 200


def test_guard_detector_flags_unguarded_routes():
    # Sanity check for the guard test: the helper must see nested dependencies
    # and must not report routes that lack the dependency.
    from fastapi import APIRouter, Depends, FastAPI

    app = FastAPI()
    guarded = APIRouter(dependencies=[Depends(require_organizer)])

    @guarded.post("/g")
    def g():
        return {}

    def wrapper(_=Depends(require_organizer)):
        return None

    @app.post("/nested")
    def nested(_=Depends(wrapper)):
        return {}

    @app.post("/open")
    def open_route():
        return {}

    app.include_router(guarded)
    by_path = {r.path: _has_guard(r.dependant) for r in _api_routes(app)}
    assert by_path == {"/g": True, "/nested": True, "/open": False}


def test_rate_limit_blocks_at_exactly_max_failures(client):
    for _ in range(MAX_FAILURES - 1):
        assert client.get("/organizer/session", headers=BAD).status_code == 401
    # Still allowed after MAX_FAILURES - 1 failures, and this one is the 10th.
    assert client.get("/organizer/session", headers=GOOD).status_code == 200
    assert client.get("/organizer/session", headers=BAD).status_code == 401
    assert client.get("/organizer/session", headers=GOOD).status_code == 429


def test_unconfigured_code_does_not_count_as_failure(monkeypatch, client):
    monkeypatch.delenv("ORGANIZER_DEMO_CODE", raising=False)
    for _ in range(MAX_FAILURES + 2):
        assert client.get("/organizer/session", headers=BAD).status_code == 500
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", CODE)
    assert client.get("/organizer/session", headers=GOOD).status_code == 200


# --- Session tokens ---------------------------------------------------------


def test_post_session_with_code_returns_token_and_expiry(client):
    before = datetime.now(timezone.utc).timestamp()
    resp = client.post("/organizer/session", headers=GOOD)
    after = datetime.now(timezone.utc).timestamp()

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"token", "expires_at"}
    assert isinstance(body["token"], str) and body["token"]
    assert CODE not in body["token"]

    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", body["expires_at"])
    expires = datetime.strptime(body["expires_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    assert TOKEN_TTL_SECONDS == 24 * 60 * 60
    assert before + TOKEN_TTL_SECONDS - 2 <= expires.timestamp() <= after + TOKEN_TTL_SECONDS + 2


def test_post_session_rejects_missing_and_wrong_code(client):
    assert client.post("/organizer/session").status_code == 401
    assert client.post("/organizer/session", headers=BAD).status_code == 401


def test_post_session_wrong_code_is_rate_limited(client):
    for _ in range(MAX_FAILURES):
        assert client.post("/organizer/session", headers=BAD).status_code == 401
    assert client.post("/organizer/session", headers=GOOD).status_code == 429


def test_post_session_with_bearer_token_is_rejected(client):
    token = _mint(client)["token"]
    resp = client.post("/organizer/session", headers=_bearer(token))
    assert resp.status_code == 401
    assert "token" not in resp.json()


def test_post_session_with_bearer_and_code_is_rejected(client):
    # The Bearer header is checked first, so a token can never be traded for a new one,
    # even when a valid code is sent alongside it.
    token = _mint(client)["token"]
    resp = client.post("/organizer/session", headers={**_bearer(token), **GOOD})
    assert resp.status_code == 401


def test_tokens_are_unique_per_mint(client):
    assert _mint(client)["token"] != _mint(client)["token"]


def test_token_works_on_get_session(client):
    minted = _mint(client)
    resp = client.get("/organizer/session", headers=_bearer(minted["token"]))
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "expires_at": minted["expires_at"]}


def test_token_works_on_a_guarded_route(monkeypatch, client):
    from routes import organizer as organizer_routes

    class _Query:
        def __getattr__(self, _name):
            return lambda *a, **kw: self

        def execute(self):
            class _R:
                data = [{"id": "rq1"}]

            return _R()

    class _Fake:
        def table(self, _name):
            return _Query()

    monkeypatch.setattr(organizer_routes, "get_supabase", lambda: _Fake())
    token = _mint(client)["token"]

    assert client.get("/organizer/review-queue").status_code == 401
    resp = client.get("/organizer/review-queue", headers=_bearer(token))
    assert resp.status_code == 200
    assert resp.json() == [{"id": "rq1"}]


def test_bearer_scheme_is_case_insensitive(client):
    token = _mint(client)["token"]
    assert client.get("/organizer/session", headers={"Authorization": f"bearer {token}"}).status_code == 200


def test_other_auth_scheme_is_ignored(client):
    # Not a Bearer header: falls through to the code check instead of being a token error.
    resp = client.get("/organizer/session", headers={"Authorization": "Basic abc"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": CODE_REQUIRED_DETAIL}
    assert client.get("/organizer/session", headers={"Authorization": "Basic abc", **GOOD}).status_code == 200


def test_valid_token_wins_over_wrong_code(client):
    token = _mint(client)["token"]
    resp = client.get("/organizer/session", headers={**_bearer(token), **BAD})
    assert resp.status_code == 200
    assert organizer_auth._failures == {}


def test_invalid_token_is_not_rescued_by_valid_code(client):
    resp = client.get("/organizer/session", headers={**_bearer("junk"), **GOOD})
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}


def test_expired_token_returns_401(monkeypatch, client):
    clock = [1_800_000_000.0]
    monkeypatch.setattr(organizer_auth, "_wall_now", lambda: clock[0])
    token = _mint(client)["token"]

    clock[0] += TOKEN_TTL_SECONDS - 5
    assert client.get("/organizer/session", headers=_bearer(token)).status_code == 200

    clock[0] += 10
    resp = client.get("/organizer/session", headers=_bearer(token))
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}


def _flip_last_char(text: str) -> str:
    return text[:-1] + ("A" if text[-1] != "A" else "B")


def _tampered_and_bad_tokens(client):
    token = _mint(client)["token"]
    payload_b64, sig_b64 = token.split(".")
    far_future = base64.urlsafe_b64encode(b"9999999999:deadbeef").rstrip(b"=").decode()
    return {
        "flipped signature": f"{payload_b64}.{_flip_last_char(sig_b64)}",
        "flipped payload": f"{_flip_last_char(payload_b64)}.{sig_b64}",
        "extended expiry": f"{far_future}.{sig_b64}",
        "swapped parts": f"{sig_b64}.{payload_b64}",
        "empty signature": f"{payload_b64}.",
        "empty payload": f".{sig_b64}",
        "truncated": token[: len(token) // 2],
        "no dot": payload_b64 + sig_b64,
        "extra part": token + ".extra",
        "not base64": "!!!.???",
        "garbage": "garbage",
        "single dot": ".",
        "over length": "A" * 513,
        "valid token padded over length": token + "A" * 600,
        "very long": "a." + "b" * 5000,
    }


def test_tampered_malformed_and_overlong_tokens_return_401(client):
    for name, bad in _tampered_and_bad_tokens(client).items():
        resp = client.get("/organizer/session", headers=_bearer(bad))
        assert resp.status_code == 401, name
        assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}, name


def test_empty_bearer_token_returns_401(client):
    for value in ("Bearer", "Bearer ", "Bearer   "):
        resp = client.get("/organizer/session", headers={"Authorization": value})
        assert resp.status_code == 401, value
        assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}, value


def test_token_signed_with_another_code_returns_401(client):
    foreign, _ = organizer_auth.issue_session_token("someone-elses-code")
    assert client.get("/organizer/session", headers=_bearer(foreign)).status_code == 401


def test_invalid_tokens_never_count_as_failures(monkeypatch, client):
    bad_tokens = list(_tampered_and_bad_tokens(client).values())
    assert len(bad_tokens) > 0

    clock = [1_800_000_000.0]
    monkeypatch.setattr(organizer_auth, "_wall_now", lambda: clock[0])
    expired = _mint(client)["token"]
    clock[0] += TOKEN_TTL_SECONDS + 1
    bad_tokens.append(expired)

    for _ in range(MAX_FAILURES):
        for bad in bad_tokens:
            assert client.get("/organizer/session", headers=_bearer(bad)).status_code == 401

    assert organizer_auth._failures == {}
    # Never rate limited: the code still works, and a fresh token still works.
    assert client.get("/organizer/session", headers=GOOD).status_code == 200
    clock[0] = 1_800_000_000.0
    assert client.get("/organizer/session", headers=_bearer(_mint(client)["token"])).status_code == 200


def test_changing_the_code_invalidates_old_tokens(monkeypatch, client):
    token = _mint(client)["token"]
    assert client.get("/organizer/session", headers=_bearer(token)).status_code == 200

    monkeypatch.setenv("ORGANIZER_DEMO_CODE", "a-brand-new-code")
    resp = client.get("/organizer/session", headers=_bearer(token))
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}

    # The new code mints tokens that work; the old code no longer does.
    new_token = _mint(client, "a-brand-new-code")["token"]
    assert client.get("/organizer/session", headers=_bearer(new_token)).status_code == 200
    assert client.get("/organizer/session", headers=GOOD).status_code == 401

    # Restoring the original code revives the original token (the key is derived from the code).
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", CODE)
    assert client.get("/organizer/session", headers=_bearer(token)).status_code == 200


def test_whitespace_only_change_to_code_keeps_tokens_valid(monkeypatch, client):
    # The configured code is stripped before use, so surrounding whitespace is not a rotation.
    token = _mint(client)["token"]
    monkeypatch.setenv("ORGANIZER_DEMO_CODE", f"  {CODE}  ")
    assert client.get("/organizer/session", headers=_bearer(token)).status_code == 200


def test_token_with_unconfigured_code_returns_500(monkeypatch, client):
    token = _mint(client)["token"]
    monkeypatch.delenv("ORGANIZER_DEMO_CODE", raising=False)
    resp = client.get("/organizer/session", headers=_bearer(token))
    assert resp.status_code == 500
    assert resp.json() == {"detail": NOT_CONFIGURED_DETAIL}


def test_valid_token_passes_while_ip_is_rate_limited(client):
    token = _mint(client)["token"]
    for _ in range(MAX_FAILURES):
        assert client.get("/organizer/session", headers=BAD).status_code == 401

    blocked = client.get("/organizer/session", headers=GOOD)
    assert blocked.status_code == 429
    assert blocked.json() == {"detail": RATE_LIMITED_DETAIL}

    assert client.get("/organizer/session", headers=_bearer(token)).status_code == 200
    # Still blocked for codes, and the token use did not change that.
    assert client.get("/organizer/session", headers=GOOD).status_code == 429
    # Minting a new token needs the code, so it stays blocked too.
    assert client.post("/organizer/session", headers=GOOD).status_code == 429


def test_invalid_token_while_ip_is_blocked_is_401_not_429(client):
    for _ in range(MAX_FAILURES):
        client.get("/organizer/session", headers=BAD)
    resp = client.get("/organizer/session", headers=_bearer("junk"))
    assert resp.status_code == 401
    assert resp.json() == {"detail": TOKEN_INVALID_DETAIL}


# --- Limiter memory bounds --------------------------------------------------


def test_sweep_removes_expired_ips(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(organizer_auth, "_now", lambda: clock[0])
    monkeypatch.setattr(organizer_auth, "SWEEP_EVERY", 5)

    for ip in ("a", "b", "c"):
        assert organizer_auth._reserve(ip)[0] is None
    assert set(organizer_auth._failures) == {"a", "b", "c"}

    clock[0] += WINDOW_SECONDS + 1
    # Reservations 4 and 5: the 5th triggers the sweep. Nothing touches a, b or c by name.
    organizer_auth._reserve("d")
    assert set(organizer_auth._failures) == {"a", "b", "c", "d"}
    organizer_auth._reserve("d")
    assert set(organizer_auth._failures) == {"d"}
    assert len(organizer_auth._failures["d"]) == 2


def test_sweep_keeps_unexpired_ips(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(organizer_auth, "_now", lambda: clock[0])
    monkeypatch.setattr(organizer_auth, "SWEEP_EVERY", 4)

    organizer_auth._reserve("old")
    clock[0] += WINDOW_SECONDS - 10
    organizer_auth._reserve("recent")
    clock[0] += 20  # "old" is now expired, "recent" is not
    organizer_auth._reserve("x")
    organizer_auth._reserve("x")  # 4th reservation sweeps
    assert set(organizer_auth._failures) == {"recent", "x"}


def test_sweep_runs_inside_real_requests(monkeypatch, client):
    clock = [1000.0]
    monkeypatch.setattr(organizer_auth, "_now", lambda: clock[0])
    monkeypatch.setattr(organizer_auth, "SWEEP_EVERY", 3)

    stale = TestClient(client.app, client=("10.9.9.9", 1))
    stale.get("/organizer/session", headers=BAD)
    assert "10.9.9.9" in organizer_auth._failures

    clock[0] += WINDOW_SECONDS + 1
    for _ in range(3):
        client.get("/organizer/session", headers=BAD)
    assert "10.9.9.9" not in organizer_auth._failures


def test_max_tracked_ips_evicts_the_oldest(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(organizer_auth, "_now", lambda: clock[0])
    monkeypatch.setattr(organizer_auth, "MAX_TRACKED_IPS", 3)

    for ip in ("ip1", "ip2", "ip3"):
        organizer_auth._reserve(ip)
        clock[0] += 1
    assert list(organizer_auth._failures) == ["ip1", "ip2", "ip3"]

    organizer_auth._reserve("ip4")
    assert list(organizer_auth._failures) == ["ip2", "ip3", "ip4"]

    organizer_auth._reserve("ip5")
    assert list(organizer_auth._failures) == ["ip3", "ip4", "ip5"]
    assert len(organizer_auth._failures) == 3


def test_max_tracked_ips_does_not_evict_for_an_already_tracked_ip(monkeypatch):
    monkeypatch.setattr(organizer_auth, "MAX_TRACKED_IPS", 3)
    for ip in ("ip1", "ip2", "ip3"):
        organizer_auth._reserve(ip)
    organizer_auth._reserve("ip2")
    assert set(organizer_auth._failures) == {"ip1", "ip2", "ip3"}
    assert len(organizer_auth._failures["ip2"]) == 2


def test_max_tracked_ips_default_is_bounded():
    assert organizer_auth.MAX_TRACKED_IPS == 10_000
    assert organizer_auth.SWEEP_EVERY == 100


def test_release_after_success_leaves_no_tracked_ip(client):
    for _ in range(5):
        assert client.get("/organizer/session", headers=GOOD).status_code == 200
    assert organizer_auth._failures == {}


# --- Concurrency ------------------------------------------------------------


def test_concurrent_wrong_codes_cannot_overshoot_the_limit(real_app):
    attempts = MAX_FAILURES * 4
    barrier = threading.Barrier(attempts)

    def hit(_):
        c = TestClient(real_app)
        barrier.wait()
        return c.get("/organizer/session", headers=BAD).status_code

    with ThreadPoolExecutor(max_workers=attempts) as pool:
        statuses = list(pool.map(hit, range(attempts)))

    assert statuses.count(401) == MAX_FAILURES
    assert statuses.count(429) == attempts - MAX_FAILURES
    assert len(organizer_auth._failures["testclient"]) == MAX_FAILURES


def test_concurrent_reserve_never_exceeds_the_limit():
    attempts = MAX_FAILURES * 5
    barrier = threading.Barrier(attempts)

    def reserve(_):
        barrier.wait()
        return organizer_auth._reserve("1.2.3.4")[0]

    with ThreadPoolExecutor(max_workers=attempts) as pool:
        results = list(pool.map(reserve, range(attempts)))

    assert results.count(None) == MAX_FAILURES
    assert all(r >= 1 for r in results if r is not None)


# --- .env.example -----------------------------------------------------------


def test_env_example_documents_the_organizer_code():
    lines = ENV_EXAMPLE.read_text().splitlines()
    assert "ORGANIZER_DEMO_CODE=" in lines
    # It ships empty, never with a real value, and the comment above it gives the length advice.
    idx = lines.index("ORGANIZER_DEMO_CODE=")
    assert idx > 0 and lines[idx - 1].startswith("#")
    assert "12+" in lines[idx - 1]
