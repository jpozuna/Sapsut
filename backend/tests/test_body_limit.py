import asyncio
import importlib

import pytest
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import PlainTextResponse
from fastapi.testclient import TestClient

from services.body_limit import (
    MAX_REQUEST_BYTES,
    TOO_LARGE_DETAIL,
    BodyLimitMiddleware,
)
from services.uploads import MAX_UPLOAD_BYTES, read_validated_image

EXPECTED_DETAIL = "Request body is too large. The maximum image size is 10 MB."
ORIGIN = "http://localhost:8081"


def test_cap_is_upload_limit_plus_one_mib():
    assert MAX_REQUEST_BYTES == 11 * 1024 * 1024
    assert TOO_LARGE_DETAIL == EXPECTED_DETAIL


def _app(max_bytes=MAX_REQUEST_BYTES):
    app = FastAPI()
    app.add_middleware(BodyLimitMiddleware, max_bytes=max_bytes)
    calls = {"app": 0, "bytes": 0}

    @app.post("/echo")
    async def echo(request: Request):
        calls["app"] += 1
        async for chunk in request.stream():
            calls["bytes"] += len(chunk)
        return PlainTextResponse(str(calls["bytes"]))

    @app.post("/photo")
    async def photo(photo: UploadFile = File(...)):
        calls["app"] += 1
        image = await read_validated_image(photo)
        return {"size": len(image.data)}

    return app, calls


def test_content_length_over_cap_is_413_without_calling_app():
    app, calls = _app(max_bytes=100)
    client = TestClient(app)
    res = client.post("/echo", content=b"x" * 101)
    assert res.status_code == 413
    assert res.json() == {"detail": EXPECTED_DETAIL}
    assert calls["app"] == 0


def test_content_length_over_cap_never_reads_body():
    messages = []
    called = []

    async def app(scope, receive, send):
        called.append(True)

    async def receive():
        raise AssertionError("body must not be read")

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/x",
        "headers": [(b"content-length", b"101")],
    }
    asyncio.run(BodyLimitMiddleware(app, max_bytes=100)(scope, receive, send))
    assert not called
    assert messages[0]["status"] == 413


def test_body_at_cap_passes_through():
    app, calls = _app(max_bytes=100)
    res = TestClient(app).post("/echo", content=b"x" * 100)
    assert res.status_code == 200
    assert res.text == "100"


def test_chunked_body_over_cap_is_413_and_route_never_sees_more_than_cap():
    app, calls = _app(max_bytes=100)

    def chunks():
        for _ in range(10):
            yield b"x" * 30

    res = TestClient(app).post("/echo", content=chunks())
    assert res.status_code == 413
    assert res.json() == {"detail": EXPECTED_DETAIL}
    assert calls["bytes"] <= 100


def test_chunked_body_at_cap_passes():
    app, calls = _app(max_bytes=100)

    def chunks():
        yield b"x" * 50
        yield b"x" * 50

    res = TestClient(app).post("/echo", content=chunks())
    assert res.status_code == 200
    assert calls["bytes"] == 100


def test_lying_content_length_is_counted():
    """A Content-Length under the cap does not stop the byte count."""
    sent = []
    seen = {"bytes": 0}

    async def app(scope, receive, send):
        while True:
            message = await receive()
            seen["bytes"] += len(message.get("body", b""))
            if not message.get("more_body"):
                break

    bodies = [
        {"type": "http.request", "body": b"x" * 60, "more_body": True},
        {"type": "http.request", "body": b"x" * 60, "more_body": True},
        {"type": "http.request", "body": b"x" * 60, "more_body": False},
    ]

    async def receive():
        return bodies.pop(0)

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/x",
        "headers": [(b"content-length", b"10")],
    }
    asyncio.run(BodyLimitMiddleware(app, max_bytes=100)(scope, receive, send))
    assert seen["bytes"] == 60
    assert sent[0]["status"] == 413


def test_response_already_started_closes_connection_instead():
    sent = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        while True:
            message = await receive()
            if not message.get("more_body"):
                break
        await send({"type": "http.response.body", "body": b"ok"})

    bodies = [
        {"type": "http.request", "body": b"x" * 60, "more_body": True},
        {"type": "http.request", "body": b"x" * 60, "more_body": False},
    ]

    async def receive():
        return bodies.pop(0)

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/x", "headers": []}
    asyncio.run(BodyLimitMiddleware(app, max_bytes=100)(scope, receive, send))
    # The 200 start went out; no 413 and no body follow it, so the server closes.
    assert [m["type"] for m in sent] == ["http.response.start"]
    assert sent[0]["status"] == 200


