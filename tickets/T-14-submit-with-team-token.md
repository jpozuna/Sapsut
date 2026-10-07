# T-14: Submit and Settings use the team session

Status: done
Branch: t-14-submit-with-team-token

## Goal

Participants submit as their joined team (no typed team ID), and Settings shows
the current team with a way to change it.

## Done when

- [x] `app/tasks/[id]/submit.tsx`: the "Team ID" field and its validation are
      gone. With a session it shows "Submitting as <team name>" with a Change link
      to `/team`. Without one, the submit button is replaced by a "Join your team"
      button to `/team`, and returning from `/team` picks up the new session.
- [x] The submission POST sends `X-Team-Token` via `withTeamToken`/`teamHeaders`
      and no longer appends `team_id` or calls `saveTeamId`. A 401 shows "Your team
      session expired. Join your team again." with the join button. The 403 and
      existing `error`/`detail` handling still shows a message.
- [x] `app/(tabs)/settings.tsx`: participants see a "Your team" row (team name,
      or "Not joined") that opens `/team`. Organizers don't see it.
- [x] No remaining calls to `saveTeamId` or `getSavedTeamId` in owned files.
- [x] Repo checks pass.

## Owns

- app/tasks/[id]/submit.tsx
- app/(tabs)/settings.tsx

## Reads (not edits)

- lib/team-session.ts, app/team.tsx
- components/ui/
- tickets/BOARD.md (contract section)

## Depends on

- T-12 (needs: `POST /submissions/` requires `X-Team-Token`; 401/403 behavior)
- T-13 (needs: `getTeamSession`, `withTeamToken`/`teamHeaders`, session hook, `/team` route)

## Specialists

- tests: no (no frontend test framework)
- research: no
- extra: ui-ux-reviewer

## Handoff

Filled in by the ticket thread when finished.

- What changed:
  - `app/tasks/[id]/submit.tsx`: Team ID field, validation and
    `getSavedTeamId`/`saveTeamId` removed. `useTeamSession()` drives a "Your
    team" card: "Submitting as <team name>" with a Change button to `/team`, or
    a prompt to join. With no session (and not loading) the footer Submit button
    is replaced by a full-width "Join your team" button to `/team`; the hook
    picks up a new session when returning, and clears a stale error on token
    change. The POST runs inside `withTeamToken` with `teamHeaders(token)`, no
    `team_id` or `photo_path`, no Content-Type. A 401 response throws
    `{kind: 'unknown', status: 401}` so the session is cleared, then shows "Your
    team session expired. Join your team again."; `isNoTeamSessionError` shows
    "Join your team to submit.". 403 "Team mismatch.", other `detail`, and 200
    `error` bodies still display as before.
  - `app/(tabs)/settings.tsx`: participants get a pressable "Your team" row
    (team name, "Unnamed team", "Checking..." while loading, or "Not joined")
    that pushes `/team`. Hidden for organizers.
- Interfaces/contracts other tickets rely on: none new.
- Known gaps or follow-ups: `npx tsc --noEmit` reports only `"/team"` not
  assignable errors (also in `app/(tabs)/index.tsx` and `app/submissions/[id].tsx`)
  because the gitignored `.expo/types/router.d.ts` is stale (generated Oct 7
  14:31, before `app/team.tsx`); it regenerates when `expo start` runs. No other
  tsc errors. `expo lint` and prettier pass. Not run on a device or against a
  live backend.
- Review round:
  - `submit.tsx`: footer clears the bottom safe area
    (`Math.max(Spacing.lg, insets.bottom + Spacing.sm)`); KeyboardAvoidingView
    uses `behavior="padding"` on both platforms. `submitError` renders in the
    footer above the button (`accessibilityRole="alert"`, announced with
    `AccessibilityInfo.announceForAccessibility`); the old in-scroll error card
    and the dead `submitSuccessId` card and state are gone. The button reads "Try
    again" while an error is set and a session is valid. The POST has a 45s
    AbortController timeout; timeouts and network failures (`toAppError` kind
    `network`) show "Can't reach the server. Your answer and photo are kept.
    Check your connection and tap Try again."; other exceptions show a generic
    message, never `e.message`. A 200 duplicate with `existing_submission_id`
    shows "Already submitted" and swaps the button for "View submission"
    (`/submissions/[id]`); 403 "Team mismatch." shows "This device is signed in
    as a different team. Tap Change to rejoin." Change is `size="md"`. Team name
    is trimmed with an "Unnamed team" fallback (both files). Team card: icon
    hidden from screen readers, text block grouped with
    `accessibilityLabel="Submitting as <name>"`, "Your team" overline is a
    header.
  - `settings.tsx`: team row renders only when `!isHydrating && role !==
'organizer'`; not-joined reads "Join your team". `AppCard` has no
    `accessibilityHint` prop (and `components/ui` is read-only), so the row is
    now a `Pressable` (role button, label "Your team, <state>", hint "Opens
    team settings") wrapping a non-pressable `AppCard`; this drops the card's
    press-scale animation. A shared `AppCard` hint prop would be a follow-up.
  - Checks: eslint clean on owned files; tsc reports no errors in owned files
    (one unrelated error in `app/(tabs)/index.tsx`, another ticket's in-flight
    edit); prettier clean.
- Blocked reason (if blocked): none
