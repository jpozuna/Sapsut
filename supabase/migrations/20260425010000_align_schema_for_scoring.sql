-- Align schema with backend happy path (plural tables)

-- Extensions
create extension if not exists vector;

-- Tasks: allow per-task submission limits
alter table if exists public.tasks
  add column if not exists allow_multiple_submissions boolean not null default false;

-- Teams: store running total (optional but simplifies leaderboard)
alter table if exists public.teams
  add column if not exists total_score integer not null default 0;

-- Submissions: fields referenced by scoring pipeline
alter table if exists public.submissions
  add column if not exists confidence double precision,
  add column if not exists gpt4o_description text;

-- Remove global "one per task" constraint (rule is per-task now)
alter table if exists public.submissions
  drop constraint if exists submissions_one_per_team_task;

-- Criteria per task (used for exact-match + rubric text)
create table if not exists public.task_criteria (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  criteria_type text not null,
  value text not null,
  created_at timestamptz not null default now()
);

create index if not exists task_criteria_task_id_idx on public.task_criteria(task_id);
create index if not exists task_criteria_type_idx on public.task_criteria(criteria_type);

-- Review queue for human grading
create table if not exists public.review_queue (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  claude_score integer,
  confidence double precision,
  claude_rationale text,
  created_at timestamptz not null default now()
);

create index if not exists review_queue_submission_id_idx on public.review_queue(submission_id);

-- Dev convenience: disable RLS on these tables (adjust later)
alter table if exists public.teams disable row level security;
alter table if exists public.tasks disable row level security;
alter table if exists public.task_criteria disable row level security;
alter table if exists public.submissions disable row level security;
alter table if exists public.review_queue disable row level security;

