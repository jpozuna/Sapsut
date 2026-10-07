# Sapsut

Expo (React Native, expo-router) app at the repo root, FastAPI backend in
`backend/`, Supabase in `supabase/`.

## Repo checks

Run these before a ticket is accepted. They mirror `.github/workflows/ci.yml`
and `.githooks/pre-push`.

- Frontend lint: `npx expo lint`
- Types: `npx tsc --noEmit`
- Format: `npx prettier --check "**/*.{ts,tsx,js,jsx,json,md,yml,yaml}"`
  (this covers Markdown, including `tickets/`; fix scoped files with
  `npx prettier --write <paths>`)
- Backend lint: `backend/venv/bin/ruff check backend/` (or `ruff` on PATH)
- Backend tests: `backend/venv/bin/pytest backend/tests/ -q`

Tests: pytest in `backend/tests/` only. The frontend has no test framework;
do not add one without asking.

## Agents and cost

- Specialist subagents are opt-in. Only invoke them when a ticket's
  Specialists section, the orchestrate skill, or the user asks. Prefer
  free checks (linters, tests, git hooks) for per-edit validation.
- At most 3 ticket-workers at once unless the user says otherwise.

## Orchestration specialists

Used by `/orchestrate`. Defaults:

- worker: `ticket-worker`
- tests: `test-writer`
- review: `code-reviewer`
- research: `researcher`

Extras a ticket can name under `Specialists: extra`:

- `security-auditor`: tickets touching `backend/auth/`, Supabase policies or
  migrations, secrets, or AI input handling
- `ui-ux-reviewer`: tickets that finish a screen or component
- `performance-auditor`: tickets on the AI pipeline, image handling, or
  heavy list screens

## Coordination

- Multi-part work goes through /orchestrate and the `tickets/` folder.
- A ticket edits only paths under its Owns. If it needs more, it stops,
  marks the ticket blocked with the reason, and reports.
- Ticket-workers never commit; the manager commits one ticket at a time.
- `package.json`, `package-lock.json`, `app.json`, `backend/requirements.txt`
  and `supabase/migrations/` are shared files: own them in a dedicated
  ticket or keep them with the manager.
- Decisions that affect more than one ticket go in `tickets/BOARD.md` and,
  if present, `docs/DECISIONS.md`.

## Safety

- Never push, deploy or publish without explicit instruction.
- Never commit secrets (`.env`, `backend/.env`, Supabase service keys).
