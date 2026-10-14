# T-20: Rate limit team join and submission create

Status: done
Branch: fix/56-abuse-limits

## Goal

`POST /teams/join` is limited per client IP on failed codes and
`POST /submissions/` is limited per team, both answering 429 with
`Retry-After`, using the T-19 limiter.

## Done when

- [x] `POST /teams/join`: each attempt that does not return a team (bad
      format or unknown code) counts as a failure for the client IP. After
      `JOIN_MAX_FAILURES = 20` failures within `JOIN_WINDOW_SECONDS = 600`,
      that IP gets 429 with a `Retry-After` header and detail
      `"Too many invite code attempts. Try again later."`, without a database
      lookup, even for a correct code. A successful join and a 500 (lookup
      failure, token issue failure) do not count.
- [x] A blocked IP does not block a different IP (test with two
      `TestClient(app, client=(ip, port))` instances).
- [x] `POST /submissions/`: after `require_team` succeeds, every attempt
      counts for that team id. After `SUBMIT_MAX_PER_TEAM = 50` attempts
      within `SUBMIT_WINDOW_SECONDS = 600`, the team gets 429 with
      `Retry-After` and detail
      `"Too many submissions. Wait a few minutes and try again."`, before any
      Supabase call, storage upload or scoring task. Another team is not
      affected. Requests without a valid team token still get 401 and do not
      count.
- [x] The limits are module-level constants in the route files so tests can
      lower them; tests advance the limiter clock instead of sleeping.
- [x] Existing tests in `test_teams_routes.py` and
      `test_submissions_routes.py` still pass.
- [x] Repo checks pass.

## Owns

- backend/routes/teams.py
- backend/routes/submissions.py
- backend/tests/test_route_rate_limits.py
- backend/tests/test_teams_routes.py
- backend/tests/test_submissions_routes.py

## Deletes

- none

## Reads (not edits)

- backend/services/rate_limit.py
- backend/auth/team.py
- backend/tests/conftest.py
- lib/team-session.ts (join error mapping: 429 shows the generic retry text)
- app/tasks/[id]/submit.tsx (shows a string `detail`)

## Depends on

- T-19 (needs: `SlidingWindowLimiter`, `client_ip`, `too_many_requests`, the
  autouse reset fixture)

## Specialists

- tests: no
- research: no
- extra: security-auditor
- verify-live: none

## Handoff

Filled in by the worker when finished.

- What changed: `routes/teams.py`: `JOIN_MAX_FAILURES`, `JOIN_WINDOW_SECONDS`,
  `_join_limiter`. `join_team` reserves a slot for the client IP before any
  work (429 + `Retry-After` when blocked, no DB lookup) and releases it on
  success and on any non-404 outcome (500s), so only 404s count. The original
  body moved to `_join_team`. `routes/submissions.py`: `SUBMIT_MAX_PER_TEAM`,
  `SUBMIT_WINDOW_SECONDS`, `_submit_limiter`; `create_submission` reserves a
  slot for the token team id first thing in the handler (every attempt counts).
  Constants are copied onto the limiter per request so tests can monkeypatch
  them. New `tests/test_route_rate_limits.py`.
- Interfaces/contracts other tickets rely on: 429 details exactly as in the
  Done-when. Tests patch `routes.teams._join_limiter.clock` and
  `routes.submissions._submit_limiter.clock`.
- Tests per Done-when item: all in `test_route_rate_limits.py`: join block,
  bad-format counts, success and 500s (lookup, token issue, unconfigured) do
  not count, two-IP isolation, submit block before supabase/upload/scoring,
  team isolation, 401 does not count, clock-advance recovery, spec constants.
  Existing teams/submissions tests pass unchanged. Full backend suite 486
  passed, ruff clean.
- Known gaps or follow-ups: a request with a malformed body (422) or a 422 form
  never reaches the handler, so it is not counted. Limits are per process.
- Manager to delete: none
- Blocked reason (if blocked): n/a
