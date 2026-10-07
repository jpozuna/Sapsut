# T-11: Organizer-created teams and invite-code join

Status: done
Branch: t-11-team-routes

## Goal

Teams are created and listed only by organizers, and participants exchange an
invite code for a team session token, with no team route returning
`created_by` or another team's invite code.

## Done when

- [x] `POST /teams/` requires `require_organizer`. Body `{name}` (trimmed,
      1-80 chars) gives `{id, name, invite_code}`. The invite-code retry loop
      stays.
- [x] `GET /teams/` requires `require_organizer` and returns
      `[{id, name, invite_code, total_score, created_at}]` ordered by name, from
      an explicit column list.
- [x] `POST /teams/join` is public. Body `{invite_code}` is trimmed and
      upper-cased. A match gives `{team: {id, name}, token, expires_at}` (ISO 8601
      UTC) from `auth.team.issue_team_token`. An unknown or blank code gives 404
      `"Team not found"`.
- [x] `GET /teams/me` requires `require_team` and returns `{id, name, total_score}`.
      A token for a deleted team gives 404.
- [x] `GET /teams/{id}` and `GET /teams/?invite_code=` are removed. No teams
      query uses `select("*")`.
- [x] `backend/tests/test_organizer_auth.py`: `PUBLIC_NON_GET` becomes
      `{("POST", "/submissions/"), ("POST", "/teams/join")}` and the guarded-target
      set includes `POST /teams/` and `GET /teams/`, so the existing
      missing/wrong-code checks run on them.
- [x] `backend/tests/test_teams_routes.py` covers every route above, including:
      join never returns `invite_code` or `created_by`; create/list give 401
      without organizer auth.
- [x] Repo checks pass.

## Owns

- backend/routes/teams.py
- backend/tests/test_teams_routes.py
- backend/tests/test_organizer_auth.py

## Reads (not edits)

- backend/auth/team.py
- backend/auth/organizer.py
- backend/routes/leaderboard.py
- tickets/BOARD.md (contract section)

## Depends on

- T-10 (needs: `issue_team_token`, `require_team`, `format_expiry`, the env var name)

## Specialists

- tests: yes
- research: no
- extra: security-auditor

## Handoff

- What changed: `backend/routes/teams.py` rewritten. `POST /teams/` and
  `GET /teams/` use `require_organizer` (route-level dependency).
  `POST /teams/join` is public and calls `is_configured()` first (500
  `"Team access is not configured."`), then looks up `id,name` by the trimmed,
  upper-cased code. Blank or over-64-character codes give 404 without a DB
  lookup. `GET /teams/me` uses `require_team`. `GET /teams/{id}` and
  `GET /teams/?invite_code=` are gone. Every query uses an explicit column list
  and `.limit(1)` instead of `maybe_single()`. `test_teams_routes.py` rewritten
  (fake table records select column lists); `test_organizer_auth.py` has
  `PUBLIC_NON_GET = {POST /submissions/, POST /teams/join}` and `/teams/` (GET
  and POST) in the guarded targets.
- Interfaces/contracts other tickets rely on:
  - `POST /teams/` (organizer, body `{name}` trimmed 1-80) -> `{id, name, invite_code}`
  - `GET /teams/` (organizer) -> `[{id, name, invite_code, total_score, created_at}]` by name
  - `POST /teams/join` `{invite_code}` -> `{team: {id, name}, token, expires_at}`
    with `expires_at` like `2026-10-14T12:00:00Z`; 404 `{"detail": "Team not found"}`;
    500 `{"detail": "Team access is not configured."}` when the secret is unusable;
    500 `{"detail": "Failed to join team"}` if the DB id is not a UUID (logged).
    422 for a missing or non-string `invite_code`.
  - `GET /teams/me` (`X-Team-Token`) -> `{id, name, total_score}`; 404
    `"Team not found"` for a deleted team; 401 `"Invalid or missing team token."`.
- Manager changes after review: team-create errors log only the exception type
  and PostgREST code, never the message (it can quote an invite code). Join
  accepts only an ASCII `[A-Z0-9]{1,64}` code after upper-casing (else 404, no
  lookup), wraps the lookup (DB error: 500 `"Failed to join team"`), and
  `GET /teams/` and `POST /teams/join` send `Cache-Control: no-store`. The
  public-route comment in `test_organizer_auth.py` is corrected. Test-writer
  added 7 cases; the manager added 5.
- Known gaps or follow-ups: no rate limit on join (#56). The 64-character cap on
  join input is an addition to the ticket (real codes are 8 characters).
- Blocked reason (if blocked): none
