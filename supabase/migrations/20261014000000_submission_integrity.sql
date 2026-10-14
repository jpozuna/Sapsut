-- Sapsut: database-enforced "one non-error submission per team and task" for
-- single-submission tasks, and an atomic replace of a task's criteria.
--
-- A partial index cannot read tasks.allow_multiple_submissions, so the flag is
-- copied onto each submission (submissions.single_submission) by a trigger and
-- the unique partial index keys on it. The column defaults to true so a write
-- that somehow bypasses the trigger fails safe (treated as single-submission).
-- Toggling a task's flag later applies only to new submissions.
--
-- Idempotent: safe to run more than once. Assumes migrations run as postgres.

-- 1. submissions.single_submission. Backfilled from the task's flag only when
--    the column is first added, so a re-run does not overwrite later state.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'submissions'
      and column_name = 'single_submission'
  ) then
    alter table public.submissions
      add column single_submission boolean not null default true;

    update public.submissions s
    set single_submission = not coalesce(t.allow_multiple_submissions, false)
    from public.tasks t
    where t.id = s.task_id;
  end if;
end
$$;

-- 2. Trigger: set single_submission from the row's task, ignoring any value
--    the client sent. A missing task leaves it true.
create or replace function public.set_submission_single_flag()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_allow_multiple boolean;
begin
  select t.allow_multiple_submissions
  into v_allow_multiple
  from public.tasks t
  where t.id = new.task_id;

  if found then
    new.single_submission := not coalesce(v_allow_multiple, false);
  else
    new.single_submission := true;
  end if;

  return new;
end
$$;

revoke execute on function public.set_submission_single_flag()
  from public, anon, authenticated;
grant execute on function public.set_submission_single_flag() to service_role;

drop trigger if exists submissions_set_single_flag on public.submissions;
create trigger submissions_set_single_flag
  before insert or update of task_id on public.submissions
  for each row
  execute function public.set_submission_single_flag();

-- 3. Fail loudly (before creating the index) if existing data already violates
--    the rule, so the migration does not half-apply.
do $$
declare
  v_dupes bigint;
begin
  select count(*)
  into v_dupes
  from (
    select 1
    from public.submissions
    where single_submission and status <> 'error'
    group by team_id, task_id
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'cannot create submissions_one_active_per_team_task_idx: % (team_id, task_id) pair(s) have more than one non-error submission on a single-submission task',
      v_dupes;
  end if;
end
$$;

-- 4. One non-error submission per team and task for single-submission tasks.
--    A violating insert fails with SQLSTATE 23505.
create unique index if not exists submissions_one_active_per_team_task_idx
  on public.submissions (team_id, task_id)
  where single_submission and status <> 'error';

-- 5. Atomic criteria replace. A plpgsql function body runs in one statement
--    transaction, so a failed insert rolls back the delete. p_criteria is a
--    JSON array of {"criteria_type": text, "value": text}; an empty array
--    clears the task's criteria.
create or replace function public.replace_task_criteria(
  p_task_id uuid,
  p_criteria jsonb
)
returns setof public.task_criteria
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_criteria is null or jsonb_typeof(p_criteria) <> 'array' then
    raise exception 'p_criteria must be a JSON array';
  end if;

  -- Lock the task row so concurrent replaces for the same task serialize.
  perform 1 from public.tasks t where t.id = p_task_id for update;
  if not found then
    raise exception 'task % does not exist', p_task_id;
  end if;

  delete from public.task_criteria tc where tc.task_id = p_task_id;

  return query
  insert into public.task_criteria (task_id, criteria_type, value)
  select p_task_id, c.criteria_type, c.value
  from jsonb_to_recordset(p_criteria) as c(criteria_type text, value text)
  returning *;
end
$$;

revoke execute on function public.replace_task_criteria(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_task_criteria(uuid, jsonb) to service_role;
