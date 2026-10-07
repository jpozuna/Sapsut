# T-15: Task list and submission detail use the team session

Status: done
Branch: t-15-home-and-detail-team-token

## Goal

The Tasks tab and the submission detail screen read submissions with the team
token, and a participant with no team is prompted to join.

## Done when

- [x] `app/(tabs)/index.tsx`: participant submission status loads through
      `teamJson('/submissions/')` (no `team_id` query) and refreshes when the
      session changes. With no session, a card says to join with the invite code
      from an organizer and links to `/team`. Organizers see no card and make no
      team call.
- [x] `app/submissions/[id].tsx`: the fetch sends `X-Team-Token` via
      `teamJson`. 404 shows a "Submission not found" state; no session or 401
      shows a "Join your team to see this submission" state linking to `/team`.
      Polling, if any, stops on those states.
- [x] No remaining calls to `getSavedTeamId`/`saveTeamId` in owned files.
- [x] Repo checks pass.

## Owns

- app/(tabs)/index.tsx
- app/submissions/[id].tsx

## Reads (not edits)

- lib/team-session.ts, app/team.tsx
- components/empty-state.tsx, components/screen-state.tsx, components/ui/
- tickets/BOARD.md (contract section)

## Depends on

- T-12 (needs: team-scoped `GET /submissions/` and `GET /submissions/{id}`)
- T-13 (needs: `teamJson`, session hook, no-session error shape, `/team` route)

## Specialists

- tests: no (no frontend test framework)
- research: no
- extra: none

## Handoff

Filled in by the ticket thread when finished.

- What changed:
  - `app/(tabs)/index.tsx`: submission status loads with
    `teamJson('/submissions/')` (no `team_id`), keyed on `useTeamSession()`'s
    token so it reloads on join, leave and a server 401 sign-out. Organizers make
    no team call. A participant with no session (after the session has loaded)
    sees a "Join your team" card (list header, button to `/team`). Removed the
    `getSavedTeamId` effect and `teamId` state.
  - `app/submissions/[id].tsx`: `fetchOnce` uses `teamJson`. Errors are
    classified by status and kind only: `isNoTeamSessionError` or status 401 ->
    "Join your team to see this submission" (button to `/team`); status 404 ->
    "Submission not found" (button back to tasks). Both render an `EmptyState`
    in place of the detail, and polling already stops on any error. When the
    session token appears while in the join state (player joined at `/team` and
    came back), it refetches. An organizer opening this screen lands in the join
    state; no organizer path was built. `photo_signed_url` stays optional; no raw
    `photo_url` is used.
- Interfaces/contracts other tickets rely on: none new.
- Known gaps or follow-ups: the earlier `'/team'` route-type errors came
  from stale `.expo/types` and are gone after regeneration. Not run against a
  live backend. A transient error while polling still
  replaces the screen with the generic error state (pre-existing behavior).
- Review round:
  - Hydration (`index.tsx`): reads `isHydrating` from `useRole()`. Hydrating
    counts as not-participant, so no `teamJson` call and no join card until the
    role is known (`isTeamParticipant = !isHydrating && role !== 'organizer'`).
    Header, sort bar and subtitle still use the old `isParticipant`.
  - Refresh (`index.tsx`): the status load is now `loadSubmissions`, run from
    `useFocusEffect` (focus, and again when role or token changes while
    focused) and from pull-to-refresh (awaited together with the task fetch).
    A call for the token already in flight reuses that promise; a newer call
    bumps a request id so older responses are dropped; a mounted ref blocks
    setState after unmount. A transient failure keeps the statuses shown; the
    statuses are cleared whenever the token or participant state changes.
  - Rejoin as another team (`[id].tsx`): `fetchOnce` now uses `withTeamToken`
    plus `httpJson` (same request and 401 handling as `teamJson`) so it knows
    the exact token used. `shownTokenRef` holds the token the shown data came
    from. When `useTeamSession()` reports a different token, the submission is
    cleared and refetched once, guarded by `refetchedForToken`, so it cannot
    loop and may end in "Submission not found".
  - Stale responses (`[id].tsx`): first load, retry and poll fetches each take
    an id from `latestRequestId`; only the latest may set submission, error or
    loading. A retry started during a poll invalidates that poll.
  - Also fixed: the poll effect did not depend on `submission`, so after the
    first poll still showed `pending` no further poll was scheduled. It now
    depends on `submission`.
  - Checks: `npx tsc --noEmit`, `npx expo lint` and prettier on the two files
    and this ticket pass. Not run against a live backend.
- Blocked reason (if blocked): none
