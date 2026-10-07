# T-09: Hide the task rubric from `GET /tasks/`

Status: done
Branch: t-09-hide-task-rubric

## Goal

The public task list returns only the columns the app needs, so a task's
`rubric` can't be read by participants.

## Done when

- [x] `GET /tasks/` selects an explicit column list (`id`, `title`,
      `description`, `type`, `max_points`, `is_active`, `opens_at`,
      `closes_at`, `allow_multiple_submissions`, `created_at`) and filters each
      row to that list in Python as well. `rubric` is never returned.
- [x] The app's `Task` types in `app/(tabs)/index.tsx` and
      `app/tasks/[id]/submit.tsx` only use returned fields.
- [x] Organizer task reads (`/organizer/tasks/{id}`) are unchanged.
- [x] A test asserts `rubric` is absent and the selected columns match.
- [x] Repo checks pass.

## Owns

- backend/routes/tasks.py
- backend/tests/test_tasks_routes.py (new)

## Reads (not edits)

- app/(tabs)/index.tsx
- app/tasks/[id]/submit.tsx
- supabase/migrations/20260425000000_create_tasks_teams_submissions.sql

## Depends on

- T-08 (found in its security audit)

## Specialists

- tests: no
- research: no
- extra: none

## Handoff

- What changed: `backend/routes/tasks.py` uses `_PUBLIC_TASK_FIELDS` for the
  select and re-filters rows; new `backend/tests/test_tasks_routes.py`. Done by
  the manager (too small to delegate).
- Interfaces/contracts other tickets rely on: `GET /tasks/` returns only the
  fields listed above.
- Known gaps or follow-ups: inactive or unopened tasks are still listed
  (server-side window enforcement is on the board).
- Blocked reason (if blocked): none.
