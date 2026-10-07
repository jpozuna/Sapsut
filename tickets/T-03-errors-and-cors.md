# T-03: Sanitize error responses and restrict CORS

Status: done
Branch: t-03-errors-and-cors

## Goal

Participant-facing backend responses no longer leak raw exception text, and
CORS only allows configured origins.

## Done when

- [x] No `detail=str(e)`, `f"...{e}"` or `{last_exc}` reaches a response in
      `backend/routes/teams.py` or `backend/routes/submissions.py`. Errors are
      logged with `logging` and the client gets a generic message.
- [x] The photo-upload failure path in `create_submission` no longer stores raw
      exception text in `rationale` or `ai_result` (both are readable through
      `GET /submissions/{id}`); it stores a generic message.
- [x] `backend/main.py` reads `CORS_ALLOW_ORIGINS` (comma-separated). When unset,
      it defaults to `http://localhost:8081,http://localhost:19006`. No `*`.
      `CORS_ALLOW_ORIGINS` is documented in `backend/.env.example`.
- [x] Tests cover: a failing Supabase call in teams/submissions returns a generic
      detail without the exception text; CORS allows a configured origin and
      rejects an unlisted one.
- [x] Repo checks pass.

## Owns

- backend/main.py
- backend/routes/teams.py
- backend/routes/submissions.py
- backend/.env.example
- backend/tests/test_teams_routes.py
- backend/tests/test_submissions_routes.py
- backend/tests/test_cors.py (new)

## Reads (not edits)

- backend/routes/organizer.py
- backend/services/
- backend/tests/conftest.py

## Depends on

- none

## Specialists

- tests: yes
- research: no
- extra: none

## Handoff

Filled in by the ticket thread when finished.

- What changed: `routes/teams.py` and `routes/submissions.py` log failures
  with `logging` and return generic details ("Failed to create team",
  "Invalid submission payload"). Upload-failure rows store "Photo upload
  failed" in `rationale` and `ai_result.error`. `main.py` builds CORS origins
  from `CORS_ALLOW_ORIGINS` (comma-separated, default
  `http://localhost:8081,http://localhost:19006`, `*` filtered out);
  documented in `backend/.env.example`. New `tests/test_cors.py`; added
  generic-error tests to the teams and submissions route tests.
- Interfaces/contracts other tickets rely on: `main._cors_origins()`;
  env var `CORS_ALLOW_ORIGINS`. Deployments must set it for non-local origins.
- Known gaps or follow-ups: the previous PostgREST message passthrough on
  submission insert (400) is gone; clients now get a fixed string. Prettier
  not run on this ticket file (backend checks only: pytest 51 passed, ruff clean).
- Blocked reason (if blocked):

Do not edit `POST /submissions/{id}/rescore` auth or anything about team
isolation (`team_id` trust, `photo_path`); those are T-02 and a separate issue.
