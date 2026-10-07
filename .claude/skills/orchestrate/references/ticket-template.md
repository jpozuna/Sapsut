# Ticket template

Copy into `tickets/T-NN-short-slug.md`. Every field is required.

```markdown
# T-NN: <title>

Status: todo # todo | in-progress | blocked | review | done
Branch: t-nn-short-slug

## Goal

One sentence. One outcome.

## Done when

- [ ] Testable criterion
- [ ] Testable criterion
- [ ] Repo checks pass

## Owns

Only these paths may be edited by this ticket.

- path/to/file-or-dir

## Reads (not edits)

- path/to/context

## Depends on

- T-NN (needs: what exactly from its hand-off) # or "none"

## Specialists

- tests: yes | no
- research: yes | no (question: ...)
- extra: none | security-auditor | ui-ux-reviewer | performance-auditor

## Handoff

Filled in by the ticket thread when finished.

- What changed:
- Interfaces/contracts other tickets rely on:
- Known gaps or follow-ups:
- Blocked reason (if blocked):
```

# BOARD.md format

```markdown
# Board: <goal>

| ID   | Title        | Status      | Depends on | Parallel group |
| ---- | ------------ | ----------- | ---------- | -------------- |
| T-01 | Shared types | done        | none       | 1              |
| T-02 | API route    | in-progress | T-01       | 2              |
| T-03 | UI section   | in-progress | T-01       | 2              |

Concurrency cap: 3
Decisions log:

- <date>: <decision>
```
