-- Add embeddings and validation for task criteria

-- Ensure pgvector is available (idempotent)
create extension if not exists vector;

-- Add embedding column for semantic retrieval
alter table if exists public.task_criteria
  add column if not exists embedding vector(1536);

-- Enforce allowed criteria types at the database level
alter table if exists public.task_criteria
  drop constraint if exists task_criteria_criteria_type_check;

alter table if exists public.task_criteria
  add constraint task_criteria_criteria_type_check
  check (criteria_type in ('exact', 'fuzzy', 'rubric'));

-- Helpful index for filtering by task_id (already present in earlier migration, keep idempotent)
create index if not exists task_criteria_task_id_idx on public.task_criteria(task_id);

