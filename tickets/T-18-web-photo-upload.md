# T-18: Upload a real file for web photo submissions

Status: done
Branch: fix/67-web-photo-upload

## Goal

Photo and combo submissions from the web build upload the picked image as a
real file (issue #67). The native (iOS/Android) upload path is unchanged.

## Done when

- [x] In `app/tasks/[id]/submit.tsx`, when `Platform.OS === 'web'`, the
      `photo` FormData field is a real `Blob`/`File`: the picker result's
      `file` if present, otherwise `await (await fetch(photoAsset.uri)).blob()`.
      It is appended with a filename (`fd.append('photo', blob, name)`), and
      the Blob's type falls back to the existing `type` when the fetched Blob
      has none.
- [x] On iOS/Android the `{ uri, name, type }` object append is unchanged.
- [x] If reading the web image fails, the user sees the screen's existing
      submit-error handling (no unhandled rejection, loading state cleared).
- [x] The Content-Type header is still not set manually.
- [x] Repo checks in CLAUDE.md pass.

## Owns

- app/tasks/[id]/submit.tsx

## Reads (not edits)

- backend/routes/submissions.py (the `photo` UploadFile field)
- backend/services/uploads.py (allowed types)

## Depends on

- none

## Specialists

- tests: no (frontend has no test framework)
- research: no
- extra: none

## Handoff

Changed `app/tasks/[id]/submit.tsx` only. In `onSubmit`, when
`Platform.OS === 'web'` the photo is `photoAsset.file` or a fetched Blob (fetch
uses the submit abort signal); if the Blob has no type it is re-wrapped with the
existing `type`; appended as `fd.append('photo', blob, name)`. Native keeps the
`{ uri, name, type }` append. The read sits inside the existing try, so
failures hit the catch (generic or network message) and the finally clears
loading. Content-Type is still not set.

Checks: tsc, expo lint, prettier pass. No frontend tests exist, so each Done-when
item is verified by code inspection only. Not run in a browser.

Manager edit (unreviewed): the Blob type fallback now also applies when the
fetched Blob has a non-image type (e.g. `application/octet-stream` from a
`blob:` URL), not only an empty one; review minor.
