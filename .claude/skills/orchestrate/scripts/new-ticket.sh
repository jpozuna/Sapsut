#!/usr/bin/env bash
# Create a git worktree for one ticket and print how to start its session.
# Usage: new-ticket.sh T-NN-short-slug
set -euo pipefail

slug="${1:?usage: new-ticket.sh T-NN-short-slug}"
root="$(git rev-parse --show-toplevel)"
repo="$(basename "$root")"
ticket_file="$(ls "$root"/tickets/"$slug"*.md 2>/dev/null | head -n1 || true)"
[ -n "$ticket_file" ] || { echo "No ticket file matching tickets/$slug*.md" >&2; exit 1; }

if ! git -C "$root" diff --quiet HEAD -- tickets/ || \
   [ -n "$(git -C "$root" ls-files --others --exclude-standard tickets/)" ]; then
  echo "Commit tickets/ first so the worktree gets the ticket files." >&2
  exit 1
fi

branch="$(echo "$slug" | tr '[:upper:]' '[:lower:]')"
dir="$(dirname "$root")/$repo-$slug"

git -C "$root" worktree add "$dir" -b "$branch"

cat <<MSG

Worktree ready. In a new terminal:

  cd "$dir"
  npm ci            # worktrees don't share node_modules/ or backend/venv/
  claude

Opening prompt:

  You are the ticket session for tickets/$(basename "$ticket_file").
  Read it and CLAUDE.md. Edit only paths under Owns; if you need anything
  else, set Status: blocked with the reason and stop. When the code is
  done, run the specialists the ticket's Specialists section asks for,
  fill in Handoff, set Status: review, and commit on this branch.
MSG
