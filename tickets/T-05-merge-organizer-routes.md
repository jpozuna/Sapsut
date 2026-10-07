# T-05: Merge the two organizer route trees

Status: done
Branch: t-05-merge-organizer-routes

## Goal

Organizer screens live only under `app/(tabs)/organizer`, so one layout guards
them all.

## Done when

- [ ] The screens in `app/organizer/` (`create-task`, `review`, `history`) are
      moved into `app/(tabs)/organizer/`, replacing the one-line re-exports.
      `app/organizer/` no longer exists.
- [ ] `app/(tabs)/organizer/_layout.tsx` is the only organizer guard: it waits for
      `isHydrating` and redirects non-organizers to `/(tabs)`.
- [ ] Every in-app link to an organizer screen resolves (for example
      `/(tabs)/organizer`, `/(tabs)/organizer/review`, `/(tabs)/organizer/history`).
      `grep -rn "'/organizer" app components lib` finds no links to the removed tree.
- [ ] The Organizer tab still opens the create-task screen, and the tab is still
      hidden for participants.
- [ ] Repo checks pass.

## Owns

- app/organizer/ (delete)
- app/(tabs)/organizer/
- app/(tabs)/\_layout.tsx

## Reads (not edits)

- app/\_layout.tsx
- app/(tabs)/settings.tsx
- app/(tabs)/index.tsx
- components/
- lib/role-context.tsx

## Depends on

- none

## Specialists

- tests: no
- research: no
- extra: none

## Handoff

Filled in by the ticket thread when finished.

- What changed: `git mv` of `create-task`, `review`, `history` from
  `app/organizer/` into `app/(tabs)/organizer/` (replacing the re-exports).
  `app/organizer/` (including its duplicate `_layout` and `index`) is gone.
  `app/(tabs)/organizer/_layout.tsx` is the single guard (waits for
  `isHydrating`, redirects non-organizers to `/(tabs)`) and now declares the
  four screens. `app/(tabs)/organizer/index.tsx` is a `<Redirect>` to
  `/organizer/create-task`, so the Organizer tab still opens create-task.
  `app/(tabs)/_layout.tsx` needed no change (tab still hidden for
  participants).
- Interfaces/contracts other tickets rely on: organizer URLs are
  `/organizer/create-task`, `/organizer/review`, `/organizer/history` (group
  `(tabs)` is invisible); `/(tabs)/organizer/...` also works. In-file links
  already used `/(tabs)/organizer...` and were unchanged.
- Known gaps or follow-ups: `app/(tabs)/index.tsx:347` still pushes
  `/organizer/create-task` (outside Owns). It resolves to the moved screen, so
  nothing breaks, but it would show up in the ticket's grep; optionally change
  to `/(tabs)/organizer/create-task`. Remaining `'/organizer/...'` strings in
  the moved screens are backend API paths, not links. The generated
  `.expo/types/router.d.ts` is stale until the dev server regenerates it;
  tsc and lint pass either way.
- Blocked reason (if blocked): none

If a link outside the Owns paths (for example in `app/(tabs)/settings.tsx`)
needs to change, stop and mark the ticket blocked. Don't edit it.
