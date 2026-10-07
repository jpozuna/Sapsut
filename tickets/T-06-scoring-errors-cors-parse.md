# T-06: Sanitize scoring errors and harden CORS parsing

Status: done
Branch: t-06-scoring-errors-cors-parse

## Goal

The scoring pipeline no longer stores raw exception text where participants can
read it, and CORS origin parsing handles common config mistakes.

## Done when

- [ ] Every `_mark_submission_error` caller in `backend/services/scoring.py`
      stores a fixed, generic message in `rationale` and `ai_result.error` (for
      example "Photo could not be read", "Scoring failed"), and logs the real
      exception with `logging` (`logger.exception`). No `{e}`, `str(e)` or
      `photo_path=` text ends up in a submission row.
- [ ] `print(...)` calls in `scoring.py` that report errors use `logging` instead.
- [ ] `ai_result` may keep a short machine-readable `mode`/stage field (for
      example `"mode": "storage_download"`) so organizers can tell failure stages
      apart, but never the exception text.
- [ ] `backend/main.py` `_cors_origins()` strips a trailing `/` from each origin,
      and logs a warning at startup if the resulting allowlist is empty.
- [ ] Tests: each failure stage in `score_submission` (storage download, image
      description, embedding, invalid JSON, generic exception) is exercised with an
      exception carrying a sentinel string, and the stored row contains neither the
      sentinel nor the photo path. CORS tests cover the trailing slash and the
      empty-allowlist warning.
- [ ] Repo checks pass.

## Owns

- backend/services/scoring.py
- backend/main.py
- backend/tests/test_scoring.py
- backend/tests/test_cors.py

## Reads (not edits)

- backend/routes/submissions.py
- backend/routes/organizer.py
- backend/tests/test_submissions_rescore.py
- backend/tests/conftest.py

## Depends on

- T-03 (needs: `_cors_origins()` in `backend/main.py` and the generic-error
  convention: log with `logger.exception`, return or store a fixed string)

## Specialists

- tests: yes
- research: no
- extra: none

## Handoff

Filled in by the ticket thread when finished.

- What changed: `services/scoring.py` now uses `logger.exception` for every
  failure stage and stores fixed strings only. Stages and stored values:
  `storage_download` ("Photo could not be read"), `gpt4o_describe` ("Photo could
  not be analyzed"), `embed_submission` and `exception` ("Scoring failed"),
  `invalid_json` (status still `flagged`, score None, rationale "Scoring output
  was invalid"; `ai_result` keeps `raw_text` (model output) and
  `retrieved_criteria`, and gains `mode: "invalid_json"`). `photo_path` is no
  longer in `ai_result`. The `print` is gone. `main.py` `_cors_origins()` strips
  trailing `/` and logs a startup warning when the allowlist is empty. Tests
  added in `test_scoring.py` (5 failure stages with sentinel and photo path) and
  `test_cors.py` (trailing slash, empty-allowlist warning, no warning when set).
  pytest: 87 passed; ruff clean.
- Interfaces/contracts other tickets rely on: `ai_result.mode` values above are
  stable stage identifiers; `ai_result.error` is always a fixed generic string.
- Known gaps or follow-ups: `ai_result.raw_text` (Claude output) is still stored
  on invalid JSON; it is model output, not exception text. The Claude call is not
  in its own try block, so its failures land in the `exception` stage.
- Blocked reason (if blocked): none

Don't change scoring behavior (scores, thresholds, statuses, auto-approve);
only what gets stored or logged on failure.
