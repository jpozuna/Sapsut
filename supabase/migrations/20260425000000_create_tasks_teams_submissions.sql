-- Sapsut: core tables for Husky Hunt companion app

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- TASKS
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text not null,
  max_points integer not null,
  rubric jsonb,
  is_active boolean not null default true,
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz not null default now()
);

-- TEAMS
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- SUBMISSIONS
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  text_answer text,
  photo_url text,
  status text not null default 'pending',
  score integer,
  rationale text,
  ai_result jsonb,
  created_at timestamptz not null default now(),
  constraint submissions_one_per_team_task unique (team_id, task_id)
);

create index if not exists submissions_task_id_idx on public.submissions(task_id);
create index if not exists submissions_team_id_idx on public.submissions(team_id);
create index if not exists submissions_status_idx on public.submissions(status);

