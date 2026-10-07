# T-08: Return only participant-safe submission fields

Status: done
Branch: t-08-participant-safe-submissions

## Goal

Participant submission endpoints stop exposing scoring internals (answers,
criteria, raw model output) that a team could use to cheat.

## Done when

- [x] `GET /submissions/{id}` and `GET /submissions/?team_id=` return an explicit
      allowlist of fields: `id`, `task_id`, `team_id`, `text_answer`, `status`,
      `score`, `rationale`, `created_at`, plus `photo_signed_url` for the detail
      route. `ai_result`, `confidence`, `gpt4o_description` and the raw
      `photo_url` path are not returned.
- [x] `rationale` shown to participants can't contain the expected answer or
      criteria text: check what `services/scoring.py` writes there for exact-match
      and rubric scoring, and if it can, return a fixed participant message per
      status instead. Report what you found in the hand-off.
- [x] Organizer endpoints are unchanged and still return the full data.
- [x] Every app screen that reads these fields still works: check
      `app/submissions/[id].tsx` and `app/(tabs)/index.tsx` for use of removed
      fields. If one needs to change, stop and mark the ticket blocked rather
      than editing outside Owns.
- [x] Tests assert that removed fields are absent, using a row that has an
      exact-match answer in `ai_result.criteria`.
- [x] Repo checks pass.

## Owns

- backend/routes/submissions.py
- backend/tests/test_submissions_routes.py

## Reads (not edits)

- backend/services/scoring.py
- backend/routes/organizer.py
- app/submissions/[id].tsx
- app/(tabs)/index.tsx

## Depends on

- T-07 (needs: final `backend/routes/submissions.py`, committed)

## Specialists

- tests: yes
- research: no
- extra: security-auditor

## Handoff

Filled in by the ticket thread when finished.

- What changed: `backend/routes/submissions.py`: `GET /submissions/{id}` and
  `GET /submissions/?team_id=` now select and return only `id`, `task_id`,
  `team_id`, `text_answer`, `status`, `score`, `rationale`, `created_at`
  (plus `photo_signed_url` on the detail route). The projection is also applied
  in Python (`_participant_view`), so extra columns never leak even if the
  select changes. `photo_url` is fetched on the detail route only to sign it,
  then dropped. `rationale` is replaced with a fixed message per status (see
  below). Tests in `backend/tests/test_submissions_routes.py`: updated the old
  detail test (no longer expects `photo_url`) and added tests using a row with
  an exact-match answer in `ai_result.criteria` and `gpt4o_description`,
  asserting removed fields are absent and the secret never appears.
  Ruff clean; pytest 177 passed.
- Rationale findings (`services/scoring.py`): exact match writes the constant
  "Exact match" (safe, but `ai_result.criteria` holds the answer). LLM scoring
  writes free model text, generated from a prompt listing all criteria for the
  task, so it can quote the expected answer or rubric: unsafe. Error paths write
  fixed generic strings. Because of the LLM case, participants now get a fixed
  message by status: approved/auto_approved "Your submission was approved.",
  reviewed "An organizer reviewed your submission.", flagged "Your submission
  is awaiting organizer review.", error "Please try again.", pending/unknown
  null. The stored rationale is unchanged.
- Interfaces/contracts other tickets rely on: participant responses no longer
  contain `confidence`, `ai_result`, `gpt4o_description`, `photo_url`.
  `rescore` and organizer routes untouched. Frontend check: `app/(tabs)/index.tsx`
  uses only `id` and `status` from the list. `app/submissions/[id].tsx` reads
  `confidence` (already null-safe; the confidence bar simply stops rendering,
  now permanently for participants) and `rationale` (hidden when empty; error
  state renders "We hit an error processing your submission: Please try
  again."). No edit needed. The rationale card is still labelled "AI
  rationale" though it now holds a fixed status message; a UI follow-up could
  relabel it or drop the dead confidence block.
- Known gaps or follow-ups: `score` is still returned for `flagged` rows, where
  it is an unreviewed model score (ticket allowlist includes score; confirm that
  is intended). Both endpoints remain unauthenticated and keyed only by id /
  `team_id` (out of scope here). security-auditor not run.
- Blocked reason (if blocked): n/a

Manager note at acceptance: participants now get `score: null` unless status is
`approved`, `auto_approved` or `reviewed`. A flagged score is an unreviewed
model score and would act as a rubric oracle on multi-submission tasks.
`GET /tasks/` exposing `rubric` (found in the security audit) is T-09.
