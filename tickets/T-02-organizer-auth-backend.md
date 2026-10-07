# T-02: Harden organizer auth on the backend

Status: done
Branch: t-02-organizer-auth-backend

## Goal

Every task-creating and organizer route requires the organizer code, checked in
constant time with a rate limit on failures, and the app has an endpoint to
verify a code.

## Done when

- [x] `POST /tasks/` is removed (the guarded `POST /organizer/tasks` remains).
      `GET /tasks/` is unchanged.
- [x] `require_organizer` compares with `secrets.compare_digest`.
- [x] Failed code checks are rate-limited in memory by client IP
      (`request.client.host`): after 10 failures within 5 minutes, that IP gets
      429 on organizer routes until the window passes. Successful checks don't
      count. No new dependency in `backend/requirements.txt`.
- [x] `GET /organizer/session` exists behind the organizer router guard and
      returns `{"ok": true}`; wrong or missing code returns 401.
- [x] `detail=str(e)` and other raw exception text are removed from
      `backend/routes/organizer.py` responses (log server-side with `logging`,
      return a generic message).
- [x] Tests: every route whose path starts with `/organizer`, plus
      `POST /submissions/{id}/rescore`, returns 401 with a missing code and with a
      wrong code (enumerate `app.routes`, don't hand-list). A guard test fails if
      any non-GET route outside an explicit allowlist (`POST /submissions/`,
      `POST /teams/`) lacks the `require_organizer` dependency. Rate limit and
      `/organizer/session` are covered.
- [x] Repo checks pass.

### Review round 2 (from code review and security audit)

- [x] Session tokens: `POST /organizer/session` takes `X-Organizer-Code`
      (rate-limited as today) and returns 200
      `{"token": "<opaque>", "expires_at": "<ISO 8601 UTC>"}`, valid 24h. The
      token is HMAC-SHA256 signed (`hmac` + `compare_digest`, stdlib only) with a
      key derived from `ORGANIZER_DEMO_CODE`, so rotating the code invalidates
      every token. No server-side session store.
- [x] `require_organizer` accepts `Authorization: Bearer <token>` (checked first,
      never rate-limited, never counted as a failure) or `X-Organizer-Code`
      (rate-limited). A valid token works even while its IP is blocked. An
      invalid or expired token returns 401 and does not count as a failure.
- [x] `GET /organizer/session` with a valid token or code returns 200
      `{"ok": true, "expires_at": <token expiry, or null for a code>}`.
- [x] A request with neither header returns 401 but does not count as a failure
      (only a wrong code does).
- [x] Limiter memory is bounded: expired IPs are swept inside the lock (for
      example every 100 records), and tracked IPs are capped (for example 10,000;
      evict the oldest).
- [x] The limiter checks and records under one lock acquisition (reserve a slot
      before `compare_digest`, release it on success), so concurrent bad requests
      can't overshoot the limit.
- [x] An unset `ORGANIZER_DEMO_CODE` returns a generic 500 ("Organizer access is
      not configured.") without the variable name, and `ORGANIZER_DEMO_CODE=` is
      added to `backend/.env.example` with a comment saying to use 12+ random
      characters.
- [x] Override score is capped: `override_review_queue_item` rejects with 400 a
      score above the task's `max_points`.
- [x] The guard test also fails on any route in `app.routes` that isn't an
      `APIRoute`, unless it's on an explicit allowlist (docs, openapi, redoc).
- [x] Tests cover all of the above, including a valid token getting through
      while its IP is rate-limited, an expired or tampered token, and token
      invalidation after the code changes.

## Owns

- backend/auth/organizer.py
- backend/routes/tasks.py
- backend/routes/organizer.py
- backend/tests/test_organizer_gating.py
- backend/tests/test_organizer_auth.py (new)
- backend/.env.example

## Reads (not edits)

- backend/main.py
- backend/routes/submissions.py
- backend/tests/conftest.py
- lib/organizer-api.ts
- app/ (to confirm nothing calls `POST /tasks/`)

## Depends on

- none

## Specialists

- tests: yes
- research: no
- extra: security-auditor

## Handoff

- What changed:
  - `backend/auth/organizer.py`: stdlib HMAC-SHA256 session tokens
    (`issue_session_token`, `verify_session_token`, `format_expiry`; key derived
    from `ORGANIZER_DEMO_CODE`, 24h TTL). `require_organizer` checks
    `Authorization: Bearer` first (never rate limited or counted), then
    `X-Organizer-Code` with `secrets.compare_digest` and an in-memory per-IP
    limiter (10 failures per 5 minutes). The limiter reserves a slot before the
    compare and releases it on success, under one lock, sweeps every 100
    reservations and caps tracked IPs at 10,000. A missing header gives 401
    without counting.
  - `backend/routes/organizer.py`: `POST /organizer/session` (code only) and
    `GET /organizer/session`; raw exception text replaced by generic messages
    plus `logger.exception`; override rejects a score above the task's
    `max_points` with 400.
  - `backend/routes/tasks.py`: `POST /tasks/` and `TaskCreate` removed.
  - `backend/.env.example`: `ORGANIZER_DEMO_CODE=` with a 12+ random characters
    note.
  - Tests: `backend/tests/test_organizer_auth.py` (new) and
    `test_organizer_gating.py`. `pytest backend/tests/ -q`: 134 passed; ruff,
    expo lint, tsc and prettier clean.
- Interfaces/contracts other tickets rely on:
  - `POST /organizer/session` with `X-Organizer-Code: <code>` only: 200
    `{"token": "<opaque>", "expires_at": "YYYY-MM-DDTHH:MM:SSZ"}`. Any
    `Authorization: Bearer` header on this request (valid or not) gives 401, even
    with a valid code, so the client must send only the code here.
  - `GET /organizer/session` with a token or code: 200
    `{"ok": true, "expires_at": "<ISO UTC>" | null}` (null for a code).
  - Every guarded route (`/organizer/*`, `POST /submissions/{id}/rescore`)
    accepts `Authorization: Bearer <token>` or `X-Organizer-Code`.
  - 401 missing or wrong code:
    `{"detail": "Invalid or missing X-Organizer-Code for organizer access."}`.
  - 401 invalid, expired or tampered token:
    `{"detail": "Invalid or expired organizer session token."}`.
  - 429 (code checks only): `{"detail": "Too many failed organizer code attempts. Try again later."}`
    with `Retry-After` seconds. A valid token bypasses the block.
  - 500 if the code is unset: `{"detail": "Organizer access is not configured."}`.
  - Override above `max_points`: 400
    `{"detail": "Score cannot exceed the task's maximum of N points."}`.
- Known gaps or follow-ups (from code review and security audit, none blocking):
  - Key derivation is a fast HMAC, so a leaked token allows offline guessing of
    a weak code. Use a slow KDF (`pbkdf2_hmac`/`scrypt`, cached) and/or an
    optional `ORGANIZER_SESSION_SECRET`; warn at startup on short codes.
  - No per-token revocation; rotating the code is the only kill switch.
  - Limiter is per process. Behind a proxy all clients share one bucket; never
    run uvicorn with `--forwarded-allow-ips="*"`. IPv6 is keyed per address (key
    by /64). The 10k cap evicts by insertion order and can drop a blocked IP. No
    global failure ceiling and no logging of blocks.
  - A correct-code request holds a slot until release, so a burst of correct
    codes from an IP at 9 failures can see one transient 429.
  - Override task lookup treats a null `max_points` as 0 and may 500 on a
    submission with no `task_id`; non-UUID ids give 500 rather than 400.
- Blocked reason (if blocked): none. (Round 2 was interrupted mid-run; the
  manager verified the finished work and reviews in a later session.)
