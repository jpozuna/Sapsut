# Board: Security hardening (issue #53)

| ID   | Title                                      | Status | Mode   | Depends on | Parallel group |
| ---- | ------------------------------------------ | ------ | ------ | ---------- | -------------- |
| M-00 | Install expo-secure-store (manager)        | done   | inline | none       | 1              |
| T-01 | Enable RLS and lock down Storage           | todo   | inline | none       | 1              |
| T-02 | Harden organizer auth on the backend       | todo   | inline | none       | 1              |
| T-03 | Sanitize error responses and restrict CORS | todo   | inline | none       | 1              |
| T-04 | Secure, verified organizer session in app  | todo   | inline | M-00, T-02 | 2              |
| T-05 | Merge the two organizer route trees        | todo   | inline | none       | 2              |
| M-01 | Push T-01 migration to live DB (manager)   | todo   | inline | T-01       | after T-01     |

Concurrency cap: 3

Out of scope: issue #53 item 6 (team isolation, client `photo_path`, invite code
on `GET /teams/{id}`). The manager opens a separate GitHub issue for it at close-out.

Decisions log:

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
