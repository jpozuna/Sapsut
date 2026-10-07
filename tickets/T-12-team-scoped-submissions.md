# T-12: Team-scoped submissions and no client photo paths

Status: done
Branch: t-12-team-scoped-submissions

## Goal

Participant submission routes act only on the team in the caller's team token,
and the backend never signs or scores a photo path the client chose.

## Done when

- [x] `POST /submissions/` requires `require_team`; the team comes from the
      token. A `team_id` form field is optional; if sent and different from the
      token's team, 403 `"Team mismatch."`. The `photo_path` form field is
      removed; only an uploaded `photo` can set `photo_url`.
- [x] `GET /submissions/` requires `require_team` and lists only the token's
      team. `team_id` query is optional; if sent and different, 403. `task_id`
      filter still works.
- [x] `GET /submissions/{id}` requires `require_team`. A row owned by another
      team gives 404 `"Submission not found"` (same as missing).
- [x] `GET /submissions/{id}` signs `photo_url` only when it matches
      `{row.team_id}/{row.task_id}/<uuid>.<ext>` with `ext` from
      `services.uploads.ALLOWED_IMAGE_TYPES` values, with no `..` and no
      leading `/`. Other stored paths (old rows written through `photo_path`)
      get no `photo_signed_url` and a warning log with the submission id only.
- [x] Non-UUID `id` on `GET /submissions/{id}` gives 404 without a database call.
- [x] `POST /submissions/{id}/rescore` is unchanged and still organizer-only.
- [x] `backend/tests/test_submissions_routes.py` covers: 401 without token, 403
      mismatch, cross-team 404, `photo_path` ignored (stored path is the
      server-generated one), signed URL withheld for a foreign or traversal path.
      `test_submissions_rescore.py` still passes untouched.
- [x] Repo checks pass.

## Owns

- backend/routes/submissions.py
- backend/tests/test_submissions_routes.py

## Reads (not edits)

- backend/auth/team.py
- backend/services/uploads.py
- backend/services/scoring.py
- backend/tests/test_submissions_rescore.py
- tickets/BOARD.md (contract section)

## Depends on

- T-10 (needs: `require_team` and the 401 detail text)

## Specialists

- tests: yes
- research: no
- extra: security-auditor

## Handoff

Filled in by the ticket thread when finished.

- What changed: `backend/routes/submissions.py` and
  `backend/tests/test_submissions_routes.py` only.
  - `POST /submissions/`: `require_team`; team comes from the token and is used
    for the insert, the existence check, the storage path and `score_submission`.
    `team_id` form is optional; if sent and not the same UUID (compared after
    `canonical_team_id`) -> 403 `"Team mismatch."` (checked before any DB or
    storage work). A non-UUID `task_id` is still 400 `"task_id must be a UUID"`;
    `task_id` is canonicalized (lowercase) so the stored path matches the signing
    check. `photo_path` form field removed (a sent value is ignored). Input error
    text is now `"Submission must include text_answer or photo."` (still a 200
    `{"error": ...}` body as before).
  - `GET /submissions/`: `require_team`; filters only by the token's team.
    `team_id` query optional; sent and different or non-UUID -> 403
    `"Team mismatch."`. An empty `?team_id=` query gives 403 (an empty POST form field is treated
    as not sent).
    `task_id` filter unchanged.
  - `GET /submissions/{id}`: `require_team`; non-UUID id -> 404 `"Submission not
found"` with no DB call; row of another team -> same 404. Signs `photo_url`
    only if it `re.fullmatch`es `{row team}/{row task}/<lowercase uuid>.<ext>`
    (ids canonicalized from the row, ext from `ALLOWED_IMAGE_TYPES` values, so no
    `..`, no leading `/`, no trailing junk). Otherwise no `photo_signed_url` and
    `logger.warning("Submission %s has a photo path that is not signable", id)`.
  - Rescore route untouched.
  - Tests: rewrote `test_submissions_routes.py` for UUID ids and team tokens
    (`TEAM_SESSION_SECRET` set in the fixture, tokens from `issue_team_token`).
- Interfaces/contracts other tickets rely on: send `X-Team-Token` on all three
  participant routes; 401 `"Invalid or missing team token."`, 500 `"Team access
is not configured."`, 403 `"Team mismatch."`, 404 `"Submission not found"`.
  Clients should stop sending `photo_path`. The `team_id` field/query may still be
  sent, but is unnecessary.
- Manager changes after review: the list route's `task_id` filter is
  canonicalized (non-UUID: 400 `"task_id must be a UUID"`), and a signing
  failure logs a warning with the submission id only. Test-writer added 8
  cases; the manager added 3.
- Known gaps or follow-ups: old rows whose `photo_url` came from a client
  `photo_path` no longer get a signed URL (no migration, per board decision).
  `task_id` query on the list route is still passed to the DB unvalidated.
  `tests/test_teams_routes.py` had 6 failures in the shared run caused by the
  other in-flight ticket, not by this one.
- Blocked reason (if blocked):
