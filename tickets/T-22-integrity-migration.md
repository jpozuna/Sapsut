# T-22: Migration for one-submission index and atomic criteria replace

Status: done
Branch: fix/58-submission-integrity

## Goal

One new migration makes "one non-error submission per team and task"
database-enforced for single-submission tasks and adds an atomic
`replace_task_criteria` RPC, exactly as in the BOARD.md contract.

## Done when

- [x] New file `supabase/migrations/20261014000000_submission_integrity.sql`
      adds `submissions.single_submission boolean not null default true` and
      backfills it from `tasks.allow_multiple_submissions` for existing rows
      (`single_submission = not coalesce(allow_multiple_submissions, false)`).
- [x] A `BEFORE INSERT OR UPDATE OF task_id` trigger on `public.submissions`
      sets `new.single_submission` from the row's task, ignoring any value the
      client sent; a missing task leaves it `true`.
- [x] Before creating the index, a `do $$` block raises an exception with
      the duplicate count if any `(team_id, task_id)` has more than one row
      where `single_submission and status <> 'error'`, so the migration fails
      loudly instead of half-applying.
- [x] Creates the unique partial index
      `submissions_one_active_per_team_task_idx` on
      `public.submissions (team_id, task_id) where single_submission and status <> 'error'`.
- [x] Creates `public.replace_task_criteria(p_task_id uuid, p_criteria jsonb)
returns setof public.task_criteria` (plpgsql, `security invoker`,
      `set search_path = public`) that deletes the task's criteria and inserts
      one row per array element (`criteria_type`, `value`) in a single
      function call, so a failed insert rolls back the delete. Raises when the
      task does not exist. An empty array clears criteria.
- [x] Every new function (trigger function and RPC) has
      `revoke execute ... from public, anon, authenticated` and
      `grant execute ... to service_role`, as the RLS lockdown migration
      requires.
- [x] The migration is idempotent (`if not exists`, `create or replace`,
      `drop trigger if exists`) and applies cleanly on top of the existing
      migrations (`supabase db reset` locally if available; otherwise state in
      the handoff that it was reviewed by reading only).
- [x] Repo checks pass.

## Owns

- supabase/migrations/20261014000000_submission_integrity.sql

## Deletes

- none

## Reads (not edits)

- supabase/migrations/20260425000000_create_tasks_teams_submissions.sql
- supabase/migrations/20260425010000_align_schema_for_scoring.sql
- supabase/migrations/20260425081000_add_task_criteria_embedding.sql
- supabase/migrations/20261007000000_enable_rls_lockdown.sql
- backend/routes/organizer.py (current `replace_task_criteria`)
- tickets/BOARD.md (contract)

## Depends on

- none

## Specialists

- tests: no
- research: no
- extra: security-auditor
- verify-live: On tasks with allow_multiple_submissions false, does any (team_id, task_id) pair have more than one submission whose status is not 'error'?

## Handoff

Filled in by the worker when finished.

- What changed: added `supabase/migrations/20261014000000_submission_integrity.sql`
  (column + backfill only when the column is first added, BEFORE INSERT OR
  UPDATE OF task_id trigger, duplicate-count guard, unique partial index,
  `replace_task_criteria` RPC, revoke/grant on both functions).
- Interfaces/contracts other tickets rely on: exactly as in BOARD.md. RPC
  raises on a missing task, a null or non-array `p_criteria`; a bad row
  (null type, check violation) rolls back the delete. Locks the task row
  (`for update`) to serialize concurrent replaces. Returned rows include the
  `embedding` column (null).
- Tests per Done-when item: none runnable (no frontend or backend test for
  SQL). Docker was not running, so `supabase db reset` was not run; the
  migration was reviewed by reading only. `npx prettier` does not cover `.sql`.
- Known gaps or follow-ups: M-01 must apply it live; the duplicate guard will
  abort if live data has duplicates (verify-live question).
- Manager to delete: none
- Blocked reason (if blocked): none
