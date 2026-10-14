# T-24: Production hardening and atomic criteria replace

Status: done
Branch: fix/58-submission-integrity

## Goal

Production hides API docs and the environment name, organizer routes reject
malformed ids with 400, and `PUT /organizer/tasks/{task_id}/criteria` replaces
criteria through the T-22 RPC in one call.

## Done when

- [x] `backend/main.py`: when `ENV` (trimmed, case-insensitive) is `prod` or
      `production`, the app is created with `docs_url=None`, `redoc_url=None`
      and `openapi_url=None`, so `/docs`, `/redoc` and `/openapi.json` return 404. With `ENV` unset or `dev` they still work.
- [x] `GET /health` returns exactly `{"status": "ok"}` in every environment.
- [x] Organizer routes with `{queue_id}` (approve, override) and
      `{submission_id}` (rescore) return 400 `"<name> must be a UUID"` for a
      non-UUID id without calling Supabase; `{task_id}` routes do the same
      with `"task_id must be a UUID"`. Valid ids are passed on in canonical
      form.
- [x] `replace_task_criteria` makes exactly one call,
      `supabase.rpc("replace_task_criteria", {"p_task_id": ..., "p_criteria": [{"criteria_type": ..., "value": ...}]})`,
      and no `task_criteria` delete or insert. The response stays
      `{"task_id": ..., "inserted": [...]}`; an RPC error gives 400
      `"Failed to save task criteria"` without leaking details.
- [x] Existing tests in `test_organizer_gating.py` and `test_cors.py` still
      pass (the two criteria error tests updated to the RPC path).
- [x] Repo checks pass.

## Owns

- backend/main.py
- backend/routes/organizer.py
- backend/tests/test_organizer_gating.py
- backend/tests/test_production_hardening.py
- backend/tests/test_submissions_rescore.py

## Deletes

- none

## Reads (not edits)

- backend/auth/team.py (`canonical_team_id`)
- backend/tests/conftest.py
- backend/tests/test_cors.py
- app/(tabs)/organizer/create-task.tsx (criteria PUT caller)
- tickets/BOARD.md (contract)

## Depends on

- none (runs against the BOARD.md contract; T-22 supplies the RPC at runtime)

## Specialists

- tests: no
- research: no
- extra: security-auditor
- verify-live: none

## Handoff

Filled in by the worker when finished.

- What changed: `main.py` builds the app without docs/redoc/openapi when `ENV`
  (trimmed, lowercased) is `prod`/`production`; `/health` returns only
  `{"status": "ok"}`. `routes/organizer.py` has `_uuid_or_400(name, value)`
  (uses `auth.team.canonical_team_id`), applied to every `{task_id}`,
  `{queue_id}` and `{submission_id}` route before `get_supabase()`; handlers use
  the canonical id. `replace_task_criteria` is one
  `supabase.rpc("replace_task_criteria", {"p_task_id", "p_criteria"})` call;
  error gives 400 "Failed to save task criteria". The old direct ids in
  `test_organizer_gating.py` fakes (`rq1`, `sub1`, `task1`) became UUIDs, since
  non-UUID path ids now 400; the two criteria error tests use the RPC path.
- Interfaces/contracts other tickets rely on: needs T-22's
  `replace_task_criteria` RPC at runtime (tests use fakes).
- Tests per Done-when item: `test_production_hardening.py`
  (`test_docs_hidden_in_production`, `test_docs_available_outside_production`,
  `test_health_is_exactly_status_ok`,
  `test_malformed_ids_give_400_without_calling_supabase`,
  `test_valid_ids_are_passed_on_in_canonical_form`,
  `test_criteria_replace_is_a_single_rpc_call`); `test_organizer_gating.py`
  (`test_criteria_rpc_error_is_generic`, `test_criteria_rpc_execute_error_is_generic`).
- Known gaps or follow-ups: none. `test_submissions_rescore.py` (added to
  Owns) now uses a UUID `_SUB1` in URLs, fixture rows and `submission_id`
  assertions; no assertion was weakened. Full backend suite: 557 passed; ruff
  clean.
- Manager to delete: none
- Blocked reason (if blocked): none
