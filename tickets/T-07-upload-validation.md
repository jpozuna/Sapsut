# T-07: Validate photo uploads before storing them

Status: done
Branch: t-07-upload-validation

## Goal

The backend rejects unsupported or oversized photos with a clear 4xx before
creating any row, so the private bucket's limits (T-01) can't leave a team
stuck with an error submission.

## Done when

- [x] A shared helper (for example `backend/services/uploads.py`) normalizes the
      content type (`image/jpg` to `image/jpeg`, lowercase, strip parameters),
      allows only `image/jpeg`, `image/png`, `image/webp`, `image/heic` and
      `image/heif`, and enforces a 10 MB limit. The file extension comes from
      the normalized type, never from the client. Limits match the bucket in
      `supabase/migrations/20261007000000_enable_rls_lockdown.sql`.
- [x] `POST /submissions/` returns 415 for a disallowed type and 413 for an
      oversized photo, with a short, clear `detail`. No `submissions` row is
      created and nothing is uploaded.
- [x] The single-submission check in `POST /submissions/` ignores rows with
      `status = 'error'`, so a team whose upload failed can submit again
      (issue #41).
- [x] `POST /organizer/tasks/{task_id}/photos` uses the same helper (415/413,
      nothing stored), and its storage upload no longer uses `upsert: "true"`.
- [x] `POST /organizer/tasks/{task_id}/rubric-ocr` checks the type and size with
      the same helper before calling OCR.
- [x] Tests cover allowed types (including `image/jpg` normalization), a
      disallowed type, an oversized body, no row or upload on rejection, and a
      resubmit after an error row.
- [x] Repo checks pass.

## Owns

- backend/services/uploads.py (new)
- backend/routes/submissions.py
- backend/routes/organizer.py
- backend/tests/test_uploads.py (new)
- backend/tests/test_submissions_routes.py

## Reads (not edits)

- supabase/migrations/20261007000000_enable_rls_lockdown.sql
- backend/services/storage.py
- backend/tests/test_organizer_gating.py
- app/tasks/[id]/submit.tsx
- app/(tabs)/organizer/create-task.tsx

## Depends on

- T-02 (needs: final `backend/routes/organizer.py`, committed)
- T-01 (needs: bucket size and MIME limits, final)

## Specialists

- tests: yes
- research: no
- extra: none

## Handoff

Filled in by the ticket thread when finished.

- What changed: New `backend/services/uploads.py` with `read_validated_image(upload)`
  (415 disallowed type, 413 over 10 MB, 400 empty; reads at most 10 MB + 1 byte;
  returns `ValidatedImage(data, content_type, ext)`), `normalize_content_type`,
  `MAX_UPLOAD_BYTES`, `ALLOWED_IMAGE_TYPES`. Extensions: jpg, png, webp, heic, heif
  (jpeg is now `.jpg`, was `.jpeg`). `POST /submissions/` validates before upload
  or insert, drops `upsert`, and the single-submission check uses
  `.neq("status", "error")`. Organizer `/photos` and `/rubric-ocr` use the helper;
  `/photos` no longer upserts; OCR now sends the validated content type (was guessed
  from filename) and the unused `_mime_type_from_filename` and `mimetypes` import
  were removed. Tests added in `test_uploads.py` and `test_submissions_routes.py`
  (fake gained `neq`). Ruff clean, 169 tests pass.
- Interfaces/contracts other tickets rely on: Upload rejections are 415/413 with a
  string `detail`; no row or storage object is created on rejection. An upload
  failure during storage still yields a 200 with `status: "error"` and an error row,
  which no longer blocks a resubmit.
- Known gaps or follow-ups: Starlette still spools the multipart body to temp
  storage before the route runs, so a huge body is bounded at read but not at
  receipt (needs a proxy or middleware limit). Empty photo is now 400 for
  `POST /submissions/` (previously uploaded zero bytes). HEIC/HEIF are accepted
  for OCR as well, which OpenAI vision may not support (fails as generic 400 "OCR failed").
- Blocked reason (if blocked): none

Don't change participant team-isolation behavior (`team_id` trust, client
`photo_path`); that's a separate issue. Don't change the app; the app already
sends an image MIME type.
