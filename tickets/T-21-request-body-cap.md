# T-21: Request body cap middleware

Status: done
Branch: fix/56-abuse-limits

## Goal

The backend refuses any request body over `MAX_REQUEST_BYTES`
(`MAX_UPLOAD_BYTES + 1 MiB`, 11 MiB) with 413 before Starlette spools it,
on every route.

## Done when

- [x] A pure ASGI middleware in `backend/services/body_limit.py` (no new
      dependency) returns 413 with JSON
      `{"detail": "Request body is too large. The maximum image size is 10 MB."}`
      when `Content-Length` exceeds the cap, without reading the body or
      calling the app.
- [x] For a request with no or a false `Content-Length` (chunked), the
      middleware counts bytes from `receive` and stops the request with 413 once
      the count passes the cap; the route never sees more than the cap. If the
      response has already started, the connection is closed instead.
- [x] A malformed `Content-Length` gets 400.
- [x] Requests at or under the cap are unchanged: an existing 10 MB photo
      still reaches `read_validated_image` and gets its own 413 above 10 MB,
      and all existing backend tests pass.
- [x] The middleware is registered in `backend/main.py` inside
      `CORSMiddleware` (added before it), so a 413 to an allowed origin
      carries `Access-Control-Allow-Origin`. A test checks this.
- [x] A 413 on `POST /submissions/` with no team token is returned before
      the team check (the oversized unauthenticated request gets 413, not
      401).
- [x] Repo checks pass.

## Owns

- backend/services/body_limit.py
- backend/main.py
- backend/tests/test_body_limit.py

## Deletes

- none

## Reads (not edits)

- backend/services/uploads.py (`MAX_UPLOAD_BYTES`)
- backend/tests/test_cors.py
- backend/routes/organizer.py (upload routes)

## Depends on

- none

## Specialists

- tests: no
- research: no
- extra: security-auditor
- verify-live: none

## Handoff

Filled in by the worker when finished.

- What changed: new pure ASGI `BodyLimitMiddleware` in
  `backend/services/body_limit.py` (`MAX_REQUEST_BYTES` = 11 MiB), registered
  in `backend/main.py` just before `CORSMiddleware`. Early 413/400 carry
  `Connection: close`. For counted bodies, FastAPI converts a receive error
  during form parsing into a 400, so the middleware drops the app's response
  once the cap is passed and sends its own 413 (or, if the response had already
  started, returns without completing it so the server closes).
- Interfaces/contracts other tickets rely on: `services.body_limit.MAX_REQUEST_BYTES`,
  `BodyLimitMiddleware(app, max_bytes=...)`. Middleware order: CORS outermost,
  body limit inside it. A rate-limit middleware, if added, should go inside body limit.
- Tests per Done-when item (all in `backend/tests/test_body_limit.py`): early 413
  (`test_content_length_over_cap_*`); chunked and lying length
  (`test_chunked_*`, `test_lying_content_length_is_counted`,
  `test_response_already_started_closes_connection_instead`); malformed 400
  (`test_malformed_content_length_is_400`, `test_duplicate_*`); unchanged at or
  under cap (`test_ten_mb_photo_*`, `test_photo_over_ten_mb_but_under_cap_*`, full
  suite 472 passed); CORS (`test_413_carries_cors_header_for_allowed_origin`);
  413 before team check (`test_oversized_unauthenticated_submission_is_413_not_401`).
  Repo checks: ruff and pytest pass, prettier passes on the ticket file.
- Known gaps or follow-ups: multiple Content-Length headers are rejected with 400
  even if equal. A Content-Length over 19 digits is treated as over the cap.
- Manager to delete: none
- Manager edit (unreviewed): `except BaseException` changed to `except Exception`
  in `body_limit.py` so CancelledError still propagates (code-reviewer and
  security-auditor note).
- Blocked reason (if blocked): none
