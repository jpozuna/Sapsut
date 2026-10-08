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

`python3 .claude/skills/orchestrate/scripts/orch.py check` runs all of these
at once, prints one line per check and regenerates typed routes when route
files change. Use `--all` before a PR.

Tests: pytest in `backend/tests/` only. The frontend has no test framework;
do not add one without asking.

## Agents and cost

- Specialist subagents are opt-in. Only invoke them when a ticket's
  Specialists section, the orchestrate skill, or the user asks. Prefer
  free checks (linters, tests, git hooks) for per-edit validation.
- At most 3 ticket-workers at once unless the user says otherwise.

## Orchestration specialists

Used by `/orchestrate`:

- plan: `planner` (Opus; writes tickets and the board)
- worker: `ticket-worker`
- review: `code-reviewer` (every ticket; checks scope and each Done-when item)
- tests: `test-writer` (only when the worker's tests leave a Done-when item
  uncovered)
- research: `researcher`
- pre-PR gate: `verifier`

Extras a ticket can name under `Specialists: extra`:

- `ui-ux-reviewer`: every ticket that adds or changes a screen or component
- `security-auditor`: only trust-boundary tickets: `backend/auth/`, who can
  read or write which rows, Supabase policies or migrations, secrets, or AI
  input handling
- `performance-auditor`: the AI pipeline, image handling, or heavy list
  screens

Specialists write full reports to `tickets/reviews/` (gitignored) and return
a short verdict.

`verify-live` questions are answered read-only through
`services.get_supabase()` with `backend/.env`: select queries only, printing
counts and shapes, never values.

## Coordination

- Multi-part work goes through /orchestrate and the `tickets/` folder.
- A ticket edits only paths under its Owns. If it needs more, it stops,
  marks the ticket blocked with the reason, and reports.
- Ticket-workers never commit; the manager commits one ticket at a time
  with `orch.py accept`.
- `package.json`, `package-lock.json`, `app.json`, `backend/requirements.txt`
  and `supabase/migrations/` are shared files: own them in a dedicated
  ticket or keep them with the manager.
- Decisions that affect more than one ticket go in `tickets/BOARD.md` and,
  if present, `docs/DECISIONS.md`.

## Safety

- Never push, deploy or publish without explicit instruction.
- Never commit secrets (`.env`, `backend/.env`, Supabase service keys).
