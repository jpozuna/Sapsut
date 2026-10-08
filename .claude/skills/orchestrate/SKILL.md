---
name: orchestrate
description: Act as the manager for a multi-part coding goal. A planner subagent writes tickets with clear goals, explicit hand-offs and distinct file ownership; ticket-worker subagents (or worktree sessions for big tickets) implement them; review, test and audit specialists check each result; a verifier gates the PR. The manager decides, and keeps its own context small. Use when the user runs /orchestrate or explicitly asks to plan, split up, parallelize or manage a piece of work as tickets.
disable-model-invocation: true
---

# Orchestrate

You are the manager. You decide; others plan, build, check and record.

`ORCH` below means `python3 .claude/skills/orchestrate/scripts/orch.py`.

## Context budget

Every turn re-reads your whole conversation, so what you read stays expensive
for the rest of the session. The board and ticket files are the shared
memory; your context should hold little more than the board and verdicts.

- Don't read source files or full diffs. The planner reads code to plan,
  the code-reviewer reads it to verify, and `ORCH` summarizes the rest.
- Subagents write full reports to `tickets/reviews/` and return a short
  verdict. Read a report only to settle a disputed finding, and then `grep`
  for that finding's ID instead of reading the whole file.
- Point workers at ticket files. Don't paste hand-offs into prompts.
- Prefer one `ORCH` call over several git commands.

## 0. Start or resume

- `/orchestrate resume`, or an open board in `tickets/BOARD.md` with tickets
  not done: run `ORCH resume` and continue from the step it implies. Ticket
  files are the truth when they disagree with the board.
- Otherwise, start at step 1 with the user's goal. If no goal was given, ask
  for one. "An issue" means: propose the most important open GitHub issue
  and confirm it.

The working tree must be clean outside `tickets/`. If it isn't, ask the user
to commit or stash first.

## 1. Plan (planner)

Launch `planner` with the goal, the issue number if any, and any constraints
the user stated.

- If it returns `Questions:`, ask them with AskUserQuestion, then send the
  answers to the same planner with SendMessage. It keeps its context.
- When it returns the board, run `ORCH validate`. If it fails, send the
  failures back to the planner.

You don't write tickets. To change the plan, tell the planner what to change.

## 2. Approve

Present the board table from the planner's return, its decisions, and any
`M-NN` manager steps. In the same approval question, settle:

- whether to push and open a PR after the pre-PR gate passes
- whether to hand off to a fresh session between groups (step 6)

**Do not start any work until the user approves.**

## 3. Run a group

For the next group (`ORCH resume` marks tickets READY):

1. Do the group's `M-NN` steps and `Deletes` (`git rm -q <path>`) yourself
   first.
2. Launch one `ticket-worker` per ticket, at most 3, in a single message.
   The prompt is only: "Implement `tickets/T-NN-slug.md`. Its dependencies'
   hand-offs are in their ticket files." Add any short user instruction that
   matters for this ticket.
3. **Worktree tickets:** run
   `bash .claude/skills/orchestrate/scripts/new-ticket.sh T-NN-short-slug` and
   give the user its output. See `references/worktree-mode.md`.

## 4. Check the group

When every worker in the group has returned:

1. Run `ORCH check T-NN T-NN ...` once for the whole group. This runs scope,
   format, lint, types and tests, and regenerates route types if routes
   changed. A FAIL caused by one ticket goes back to that ticket's worker
   (step 5).
2. Launch the specialists for every ticket in one message. Give each the
   ticket path and a report path, `tickets/reviews/T-NN-<agent>.md`.
   - `code-reviewer`: always. For 2 or 3 related tickets, one review of the
     whole group works well (one report section per ticket).
   - Extras from the ticket's `extra` line, per the policy in CLAUDE.md.
     The user approving the board counts as asking for them.
   - `test-writer`: only if `tests: yes`, or the worker's
     `Tests per Done-when item` leaves an item uncovered.
   - `researcher`: only if the ticket asked a question the worker couldn't
     answer.
3. While specialists run, edit nothing in their tickets' `Owns`.

## 5. Decide each ticket

From the verdicts:

- **Accept** when no verdict says return or BLOCKED and the check passed:
  `ORCH accept T-NN --met <items the reviewer marked met> --trailer "<your commit attribution line, if any>"`.
  It ticks only those items, sets `done` in the ticket and the board,
  formats, and commits only that ticket's paths. If an item is genuinely
  unmet but acceptable, pass `--unmet "<reason>"`.
- **Return** for a not-met Done-when item, a blocking bug, or a Must fix:
  launch a new `ticket-worker` with the ticket path, the report paths, and
  the finding IDs to fix. Then run a `code-reviewer` re-review of just those
  findings.
- **Don't return for:**
  - design upgrades: they become a follow-up or a new ticket via the planner
  - warnings outside the Done-when items: fix them now if small, otherwise
    follow-up
  - `Info` items: triage each one as fixed, follow-up or not an issue, and
    record it in the decisions log. Never just skip it.
- **Manager edits:** only a fix of at most about 10 lines for a confirmed
  finding, after all of that ticket's specialists have returned. Then run
  `ORCH check T-NN` again and add `Manager edit (unreviewed): <what>` to the
  Handoff.

Record decisions that affect more than one ticket in BOARD.md's decisions
log. If the repo has `docs/DECISIONS.md`, add them there too. Start
dependents only after their dependencies are `done`.

## 6. Between groups

If more groups remain and the user chose handoffs at approval, check that
BOARD.md is current, then tell the user in one line to run `/clear` and then
`/orchestrate resume`. The next session starts at about 40K tokens of
context instead of carrying everything so far.

## 7. Pre-PR gate (verifier)

When every ticket is done, launch `verifier` with the report path
`tickets/reviews/verify-<branch>.md`. On `fail`, return each finding to a
ticket-worker (or a new ticket via the planner), then run the verifier again.

## 8. Close out

- Move follow-ups into BOARD.md. Filing them as GitHub issues is a public
  post, so list them and ask once.
- If the user approved a PR at step 2, push and open it. If pushing is
  refused, give the user the exact commands.
- Summarize what shipped, what was deferred, and the decisions made. Never
  deploy or publish otherwise unless CLAUDE.md or the user says to.

## Small work

For one ticket of at most about 5 files, with no migrations or shared files:

- Write the ticket and a one-row board yourself; it's quicker than a planner
  run.
- Skip the handoff question.
- Run one worker, then one `code-reviewer` with any extras folded into its
  prompt, `ORCH check`, `ORCH accept`, and the verifier only if the ticket
  has a `verify-live` question.
