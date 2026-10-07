# Board: Security hardening (issue #53)

| ID   | Title                                      | Status      | Mode   | Depends on | Parallel group |
| ---- | ------------------------------------------ | ----------- | ------ | ---------- | -------------- |
| M-00 | Install expo-secure-store (manager)        | done        | inline | none       | 1              |
| T-01 | Enable RLS and lock down Storage           | done        | inline | none       | 1              |
| T-02 | Harden organizer auth on the backend       | done        | inline | none       | 1              |
| T-03 | Sanitize error responses and restrict CORS | done        | inline | none       | 1              |
| T-04 | Secure, verified organizer session in app  | in-progress | inline | M-00, T-02 | 2              |
| T-05 | Merge the two organizer route trees        | done        | inline | none       | 2              |
| T-06 | Sanitize scoring errors; CORS parse fixes  | done        | inline | T-03       | 2              |
| T-07 | Validate photo uploads before storing      | done        | inline | T-01, T-02 | 3              |
| T-08 | Return only participant-safe submissions   | todo        | inline | T-07       | 4              |
| M-01 | Push T-01 migration to live DB (manager)   | todo        | inline | T-01       | after T-01     |

Concurrency cap: 3

Out of scope: issue #53 item 6 (team isolation, client `photo_path`, invite code
on `GET /teams/{id}`). The manager opens a separate GitHub issue for it at close-out.

Follow-ups (to file as issues at close-out):

- Item 6 team isolation, plus client `photo_path` and the invite code returned by `GET /teams/{id}`.
- Organizer review screen uses the raw storage path as the image URI; needs
  `photo_signed_url` from `GET /organizer/review-queue`.
- Delete dead `lib/supabase.ts` and remove `@supabase/supabase-js` and the
  `EXPO_PUBLIC_SUPABASE_*` env vars.
- Upload bodies are parsed before auth: add a request body cap (middleware or proxy).
- Unauthenticated `POST /submissions/` triggers paid AI scoring with no rate limit;
  invite-code lookup can be brute-forced.
- Disable `/docs` and `/openapi.json` and drop `env` from `/health` in production.
- `replace_task_criteria` deletes then inserts without a transaction.
- Disable Auth signup in the hosted Supabase project settings (user action).
- Organizer token key: slow KDF (`pbkdf2_hmac`/`scrypt`) and/or optional
  `ORGANIZER_SESSION_SECRET`, startup warning on codes under 12 characters.
- Organizer limiter: global failure ceiling, key IPv6 by /64, evict non-blocked
  IPs first at the cap, log blocks (IP and time only), document proxy trust
  (never `--forwarded-allow-ips="*"`).
- Organizer token revocation or logout (today only rotating the code works).
- Validate `queue_id`/`submission_id` as UUIDs (400 instead of 500).
- `services/scoring.py` `_mime_type_from_path` uses `mimetypes`, which on
  Python 3.9 labels `.heic`/`.heif` photos as JPEG for the vision model.
- The one-submission-per-team-task check is not atomic and no unique
  constraint backs it (dropped in `20260425010000`); concurrent submits can both
  pass. Needs a partial unique index excluding `status = 'error'`.

Decisions log:

- 2026-10-07: T-07: any `status = 'error'` submission (failed upload or failed
  scoring) no longer blocks a resubmit (issue #41). Uploads are validated to
  the bucket limits before any row or upload, and `upsert` is no longer used.

- 2026-10-07: T-02 accepted without a third round. Review and audit found no
  blockers; hardening items (KDF, limiter, revocation) are follow-up issues.
  `POST /organizer/session` must be sent with the code only: any Bearer header
  gives 401, so the app drops a stale token before signing in again.

- 2026-10-07: T-01 migration does not include the unscoped
  `alter default privileges for role postgres revoke execute on functions from public`
  (it would also hit future extension functions in other schemas). New functions
  in `public` need an explicit revoke in their own migration. The migration has
  not been executed anywhere yet; M-01 needs a dry run first.

- 2026-10-07: T-08 added from T-06 review: participant submission endpoints
  return `ai_result`, which includes the exact-match answer and raw model output.

- 2026-10-07: T-07 added from T-01 audit: bucket MIME/size limits also apply to
  service-role uploads, so the backend validates first, and error rows no longer
  block a resubmit (also addresses issue #41).

- 2026-10-07: Replaces the `GET /organizer/session` decision below. After the
  T-02 review, the organizer code is exchanged once for a 24h HMAC-signed token
  (`POST /organizer/session`), and organizer routes accept `Authorization: Bearer`.
  Only raw code checks are rate-limited, and a missing header doesn't count, so
  someone on shared venue Wi-Fi can't lock out signed-in organizers. The app
  stores the token, never the code.

- 2026-10-07: T-06 added from T-03 review: `services/scoring.py` stores raw
  AI/storage exception text in `rationale`/`ai_result`, readable via
  `GET /submissions/{id}`.

- 2026-10-07: Item 6 (team isolation) split into its own issue; team UUIDs are
  public via the leaderboard, so it needs a real team credential.
- 2026-10-07: The app makes no direct Supabase calls (photos go through the
  backend, which uses the service-role key). RLS goes on every table with no
  anon policies; unused `lib/storage.ts` direct upload is removed.
- 2026-10-07: Live migration is pushed by the manager with `supabase db push`
  only after the user approves in chat.
- 2026-10-07: Organizer rate limit is in-memory (no new dependency), keyed by
  client IP, counting failed code checks only: 10 failures per 5 minutes gives
  429 for that IP until the window passes.
- 2026-10-07: `GET /organizer/session` (guarded, returns `{"ok": true}`) is the
  verification endpoint the app calls on code entry and on restore.
- 2026-10-07: CORS origins come from `CORS_ALLOW_ORIGINS` (comma-separated),
  defaulting to local Expo web origins. Native apps don't send Origin.
- 2026-10-07: `app/(tabs)/organizer` is the single organizer route tree;
  `app/organizer` is removed.