@pytest.mark.parametrize("value", [b"abc", b"-1", b"1.5", b"", b" ", b"1e3", b"+5"])
def test_malformed_content_length_is_400(value):
    sent = []
    called = []

    async def app(scope, receive, send):
        called.append(True)

    async def receive():
        raise AssertionError("body must not be read")

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/x", "headers": [(b"content-length", value)]}
    asyncio.run(BodyLimitMiddleware(app, max_bytes=100)(scope, receive, send))
    assert not called
    assert sent[0]["status"] == 400


def test_duplicate_content_length_is_400():
    sent = []

    async def app(scope, receive, send):
        raise AssertionError("app must not be called")

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/x",
        "headers": [(b"content-length", b"5"), (b"content-length", b"5")],
    }
    asyncio.run(BodyLimitMiddleware(app, max_bytes=100)(scope, None, send))
    assert sent[0]["status"] == 400


def test_huge_content_length_digits_is_413():
    app, calls = _app(max_bytes=100)
    res = TestClient(app).post("/echo", content=b"x", headers={"content-length": "9" * 5000})
    assert res.status_code in (413, 400)
    assert calls["app"] == 0


def test_non_http_scope_passes_through():
    seen = []

    async def app(scope, receive, send):
        seen.append(scope["type"])

    asyncio.run(BodyLimitMiddleware(app, max_bytes=1)({"type": "lifespan"}, None, None))
    assert seen == ["lifespan"]


def _photo(size):
    return {"photo": ("p.jpg", b"\xff" * size, "image/jpeg")}


def test_ten_mb_photo_still_reaches_read_validated_image():
    app, calls = _app()
    res = TestClient(app).post("/photo", files=_photo(MAX_UPLOAD_BYTES))
    assert res.status_code == 200
    assert res.json() == {"size": MAX_UPLOAD_BYTES}


def test_photo_over_ten_mb_but_under_cap_gets_route_413():
    app, calls = _app()
    res = TestClient(app).post("/photo", files=_photo(MAX_UPLOAD_BYTES + 1))
    assert res.status_code == 413
    assert "Image is too large" in res.json()["detail"]
    assert calls["app"] == 1


def test_photo_over_cap_gets_middleware_413():
    app, calls = _app()
    res = TestClient(app).post("/photo", files=_photo(MAX_REQUEST_BYTES))
    assert res.status_code == 413
    assert res.json() == {"detail": EXPECTED_DETAIL}
    assert calls["app"] == 0


@pytest.fixture()
def main_app(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", ORIGIN)
    import main

    main = importlib.reload(main)
    yield main.app
    monkeypatch.undo()
    importlib.reload(main)


def test_413_carries_cors_header_for_allowed_origin(main_app):
    client = TestClient(main_app)
    res = client.post(
        "/submissions/",
        content=b"x",
        headers={"Origin": ORIGIN, "content-length": str(MAX_REQUEST_BYTES + 1)},
    )
    assert res.status_code == 413
    assert res.headers.get("access-control-allow-origin") == ORIGIN

    bad = client.post(
        "/submissions/",
        content=b"x",
        headers={"Origin": "https://evil.example.com", "content-length": str(MAX_REQUEST_BYTES + 1)},
    )
    assert bad.status_code == 413
    assert "access-control-allow-origin" not in bad.headers


def test_oversized_unauthenticated_submission_is_413_not_401(main_app):
    client = TestClient(main_app)
    res = client.post(
        "/submissions/",
        files=_photo(MAX_REQUEST_BYTES),
        data={"task_id": "11111111-1111-1111-1111-111111111111"},
    )
    assert res.status_code == 413
    assert res.json() == {"detail": EXPECTED_DETAIL}


def test_chunked_multipart_over_cap_is_413_not_fastapi_400():
    """FastAPI turns a receive error during form parsing into 400; the cap must win."""
    app, calls = _app(max_bytes=2000)
    boundary = "bnd"
    head = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="p.jpg"\r\n'
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()

    def chunks():
        yield head
        for _ in range(10):
            yield b"\xff" * 500
        yield tail

    res = TestClient(app).post(
        "/photo",
        content=chunks(),
        headers={"content-type": f"multipart/form-data; boundary={boundary}"},
    )
    assert res.status_code == 413
    assert res.json() == {"detail": EXPECTED_DETAIL}
