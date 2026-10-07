# T-17: Score and show only server-generated photo paths

Status: done
Branch: t-17-shared-photo-path-check

## Goal

Scoring and the organizer review routes use a submission's `photo_url` only
when it is a server-generated `{team_id}/{task_id}/<uuid>.<ext>` path for that
row's own team and task (issue #68).

## Done when

- [ ] The path check now in `_signable_photo_path` (`backend/routes/submissions.py`)
      lives in one shared helper in `backend/services/photo_paths.py`, taking
      `(photo_url, team_id, task_id)` and returning the path or `None`. It keeps
      the current rules: canonical lowercase UUIDs from the row's own ids, a
      UUID filename, extensions from `ALLOWED_IMAGE_TYPES` plus legacy `jpeg`,
      and `re.fullmatch`. `GET /submissions/{id}` uses the helper and behaves
      the same as before (existing tests still pass unchanged).
- [ ] `score_submission` (`backend/services/scoring.py`) checks `photo_path`
      against the submission's `team_id`/`task_id` before any storage
      download. A path that doesn't match is not downloaded or sent to a
      model: the submission is scored as if it had no photo, and a warning is
      logged with the submission id (not the path). This covers auto-scoring,
      `POST /submissions/{id}/rescore` and the organizer rescore, since all of
      them call `score_submission`.
- [ ] Organizer review responses in `backend/routes/organizer.py` (the review
      queue and the history list, every place that returns
      `submission.photo_url`) return the path only if it passes the helper,
      otherwise `null`. Response shapes don't change.
- [ ] Tests: the helper (own path, `.jpeg` legacy, other team's folder, other
      task's folder, upper-case or non-canonical UUIDs, traversal like
      `../`, extra segments, non-string or empty values); scoring with a
      foreign path does no download and no vision call; an organizer review
      row with a foreign path returns `photo_url: null`.
- [ ] Repo checks in CLAUDE.md pass.

## Owns

- backend/services/photo_paths.py (new)
- backend/services/scoring.py
- backend/routes/submissions.py
- backend/routes/organizer.py
- backend/tests/test_photo_paths.py (new)
- backend/tests/test_scoring.py
- backend/tests/test_submissions_rescore.py
- backend/tests/test_organizer_gating.py

## Reads (not edits)

- backend/auth/team.py (`canonical_team_id`)
- backend/services/uploads.py (`ALLOWED_IMAGE_TYPES`)
- backend/tests/conftest.py, backend/tests/test_submissions_routes.py
- app/(tabs)/organizer/review.tsx, app/(tabs)/organizer/history.tsx (how
  `photo_url` is used; app is not edited)
- tickets/BOARD.md (team contract)

## Depends on

- none

## Specialists

- tests: yes
- research: no
- extra: security-auditor (AI input handling, cross-team data)

## Handoff

Filled in by the ticket thread when finished.

- What changed: New `backend/services/photo_paths.py` with
  `server_photo_path(photo_url, team_id, task_id) -> Optional[str]` (rules moved
  unchanged from `_signable_photo_path`, which is removed).
  `GET /submissions/{id}` calls it. `score_submission` checks `photo_path`
  right after the idempotency check and task fetch, before any download: a
  non-matching path logs a warning with the submission id only and is scored
  as if there were no photo (text-only, or the existing "empty_submission"
  error if there is no text either). Organizer `review-queue` and
  `review-history` (both the joined-table and the submissions fallback) return
  `submission.photo_url` as `null` unless it passes the helper; shapes are
  unchanged. Tests: new `test_photo_paths.py`; `test_scoring.py` (foreign
  paths do no download and no vision call; own path still does) and
  `test_organizer_gating.py` (queue, history, fallback). `test_scoring.py`
  fixtures now use real UUIDs for team/task because the old `team1/task1/...`
  path no longer passes the check. `test_submissions_rescore.py` needed no
  change: the rescore routes pass the row through to `score_submission`.
- Interfaces/contracts other tickets rely on: `services.photo_paths.server_photo_path`
  is the single place for the photo path rule. `score_submission` ignores any
  non-server-generated `photo_path`.
- Known gaps or follow-ups: The organizer fake `_Query` in
  `test_organizer_gating.py` gained a no-op `limit()`. Organizer rescore of a
  row with a foreign path still queues and then scores text-only (by design).
  Checks run: ruff clean, pytest 414 passed.
- Blocked reason (if blocked): none
