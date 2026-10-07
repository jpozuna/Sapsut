# T-13: Team session and Join team screen in the app

Status: done
Branch: t-13-team-session-app

## Goal

A participant can join a team with an invite code on a new `/team` screen, and
the app stores that team session and exposes helpers that send `X-Team-Token`.

## Done when

- [x] `lib/team-session.ts` stores `{teamId, teamName, token, expiresAt}`:
      SecureStore on native (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), AsyncStorage on
      web. An expired session reads as none.
- [x] It exports `getTeamSession()`, `joinTeam(inviteCode)` (calls
      `POST /teams/join`, saves, returns the session), `leaveTeam()`,
      `teamHeaders(token)`, `withTeamToken(fn)` and
      `teamJson<T>(path, init)`. `withTeamToken`/`teamJson` send nothing without a
      session, and a 401 clears the session. Callers can tell "no session" from
      other errors (for example a typed `AppError` kind or a named error).
- [x] A small subscription (`useTeamSession()` hook or listener) lets screens
      re-render when the session changes.
- [x] Compatibility: `getSavedTeamId('participant')` returns the session's
      `teamId`, and `getSavedTeamId('organizer')` returns null. `saveTeamId` and
      `clearSavedTeamId` remain as `@deprecated` no-ops (M-02 deletes them). The old
      `sapsut.teamId.*` AsyncStorage keys are removed on first read.
- [x] New `app/team.tsx`: with no session, an invite-code field (auto-caps, no
      autocorrect) and a Join button with loading, 404 ("No team with that code")
      and network error states. With a session, it shows the team name and a
      Leave team button. After a join it goes back if it can, else to `/(tabs)`.
      Uses existing `components/ui` parts and theme tokens.
- [x] `npx tsc --noEmit` and `npx expo lint` pass; nothing outside Owns edited.
- [x] Repo checks pass.

## Owns

- lib/team-session.ts
- app/team.tsx (new)

## Reads (not edits)

- lib/organizer-session.ts (SecureStore pattern, 401 handling)
- lib/organizer-api.ts, lib/http.ts, lib/app-error.ts, lib/api.ts
- components/ui/, constants/theme.ts
- app/(tabs)/settings.tsx (visual style)
- tickets/BOARD.md (contract section)

## Depends on

- none (built against the contract on the board; T-11 implements it)

## Specialists

- tests: no (no frontend test framework)
- research: no
- extra: ui-ux-reviewer

## Handoff

Filled in by the ticket thread when finished.

- Review round (UI/UX + code review): Leave team now needs an inline
  two-step confirm ("Leave this team? You'll need the invite code to rejoin."
  with danger Leave team and ghost Cancel; no `Alert.alert`). Leave/confirm
  buttons are `size="md"`, Join and confirms `fullWidth`. Invite code is
  upper-cased on input and in `joinTeam` (`code.trim().toUpperCase()`), with
  `autoComplete="off"`, `spellCheck={false}`, `textContentType="none"`, an
  accessibility label and placeholder "e.g. K7M2QX9P". A 404 stays a field
  error; network/server failures show a separate inline notice (wifi.slash
  icon + message) above Join, keep the typed code, and retry on Join; both
  call `AccessibilityInfo.announceForAccessibility`. Joined view renders only
  when `session && !isJoining`. KeyboardAvoidingView uses `behavior="padding"`
  on both platforms with `keyboardVerticalOffset={Spacing.xxl}`. Headings have
  `accessibilityRole="header"`, icon wrappers are hidden from screen readers,
  the joined row has one label ("Your team, {name}, joined"), the overline is
  secondary tone, an empty `teamName` shows "Unnamed team". Empty code shows
  the hint "Ask your organizer for your team's invite code." (Join stays
  disabled). Join timeout is now 20s. `useTeamSession` initial state drops an
  expired `memorySession`; `notifyChanged` try/catches each listener. No
  exported API changes.
- What changed: `lib/team-session.ts` rewritten (team session store, join,
  token helpers, hook, compat shims). New `app/team.tsx` join/leave screen
  (NavBar, invite-code `AppInput` with `autoCapitalize="characters"`, Join
  button with loading, 404 "No team with that code." and network errors, joined
  view with team name and Leave team). After a join it does `router.back()` if
  `canGoBack()`, else `router.replace('/(tabs)')`. Storage key
  `sapsut.teamSession.v1` (SecureStore native, AsyncStorage web); legacy
  `sapsut.teamId.*` keys are removed on first read.
- Interfaces/contracts other tickets rely on (all from `@/lib/team-session`):
  - `type TeamSession = { teamId: string; teamName: string; token: string; expiresAt: number /* epoch ms */ }`
  - `getTeamSession(): Promise<TeamSession | null>` (expired reads as null)
  - `joinTeam(inviteCode: string): Promise<TeamSession>` (saves; throws
    `AppError`: `status 404` + "No team with that code." for unknown code,
    `kind 'network'` when unreachable, else `kind 'server'`; all have
    user-facing `message`)
  - `leaveTeam(): Promise<void>` (local clear only)
  - `teamHeaders(token: string): Record<string, string>` -> `{ 'X-Team-Token': token }`
  - `withTeamToken<T>(run: (token: string) => Promise<T>): Promise<T>`
  - `teamJson<T>(path: string, init?: HttpJsonInit): Promise<T>` (adds
    `X-Team-Token`; caller supplies `content-type` and `body` for JSON posts)
  - `useTeamSession(): { session: TeamSession | null; isLoading: boolean }`;
    also `subscribeTeamSession(listener): () => void`
  - "No session" detection: `withTeamToken`/`teamJson` throw before any network
    call with `NoTeamSessionError` (an `AppError` with `kind 'unknown'`,
    `status 401`, `code 'no_team_session'`, message "Join a team to continue.").
    Test with `isNoTeamSessionError(err)`. Screens using the hook check
    `session === null` (after `isLoading` is false). A server 401 clears the
    session (listeners fire) and rethrows the original 401 `AppError`, which
    is not a `NoTeamSessionError`; callers can treat both as "go to /team".
  - Compat: `getSavedTeamId('participant')` -> session `teamId` or null,
    `getSavedTeamId('organizer')` -> null; `saveTeamId` / `clearSavedTeamId`
    are `@deprecated` no-ops; `TeamIdScope` kept (`@deprecated`). M-02 deletes.
  - Route: `/team` (typed route now exists).
- Known gaps or follow-ups: not run against a live backend (T-11 not written).
  Join now sends the code trimmed and upper-cased; the backend must
  issue upper-case codes or compare case-insensitively.
  The hook does not re-render on passive expiry (only on the next
  `getTeamSession()` call or change). Checks: `npx tsc --noEmit` and
  `npx expo lint` pass; prettier clean on owned files.
- Blocked reason (if blocked): none
