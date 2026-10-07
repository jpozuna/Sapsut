---
name: orchestrate
description: Act as the manager for a multi-part coding goal. Break the goal into tickets with clear goals, explicit hand-offs and distinct file ownership, hand each ticket to a ticket-worker subagent (or a separate worktree session for big tickets), run review/test/research specialists on each result, and review every hand-off before committing. Use when the user runs /orchestrate or explicitly asks to plan, split up, parallelize or manage a piece of work as tickets.
disable-model-invocation: true
---

# Orchestrate

You are the manager. You plan, delegate and review. You do not write
feature code yourself unless a ticket is too small to be worth delegating.

There are no native threads in this setup. Work is delegated two ways:

- **Inline (default).** Each ticket goes to a `ticket-worker` subagent in
  this session. Subagents cannot call other subagents, so you, the manager,
  run the specialists (`test-writer`, `code-reviewer`, `researcher`) on each
  ticket after its worker returns.
- **Worktree.** For a ticket that is large, long-running, or needs its own
  dev server or test run that would collide with others, the user runs it
  in a separate Claude Code session in its own git worktree. See
  `references/worktree-mode.md`.

Mark each ticket's mode on the board. Most tickets should be inline.

## 1. Understand before splitting

Read `CLAUDE.md`, any `docs/DECISIONS.md` or brief, and the relevant code.
If CLAUDE.md has an "Orchestration specialists" section, use the agent
names it maps instead of the defaults. Restate the goal in one or two
sentences and list open questions. Resolve naming and vocabulary questions
with the user before any ticket is written. Do not plan around guesses.

Check `git status`. If the working tree is dirty, ask the user to commit or
stash first, so each ticket's changes can be isolated.

## 2. Write tickets

Create `tickets/` at the repo root if missing, plus `tickets/BOARD.md`.
Write one file per ticket, `tickets/T-01-short-slug.md`, using
`references/ticket-template.md`. Every field is required.

Rules that prevent the three scale failures:

1. **Overlapping scope.** Every path a ticket edits is listed under `Owns`.
   No path appears in two tickets' `Owns`. Shared files (config, routes,
   types, prompts, schemas, lockfiles) get their own ticket or stay with the
   manager. If two tickets both need a file, merge them or sequence them.
   Inline workers share one working directory, so this rule is what keeps
   them from overwriting each other.
2. **Blocked dependencies.** `Depends on` names ticket IDs, never vague
   phrases. A ticket with unmet dependencies is not started. Prefer a short
   foundation ticket (types, interfaces, stubs) first so later tickets can
   run in parallel against a fixed contract.
3. **Unclear objectives.** `Goal` is one outcome. `Done when` is testable
   by someone who did not write the code. If you cannot write `Done when`,
   the ticket is not ready.

Size: one ticket should be one reviewable commit. If it needs more than
about five owned files or touches two unrelated areas, split it.

## 3. Show the plan, then wait

Present BOARD.md: tickets, mode (inline or worktree), dependency order,
and which run in parallel. **Do not start any work until the user
approves.** Run at most 3 inline workers at once. Every subagent spends
usage, so if the tickets in a group are small, run them one at a time.

## 4. Delegate

**Inline tickets.** Launch a `ticket-worker` for each ticket in the current
parallel group, in a single message so they run concurrently. Give each
worker only: the ticket file path, and the hand-offs of the tickets it
depends on (paste them in). Not the whole plan.

**Worktree tickets.** Run
`bash .claude/skills/orchestrate/scripts/new-ticket.sh T-NN-short-slug` and give
the user its output (the commands and the opening prompt). Then continue
with inline tickets while they work.

## 5. Review each hand-off

When a ticket reaches `Status: review`:

1. Scope: `git status --porcelain` and `git diff HEAD --stat`. Every changed
   or new path must sit under that ticket's `Owns` (or be its own ticket
   file). For worktree tickets, use `git diff main...<branch> --stat`.
2. Specialists, per the ticket's `Specialists` section: run `test-writer`
   if tests: yes, then `code-reviewer`, telling each which ticket and which
   paths to look at. Run `researcher` only if the ticket asked a question
   the worker could not answer. Run any extra specialists the ticket names
   (see "Orchestration specialists" in CLAUDE.md), e.g. `security-auditor`
   or `ui-ux-reviewer`; the user approving the board counts as asking.
3. Check each `Done when` item against the actual code, not the summary.
   Confirm repo checks in CLAUDE.md pass.
4. Accept or return:
   - **Accept, inline:** format, then commit only that ticket's paths:
     `npx prettier --write --ignore-unknown <Owns paths> tickets/`, then
     `git add <Owns paths> tickets/T-NN-*.md tickets/BOARD.md && git commit -m "T-NN: <title>"`.
     The pre-push hook fails on unformatted files, including ticket Markdown.
   - **Accept, worktree:** merge per `references/worktree-mode.md`.
   - **Return:** send specific fixes back to a new `ticket-worker` with the
     ticket and the review findings.
5. On accept, set `Status: done` and update BOARD.md before committing,
   so the commit records the final state.

Start dependents only after their dependencies are `done`.

## 6. Close out

Summarize what shipped, what was deferred, and any decisions made along
the way. If the repo has `docs/DECISIONS.md`, append those decisions there.
Never push, deploy or publish unless CLAUDE.md or the user says to.
