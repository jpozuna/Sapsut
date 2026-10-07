# Board: Security hardening (issue #53)

| ID   | Title                                      | Status | Mode   | Depends on | Parallel group |
| ---- | ------------------------------------------ | ------ | ------ | ---------- | -------------- |
| M-00 | Install expo-secure-store (manager)        | done   | inline | none       | 1              |
| T-01 | Enable RLS and lock down Storage           | done   | inline | none       | 1              |
| T-02 | Harden organizer auth on the backend       | done   | inline | none       | 1              |
| T-03 | Sanitize error responses and restrict CORS | done   | inline | none       | 1              |
| T-04 | Secure, verified organizer session in app  | done   | inline | M-00, T-02 | 2              |
| T-05 | Merge the two organizer route trees        | done   | inline | none       | 2              |
| T-06 | Sanitize scoring errors; CORS parse fixes  | done   | inline | T-03       | 2              |
| T-07 | Validate photo uploads before storing      | done   | inline | T-01, T-02 | 3              |
| T-08 | Return only participant-safe submissions   | done   | inline | T-07       | 4              |
| T-09 | Hide task rubric from `GET /tasks/`        | done   | inline | T-08       | 5              |
| M-01 | Push T-01 migration to live DB (manager)   | done   | inline | T-01       | after T-01     |

Concurrency cap: 3

Out of scope: issue #53 item 6 (team isolation), now #55.

Follow-ups (filed 2026-10-07):

- #55 Team isolation: team credential and validated `photo_path` (high priority)
- #56 Abuse limits: submission, invite-code and team-create rate limits, body cap
- #57 Organizer auth hardening: token key, limiter, revocation, https
- #58 Submission integrity and production hardening
- #59 Organizer screens: remove leftover code field, signed review images
- #60 Participant submission screen: rationale label, confidence, feedback
- #61 Cleanups: dead Supabase client, SecureStore retry, HEIC MIME in scoring

Auth signup in the hosted Supabase project is disabled (user, 2026-10-07).

Decisions log:

- 2026-10-07: M-01 done. The user pushed `20261007000000` to the live project;
  `supabase migration list` shows it applied on the remote. Follow-ups filed as
  #55-#61.

- 2026-10-07: T-04 accepted after two rounds. The app stores only the session
  token (SecureStore on native, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; memory only on
  web), verifies it on launch with a 10s timeout, and any 401 or missing/expired
  token drops to participant. The three organizer screens keep a compatibility
  shim until their cleanup ticket.

- 2026-10-07: T-08: participants see only allowlisted submission fields, a fixed
  rationale per status, and `score` only once final (`approved`,
  `auto_approved`, `reviewed`). T-09 added from the T-08 audit: `GET /tasks/`
  returns `rubric` via `select("*")`.

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
