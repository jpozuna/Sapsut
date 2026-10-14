# T-23: Enforce task windows and one submission server-side

Status: done
Branch: fix/58-submission-integrity

## Goal

`GET /tasks/` hides inactive and unopened tasks, `POST /submissions/` rejects
tasks that are missing, inactive, unopened or closed, and a concurrent
duplicate caught by the T-22 index returns the existing "already submitted"
response instead of a 400.

## Done when

- [x] New `backend/services/task_window.py` with
      `is_listed(task, now) -> bool` (active and opened) and
      `is_open(task, now) -> bool` (listed and not closed), per the BOARD.md
      contract. `is_active` null counts as active; null `opens_at`/`closes_at`
      mean no bound; timestamps parse ISO strings with `Z` or an offset; an
      unparseable timestamp makes the task not listed. Unit-tested at the
      boundaries.
- [x] `GET /tasks/` returns only tasks where `is_listed` is true. Closed but
      opened tasks are still listed. Response fields are unchanged.
- [x] `POST /submissions/` loads the task (no more silent fallback when the
      lookup fails): a missing, inactive or unopened task gives 404
      `"Task not found"`; a closed task gives 403
      `"This task is closed."`. Both happen before any storage upload, insert
      or scoring task, and after the rate limiter (unchanged order). A lookup
      error other than "not found" gives 500 without leaking details.
- [x] When the final insert fails with Postgres code `23505` (unique
      violation), the route best-effort removes the uploaded photo, looks up
      the existing non-error submission and returns the same 200 body as the
      pre-check: `{"error": "This task only allows one submission per team.",
"existing_submission_id": ...}`. Other insert errors keep the 400.
- [x] `POST /submissions/{id}/rescore` returns 400 `"submission_id must be a
UUID"` for a non-UUID id without calling Supabase.
- [x] Existing tests in `test_tasks_routes.py` and
      `test_submissions_routes.py` still pass (fixtures updated to give tasks
      an open window where needed).
- [x] Repo checks pass.

## Owns

- backend/services/task_window.py
- backend/routes/tasks.py
- backend/routes/submissions.py
- backend/tests/test_tasks_routes.py
- backend/tests/test_submissions_routes.py

## Deletes

- none

## Reads (not edits)

- backend/auth/team.py (`canonical_team_id`)
- backend/tests/conftest.py
- backend/tests/test_submissions_rescore.py
- app/(tabs)/index.tsx (client window filter, unchanged)
- app/tasks/[id]/submit.tsx (shows a string `detail`; handles the duplicate body)
- tickets/BOARD.md (contract)

## Depends on

- none (runs against the BOARD.md contract; T-22 supplies the index at runtime)

## Specialists

- tests: no
- research: no
- extra: security-auditor
- verify-live: How many tasks have is_active false, opens_at in the future, or closes_at in the past, and does any task have an opens_at later than its closes_at?

## Handoff

Filled in by the worker when finished.

- What changed: new `services/task_window.py` (`is_listed`, `is_open`, hand-rolled
  ISO parser because the venv is Python 3.9; naive timestamps count as UTC;
  `is_active` must be null or `True`). `GET /tasks/` filters with `is_listed`.
  `POST /submissions/` loads the task after the rate limiter: missing, inactive
  or unopened is 404 "Task not found", closed is 403 "This task is closed.",
  other lookup errors are 500 "Could not load the task." (PostgREST `PGRST116`
  from `.single()` counts as missing). A `23505` on the final insert removes the
  photo best-effort and returns the "already submitted" body; if no non-error
  row is found it falls back to the 400. `POST /submissions/{id}/rescore` gives
  400 "submission_id must be a UUID" before touching Supabase and queries with
  the canonical id.
- Interfaces/contracts other tickets rely on: as in BOARD.md. The unit tests for
  the window rules live in `test_tasks_routes.py` (no new test file is in Owns).
- Tests per Done-when item: window rules, `test_window_*` in
  test*tasks_routes.py; list filtering, `test_list_tasks**`; submit 404/403/500,
  `test*post_submission**task*`, `*closed*`, `*lookup*error*`,
`\*rate_limit_runs_before_task_lookup`; duplicate race,
`test_post_submission_duplicate_race**`and`\*other_insert_errors_stay_400`;
rescore, `test_rescore_non_uuid_id_is_400_without_supabase`. Existing tests in
  my two files and test_route_rate_limits.py pass (135 passed); ruff clean.
- Known gaps or follow-ups: `backend/tests/test_submissions_rescore.py` (not in
  my Owns) now fails 14 tests because it posts to `/submissions/sub1/rescore` and
  `/organizer/submissions/sub1/rescore` with non-UUID ids. The organizer cases
  fail because of T-24's `_uuid_or_400` in `routes/organizer.py`, the
  `/submissions/` cases because of this ticket. Its fixtures need real UUIDs
  (`sub1`, `task1`, `team1`); the manager must assign that edit. Verify-live
  question not run.
- Manager to delete: none
- Blocked reason (if blocked): none
