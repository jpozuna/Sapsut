# Ticket template

Copy into `tickets/T-NN-short-slug.md`. Every field is required; write
"none" where a list is empty.

```markdown
# T-NN: <title>

Status: todo
Branch: t-nn-short-slug

## Goal

One sentence. One outcome.

## Done when

- [ ] Testable criterion (item 1)
- [ ] Testable criterion (item 2)
- [ ] Repo checks pass

## Owns

Only these paths may be edited by this ticket.

- path/to/file-or-dir

## Deletes

- none

## Reads (not edits)

- path/to/context

## Depends on

- T-NN (needs: what exactly from its hand-off)

## Specialists

- tests: no
- research: no
- extra: none
- verify-live: none

## Handoff

Filled in by the worker when finished.

- What changed:
- Interfaces/contracts other tickets rely on:
- Tests per Done-when item:
- Known gaps or follow-ups:
- Manager to delete:
- Blocked reason (if blocked):
```

Field values:

- `Status`: todo, in-progress, blocked, review or done. Set it with
  `orch.py status`, which updates BOARD.md too.
- `Depends on`: ticket IDs, or `none`.
- `tests`: `yes` only when the worker can't reasonably cover a Done-when item.
- `research`: `no`, or `yes (question: ...)`.
- `extra`: `none` or the specialists from CLAUDE.md, e.g.
  `security-auditor, ui-ux-reviewer`.
- `verify-live`: `none`, or one read-only question about live data for the
  pre-PR verifier.

Done-when items are numbered by position. Reviewers report `met: 1,2,4`, and
`orch.py accept --met 1,2,4` ticks exactly those.

# BOARD.md format

New boards go at the top. A finished board moves below under
`## Previous board: <goal>, done`.

```markdown
# Board: <goal> (issue #NN)

| ID   | Title        | Status | Mode   | Depends on | Parallel group |
| ---- | ------------ | ------ | ------ | ---------- | -------------- |
| T-01 | Shared types | done   | inline | none       | 1              |
| T-02 | API route    | review | inline | T-01       | 2              |
| M-01 | Install pkg  | todo   | inline | none       | 1              |

Concurrency cap: 3
PR: open after the pre-PR gate passes (decided at approval)

## Contract

Fixed interfaces later tickets rely on, if any.

Decisions log:

- <date>: <decision>

Follow-ups (not yet filed):

- <item>
```

`M-NN` rows are manager steps (installs, migrations, deletions). They need
no ticket file.
