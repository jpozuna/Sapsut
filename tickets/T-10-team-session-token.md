# T-10: Signed team session token on the backend

Status: done
Branch: t-10-team-session-token

## Goal

The backend can issue and verify a signed team session token, and team-scoped
routes can require one through a `require_team` dependency.

## Done when

- [x] New `backend/auth/team.py` exports `issue_team_token(team_id) -> (token, expires_at)`,
      `verify_team_token(token) -> Optional[(team_id, expires_at)]`, `format_expiry`
      (or reuses the one in `auth/organizer.py` by import), and `require_team`.
- [x] Tokens are stateless HMAC-SHA256, shaped like the organizer token:
      `<b64url(payload)>.<b64url(signature)>`, payload `<team_id>:<expiry>:<nonce>`.
      The key comes from `TEAM_SESSION_SECRET` with its own key-context string, so a
      team token never verifies as an organizer token and vice versa.
- [x] TTL is 7 days (`TEAM_TOKEN_TTL_SECONDS`). Max token length is capped.
      Verification uses `hmac.compare_digest`, rejects a non-UUID team id, a bad
      signature, malformed base64, and an expired token, and never raises.
- [x] `require_team` reads the `X-Team-Token` header and returns the team id
      (a `str`); it also sets `request.state.team_id`. Missing or invalid token
      gives 401 with detail `"Invalid or missing team token."`. If
      `TEAM_SESSION_SECRET` is unset or blank: 500 `"Team access is not configured."`
      and an error log line (never the token).
- [x] `backend/.env.example` documents `TEAM_SESSION_SECRET` (32+ random
      characters; rotating it signs out every team).
- [x] `backend/tests/test_team_auth.py` covers round trip, tamper, expiry,
      wrong secret, organizer-token rejection, header missing/blank/garbage, and
      the not-configured 500, using a tiny FastAPI app with one guarded route.
- [x] No route is changed in this ticket.
- [x] Repo checks pass.

## Owns

- backend/auth/team.py (new)
- backend/tests/test_team_auth.py (new)
- backend/.env.example

## Reads (not edits)

- backend/auth/organizer.py (follow its token format and style)
- backend/tests/test_organizer_auth.py (reads `.env.example`; keep it passing)
- tickets/BOARD.md (contract section)

## Depends on

- none

## Specialists

- tests: yes
- research: no
- extra: security-auditor

## Handoff

Filled in by the ticket thread when finished.

- What changed: New `backend/auth/team.py` (token issue/verify and the
  `require_team` guard), `backend/tests/test_team_auth.py` (36 cases), and
  `TEAM_SESSION_SECRET=` documented in `backend/.env.example`. No route changed.
- Interfaces/contracts other tickets rely on (all in `auth.team`):
  - `issue_team_token(team_id: str) -> Tuple[str, int]` returns
    `(token, expires_at_unix_seconds)`. Raises `ValueError` for a non-UUID id and
    `RuntimeError` if `TEAM_SESSION_SECRET` is unset or blank, so a route that
    issues tokens (T-11 join) should check config first or let that surface as a 500.
  - `verify_team_token(token: str) -> Optional[Tuple[str, int]]` returns
    `(team_id, expires_at)` or None; never raises.
  - `format_expiry(expires_at: int) -> str` is re-exported from `auth.organizer`
    (ISO 8601 UTC, `%Y-%m-%dT%H:%M:%SZ`).
  - `require_team(request, x_team_token=Header(alias="X-Team-Token")) -> str`
    returns the team id (lowercase hyphenated UUID) and sets `request.state.team_id`.
    401 `"Invalid or missing team token."`; 500 `"Team access is not configured."`
    (checked before the token, with an error log that never contains the token).
  - Constants: `TEAM_TOKEN_TTL_SECONDS` (7 days), `TOKEN_INVALID_DETAIL`,
    `NOT_CONFIGURED_DETAIL`. Key context `sapsut-team-session-v1`; max token length 512.
- Manager changes after review (security audit warnings): a secret shorter
  than `MIN_SECRET_LENGTH` (32) or equal to `ORGANIZER_DEMO_CODE` counts as
  unconfigured (500 / `RuntimeError`). New public `is_configured()` (call it
  before route work in `/teams/join`, then raise
  `HTTPException(500, NOT_CONFIGURED_DETAIL)`) and `canonical_team_id()` (use it
  to compare a client `team_id` against the token's). `__all__` lists the
  detail constants. `.env.example` has a generator hint. Test-writer added 11
  cases; the manager added 5. Backend suite: 264 passed.
- Known gaps or follow-ups: No per-team revocation (out of scope). Tests that
  exercise team routes must set `TEAM_SESSION_SECRET` (e.g. monkeypatch.setenv).
- Blocked reason (if blocked): none
