# Board: Team isolation (issue #55)

| ID   | Title                                        | Status      | Mode   | Depends on      | Parallel group |
| ---- | -------------------------------------------- | ----------- | ------ | --------------- | -------------- |
| T-10 | Signed team session token on the backend     | done        | inline | none            | 1              |
| T-13 | Team session and Join team screen in app     | done        | inline | none (contract) | 1              |
| T-11 | Organizer-created teams and invite join      | done        | inline | T-10            | 2              |
| T-12 | Team-scoped submissions, no client paths     | done        | inline | T-10            | 2              |
| T-14 | Submit and Settings use the team session     | done        | inline | T-12, T-13      | 3              |
| T-15 | Task list and detail use the team session    | in-progress | inline | T-12, T-13      | 3              |
| T-16 | Organizer Teams screen                       | done        | inline | T-11            | 3              |
| M-02 | Remove deprecated team-session exports (mgr) | todo        | inline | T-14, T-15      | after 3        |

Concurrency cap: 3

Out of scope: rate limits on join and team create (#56), per-team token
revocation, the leaderboard (still public, shows names and scores only).

Deploy note: the backend needs `TEAM_SESSION_SECRET` set before this ships.
Backend and app must ship together; old app builds stop being able to submit.

## Contract (fixed for all tickets)

- Header: `X-Team-Token: <token>`. Not `Authorization`, because organizer
  routes treat any Bearer as an organizer token.
- 401 detail: `"Invalid or missing team token."`. 500 when unconfigured:
  `"Team access is not configured."`.
- Token: HMAC-SHA256 keyed by `TEAM_SESSION_SECRET`, payload
  `<team_id>:<expiry>:<nonce>`, TTL 7 days. Rotating the secret signs out every
  team.
- `POST /teams/` (organizer) `{name}` -> `{id, name, invite_code}`
- `GET /teams/` (organizer) -> `[{id, name, invite_code, total_score, created_at}]`
- `POST /teams/join` (public) `{invite_code}` ->
  `{team: {id, name}, token, expires_at}`; unknown code -> 404 `"Team not found"`
- `GET /teams/me` (team) -> `{id, name, total_score}`
- Removed: `GET /teams/{id}`, `GET /teams/?invite_code=`
- `POST /submissions/` (team): team from token; `team_id` field optional, 403
  `"Team mismatch."` if different; `photo_path` field removed
- `GET /submissions/?task_id=` (team): token's team only; `team_id` optional,
  403 if different
- `GET /submissions/{id}` (team): other team's row -> 404; signed URL only for
  `{team_id}/{task_id}/<uuid>.<ext>` paths

Decisions log:

- 2026-10-07: T-14 accepted after one review round. Submit errors sit in the
  footer (alert role, announced), the POST has a 45s timeout, and a duplicate
  submission links to the existing one. `AppCard` has no `accessibilityHint`,
  so the Settings team row wraps it in a `Pressable` (loses press-scale).
- 2026-10-07: T-16 accepted after one review round. No clipboard module is
  installed, so invite codes are selectable (press and hold) rather than a
  Copy button; adding `expo-clipboard` is a follow-up (shared `package.json`).
- 2026-10-07: T-11 and T-12 accepted; the joint security audit confirmed all
  three #55 problems closed. Invite codes are ASCII `[A-Z0-9]` only on join.
  Before the event (user action): check every live team has an upper-case
  8-character `invite_code`, and audit old `submissions.photo_url` values that
  don't match `{team_id}/{task_id}/<uuid>.<ext>` (they came from the removed
  `photo_path` field; organizer rescore still downloads them). Query in the
  close-out summary.
- 2026-10-07: T-13 accepted after one review round (UI/UX: inline Leave
  confirmation, full-width 44pt+ buttons, invite code upper-cased client-side,
  wrong code vs connection error shown separately, a11y labels). The app always
  sends upper-case invite codes. Follow-up to file at close: light-mode filled
  buttons (white on `accent` `#E07B18`) are about 3:1 contrast app-wide.
- 2026-10-07: T-10 accepted. From its security audit, `TEAM_SESSION_SECRET`
  must be 32+ characters and differ from `ORGANIZER_DEMO_CODE`, or team routes
  give 500 "not configured" (`/teams/join` hands out signed tokens, so a weak
  secret could be brute-forced offline). Skipped the optional expiry upper bound:
  only the server can sign.
- 2026-10-07: Next batch is #55 only (user). Teams are created by organizers
  only (user). An event is coming, so organizers get a Teams screen listing
  invite codes, and existing teams rejoin with their code (hard cutover, no
  raw `team_id` fallback).
- 2026-10-07: App stores the team session in SecureStore on native and
  AsyncStorage on web. Unlike the organizer token, it persists on web so players
  don't rejoin on every reload; it is team-scoped and expires in 7 days.
- 2026-10-07: Old rows whose `photo_url` came from a client `photo_path` are
  not migrated; `GET /submissions/{id}` just stops signing paths that don't
  match the row's own team and task.
- 2026-10-07: `/team` join screen sits in T-13 because typed routes are on: the
  screens that link to it can't type-check before it exists.

---

## Previous board: Security hardening (issue #53), done

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
