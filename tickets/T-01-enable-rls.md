# T-01: Enable RLS and lock down Storage

Status: done
Branch: t-01-enable-rls

## Goal

A new migration turns on row-level security for every public table and makes
the submission photo bucket private with no anon access. Nothing the app does
breaks.

## Done when

- [x] New migration `supabase/migrations/20261007000000_enable_rls_lockdown.sql` exists
      and is idempotent (safe to run twice, uses `if exists` for tables that are
      only in the live DB: `task_photos`, `review_queue_history`).
- [x] RLS is enabled (and forced is not required) on `teams`, `tasks`,
      `task_criteria`, `submissions`, `review_queue`, `task_photos`,
      `review_queue_history`, and any other table created by the migrations in
      `supabase/migrations/`.
- [x] Any existing policies on those tables are dropped (for example a `DO` block
      over `pg_policies`), and no new policy grants `anon` or `authenticated`
      access.
- [x] Storage bucket `submission-photos` is set `public = false`, with a file size
      limit (10 MB) and allowed MIME types (jpeg, png, webp, heic, heif).
      Existing `storage.objects` policies for that bucket that grant anon or
      authenticated access are dropped. The backend only uses signed URLs (no
      `get_public_url`), so a private bucket is fine.
- [x] `lib/storage.ts` (unused direct anon upload) is deleted, and nothing
      imports it. If `lib/supabase.ts` then has no callers, report that in the
      hand-off; don't delete it.
- [x] A comment at the top of the migration says the backend uses the
      service-role key (bypasses RLS) and the app must never query Supabase
      directly with the anon key.
- [x] Repo checks pass.

### Review round 2 (from security audit)

- [x] Views and functions: the migration revokes `anon` and `authenticated`
      privileges on all tables (including views, materialized views and foreign
      tables), sequences and functions in `public`, and revokes function
      `EXECUTE` from `public`. It also sets `alter default privileges` (for role
      `postgres`) so future tables and functions in `public` don't grant those
      roles anything. `service_role` keeps its grants.
- [x] Storage: replace the `like '%bucket_id%'` heuristic. Drop every policy on
      `storage.objects` and `storage.buckets` whose roles overlap
      `anon`, `authenticated` or `public`, then assert none remain
      (`raise exception` if any do). Leave policies for other roles alone.
- [x] `supabase/config.toml`: auth signups disabled (`enable_signup = false`
      wherever it is `true`), because the app doesn't use Supabase Auth.
- [x] The migration stays idempotent, and the header comment notes that
      `alter default privileges` assumes migrations run as `postgres`.

## Owns

- supabase/migrations/20261007000000_enable_rls_lockdown.sql (new)
- lib/storage.ts (delete)
- supabase/config.toml

## Reads (not edits)

- supabase/migrations/
- supabase/config.toml
- backend/services/
- backend/routes/
- lib/supabase.ts

## Depends on

- none

## Specialists

- tests: no
- research: no
- extra: security-auditor

## Handoff

Filled in by the ticket thread when finished.

- What changed (round 1): `supabase/migrations/20261007000000_enable_rls_lockdown.sql`
  (idempotent) enables RLS on every ordinary/partitioned table in `public` via
  a loop, plus explicit `if exists` statements for the known tables including
  `task_photos` and `review_queue_history`. It drops all existing `public`
  policies and creates none. It upserts the `submission-photos` bucket as
  private, 10 MB limit, jpeg/png/webp/heic/heif only. `lib/storage.ts` is
  deleted (staged by the manager) and nothing imports it.
- What changed (round 2, security audit):
  - Storage: the `like '%bucket_id%'` heuristic is gone. The migration drops
    every policy on `storage.objects` and `storage.buckets` whose roles overlap
    `anon`, `authenticated` or `public`, then a `DO` block raises an exception
    if any remain. Policies for other roles are untouched.
  - Privileges: revokes all on all tables (this includes views, materialized
    views and foreign tables) and all sequences in `public` from
    `anon, authenticated`; revokes `EXECUTE` on all functions and procedures in
    `public` from `public, anon, authenticated`. Then re-grants everything in
    `public` to `service_role`, because revoking `PUBLIC` execute could
    otherwise cut off functions (for example pgvector's) that service_role
    only had through `PUBLIC`.
  - Default privileges (`for role postgres`): schema-scoped revokes of
    tables/sequences from `anon, authenticated` and of functions from
    `public, anon, authenticated`, plus schema-scoped grants to `service_role`.
    The header notes this assumes migrations run as `postgres`.
  - `supabase/config.toml`: `enable_signup = false` at `[auth]` (line 169) and
    `[auth.email]` (line 211). `[auth.sms]` was already false.
- Interfaces/contracts other tickets rely on: after this migration the anon and
  authenticated roles have no table, view, sequence, function or bucket access;
  all data access goes through the backend (service role). The backend uses
  `create_signed_url` and `upload` only, so a private bucket is fine. Any
  future RPC meant for clients needs an explicit grant.
- Known gaps or follow-ups:
  - Not run against any Postgres (none available locally; nothing applied to
    the remote). Manager applies it in M-01. Worth a dry run on a local
    `supabase start` or a branch DB first.
  - One statement is not schema-scoped: `alter default privileges for role
postgres revoke execute on functions from public`. A schema-scoped revoke
    cannot remove the built-in PUBLIC execute default, so this applies to
    functions postgres creates in any schema from now on. Supabase-owned
    schemas are created by supabase_admin, so should be unaffected. Flag if
    you would rather drop that line.
  - Dropping policies on `storage.objects`/`storage.buckets` needs the
    migration role to be allowed to (postgres on hosted Supabase normally is).
    If it errors with "must be owner", that is the cause.
  - `lib/supabase.ts` now has no callers (only the deleted `lib/storage.ts`
    imported `getSupabaseClient`); left in place per ticket.
  - Checks: `npx tsc --noEmit` passes, prettier on the ticket passes. Lint was
    not rerun this round (no TS/JS changes).

Do not run `supabase db push` or any command that writes to the linked
remote project. The manager applies the migration (M-01).
