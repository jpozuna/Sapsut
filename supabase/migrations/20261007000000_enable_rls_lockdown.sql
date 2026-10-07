-- Sapsut: enable RLS on every public table and lock down Storage.
--
-- Access model: the FastAPI backend talks to Supabase with the service-role
-- key, which bypasses RLS. The app must never query Supabase directly with
-- the anon key. With RLS enabled and no policies, anon and authenticated
-- roles get no access to these tables or to the submission photo bucket.
--
-- Beyond RLS, this also revokes all anon/authenticated privileges on public
-- tables, views, sequences and functions (views owned by postgres and SECURITY
-- DEFINER functions bypass RLS and are reachable over PostgREST otherwise), and
-- sets default privileges so future objects in public do not grant those roles
-- anything. service_role keeps full access.
--
-- Assumes migrations run as the postgres role: `alter default privileges for
-- role postgres` only affects objects created by postgres.
--
-- Idempotent: safe to run more than once. Covers tables that exist only in the
-- live DB (task_photos, review_queue_history) without failing if they are
-- absent locally.

-- 1. Enable RLS on every ordinary table in public (teams, tasks, task_criteria,
--    submissions, review_queue, task_photos, review_queue_history, and any
--    other table that exists). FORCE is not required: the service role bypasses RLS.
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table if exists public.%I enable row level security', t.relname);
  end loop;
end
$$;

-- Explicit statements for the known tables (no-ops if already enabled, and
-- skipped if the table is only in the live DB and missing here).
alter table if exists public.teams enable row level security;
alter table if exists public.tasks enable row level security;
alter table if exists public.task_criteria enable row level security;
alter table if exists public.submissions enable row level security;
alter table if exists public.review_queue enable row level security;
alter table if exists public.task_photos enable row level security;
alter table if exists public.review_queue_history enable row level security;

-- 2. Drop every existing policy on public tables. No replacement policies are
--    created, so anon and authenticated have no access.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

-- 3. Submission photo bucket: private, 10 MB limit, image MIME types only.
--    Created if missing, corrected if it already exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submission-photos',
  'submission-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

-- 4. Storage: drop every policy on storage.objects and storage.buckets whose
--    roles overlap anon, authenticated or public (a policy with no TO clause
--    applies to public). Policies for other roles are left alone. Then assert
--    none remain.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename in ('objects', 'buckets')
      and roles && array['anon', 'authenticated', 'public']::name[]
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename in ('objects', 'buckets')
      and roles && array['anon', 'authenticated', 'public']::name[]
  ) then
    raise exception 'storage policies for anon/authenticated/public remain after cleanup';
  end if;
end
$$;

-- 5. Revoke privileges. RLS does not protect views owned by postgres (unless
--    security_invoker) or SECURITY DEFINER functions, and functions grant
--    EXECUTE to PUBLIC by default. `all tables` also covers views, materialized
--    views and foreign tables.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all procedures in schema public from public, anon, authenticated;

-- service_role keeps (and re-gets, since PUBLIC execute was revoked above) full
-- access to everything in public.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all procedures in schema public to service_role;

-- 6. Default privileges for objects postgres creates later, so new tables,
--    sequences and functions in public grant anon/authenticated nothing.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
-- Note: the built-in default still grants EXECUTE on new functions to PUBLIC,
-- and a schema-scoped revoke cannot remove it. A global revoke was left out on
-- purpose because it would also hit future extension functions in other
-- schemas. Any later migration that creates a function in public must
-- `revoke execute ... from public, anon, authenticated` explicitly.

alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
