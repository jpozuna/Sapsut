# Worktree mode

For tickets too big or too noisy to run as an inline subagent. The user
runs these in a separate Claude Code session; the manager reviews and merges.

## Start

Commit `tickets/` first so the new worktree has the ticket files. Then:

```bash
bash .claude/skills/orchestrate/scripts/new-ticket.sh T-NN-short-slug
```

It creates `../<repo>-T-NN-short-slug` on branch `t-nn-short-slug` and
prints the commands and opening prompt for the user.

A fresh worktree has no `node_modules/` or `backend/venv/`. The ticket
session must run `npm ci` (and, for backend work,
`python -m venv backend/venv && backend/venv/bin/pip install -r backend/requirements.txt ruff pytest`)
before running checks. Copy `backend/.env` over only if the ticket needs it.

The ticket session works like a ticket-worker, except it is a top-level
session, so it runs the specialists itself, with reports under
`tickets/reviews/`. When they pass, it runs
`python3 .claude/skills/orchestrate/scripts/orch.py check T-NN` and then
`orch.py accept T-NN --met ...`, which commits on its own branch.

## Review and merge

From the main worktree:

```bash
git diff main...t-nn-short-slug --stat   # every path under Owns, plus its ticket file
git merge --no-ff t-nn-short-slug
git worktree remove ../<repo>-T-NN-short-slug
git branch -d t-nn-short-slug
```

Merge in dependency order. Update BOARD.md after each merge.
