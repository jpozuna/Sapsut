import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def load_main(monkeypatch):
    """Reload `main` under the current env so CORS config is re-read; restore afterwards."""
    import main

    def _load(origins):
        if origins is None:
            monkeypatch.delenv("CORS_ALLOW_ORIGINS", raising=False)
        else:
            monkeypatch.setenv("CORS_ALLOW_ORIGINS", origins)
        return importlib.reload(main)

    yield _load
    monkeypatch.undo()
    importlib.reload(main)


def _preflight(client, origin):
    return client.options(
        "/health",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )


def test_configured_origin_is_allowed_and_unlisted_is_rejected(load_main):
    main = load_main("https://app.example.com, https://admin.example.com")
    client = TestClient(main.app)

    ok = client.get("/health", headers={"Origin": "https://app.example.com"})
    assert ok.headers.get("access-control-allow-origin") == "https://app.example.com"

    ok2 = _preflight(client, "https://admin.example.com")
    assert ok2.status_code == 200
    assert ok2.headers.get("access-control-allow-origin") == "https://admin.example.com"

    bad = client.get("/health", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in bad.headers

    bad_preflight = _preflight(client, "https://evil.example.com")
    assert bad_preflight.status_code == 400
    assert "access-control-allow-origin" not in bad_preflight.headers


def test_default_origins_when_unset_and_no_wildcard(load_main):
    main = load_main(None)
    client = TestClient(main.app)

    for origin in ("http://localhost:8081", "http://localhost:19006"):
        res = client.get("/health", headers={"Origin": origin})
        assert res.headers.get("access-control-allow-origin") == origin

    res = client.get("/health", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in res.headers


def test_wildcard_is_never_allowed(load_main):
    main = load_main("*,https://app.example.com")
    assert "*" not in main._cors_origins()
    client = TestClient(main.app)

    res = client.get("/health", headers={"Origin": "https://evil.example.com"})
    assert "access-control-allow-origin" not in res.headers


def test_trailing_slash_is_stripped(load_main):
    main = load_main("https://app.example.com/, https://admin.example.com//")
    assert main._cors_origins() == ["https://app.example.com", "https://admin.example.com"]
    client = TestClient(main.app)

    res = client.get("/health", headers={"Origin": "https://app.example.com"})
    assert res.headers.get("access-control-allow-origin") == "https://app.example.com"


def test_empty_allowlist_logs_warning(load_main, caplog):
    with caplog.at_level("WARNING"):
        main = load_main("*, ,/")
    assert main._cors_origins() == []
    assert any("CORS allowlist is empty" in r.getMessage() for r in caplog.records)


def test_non_empty_allowlist_does_not_warn(load_main, caplog):
    with caplog.at_level("WARNING"):
        load_main("https://app.example.com")
    assert not any("CORS allowlist is empty" in r.getMessage() for r in caplog.records)
