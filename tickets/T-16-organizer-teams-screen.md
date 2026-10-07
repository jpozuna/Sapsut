# T-16: Organizer Teams screen

Status: done
Branch: t-16-organizer-teams-screen

## Goal

Organizers can create teams and see every team's invite code in the app, so
they can hand codes to players before and during the event.

## Done when

- [x] New `app/(tabs)/organizer/teams.tsx`: a create form (team name, 1-80
      chars) that calls `POST /teams/` through `organizerJson` and shows the new
      invite code prominently. Below it, a list from `GET /teams/` with name,
      invite code (large, monospace, selectable) and score, plus pull-to-refresh,
      loading, empty and error states.
- [x] Each invite code has a Copy action if a clipboard module is already
      installed; otherwise the text is selectable and no dependency is added.
- [x] `app/(tabs)/organizer/_layout.tsx` registers `teams`.
      `app/(tabs)/organizer/create-task.tsx` gets a "Teams" link next to its
      existing Review/History links; nothing else in that file changes.
- [x] The screen uses `organizerJson(path, init)` (two-argument form) and no
      organizer code field.
- [x] Repo checks pass.

## Owns

- app/(tabs)/organizer/teams.tsx (new)
- app/(tabs)/organizer/\_layout.tsx
- app/(tabs)/organizer/create-task.tsx

## Reads (not edits)

- lib/organizer-api.ts
- app/(tabs)/organizer/review.tsx, app/(tabs)/organizer/history.tsx (layout style)
- components/ui/, constants/theme.ts
- package.json (which clipboard module, if any, is installed)
- tickets/BOARD.md (contract section)

## Depends on

- T-11 (needs: `POST /teams/` and `GET /teams/` shapes)

## Specialists

- tests: no (no frontend test framework)
- research: no
- extra: ui-ux-reviewer

## Handoff

- What changed: new `app/(tabs)/organizer/teams.tsx`. A create form
  (name trimmed, 1-80 chars) calls `POST /teams/` through
  `organizerJson('/teams/', init)` and shows the new invite code in a
  highlighted card. Below it, `GET /teams/` renders name, invite code and
  score per team, with pull-to-refresh, reload on focus, skeleton, empty and
  error (with retry) states. A name problem (client check or 422) is a field
  error; network, 400 and 500 failures are a separate notice, so the typed
  name is kept. Codes are large, monospace, `selectable` (long-press to
  copy), spelled out for screen readers, and never logged. The `_layout.tsx`
  registers `teams`; `create-task.tsx` has a "Teams" pill after History.
- Clipboard: no clipboard module is installed (`package.json` and
  `node_modules` have none), so there is no Copy button and no dependency was
  added. Codes are selectable, with a hint to press and hold.
- Interfaces/contracts other tickets rely on: none. Route
  `/(tabs)/organizer/teams`. The screen sends no organizer code.
- Known gaps or follow-ups: `npx tsc --noEmit` reports a typed-route error
  for `/(tabs)/organizer/teams` (and for `/team` in T-14/T-15 files) because
  the git-ignored `.expo/types/router.d.ts` is stale; it clears when the dev
  server regenerates it. No other type errors. A Copy button would need
  `expo-clipboard` added by the manager. The history and review screens'
  segment rows do not link to Teams (outside Owns).
- Blocked reason (if blocked): none

## Review round

- Loading: `isLoading` starts true (skeletons on first frame). Data is applied
  only for the latest request, but both spinner flags clear when the last
  in-flight request settles (in-flight counter), so a superseded request can't
  strand them. After a create the list reloads in a new `quiet` mode with no
  spinner.
- Create failure notice uses `wifi.slash` for network errors and the
  exclamation triangle for server errors.
- List bottom padding is `TAB_BAR_CLEARANCE + Spacing.base`. KeyboardAvoidingView
  uses `behavior="padding"` on both platforms with `Spacing.xxl` offset.
- Invite code: `numberOfLines={1}`, `adjustsFontSizeToFit`,
  `minimumFontScale={0.6}`, `maxFontSizeMultiplier={1.3}`, style from
  `Typography.numericLarge` plus `FontFamily.mono`. The accessible wrapper and
  hidden child are gone; the label sits on the selectable `Text`.
- After create: `Keyboard.dismiss()` and scroll the list to the top. The
  "press and hold to copy" hint now shows once under "All teams". The created
  card clears on blur (`useFocusEffect` cleanup). Dismiss uses the `HitSlop`
  token.
- `create-task.tsx`: nav pills get `minHeight: 44` and `justifyContent:
'center'`; the row wraps (`flexWrap: 'wrap'`, existing `gap`). Only nav
  styles changed.
- Checks: `npx tsc --noEmit` has one error, in `app/(tabs)/settings.tsx`
  (another worker's file, `accessibilityHint` on `AppCard`); none in owned
  files. `npx expo lint` and prettier on owned files pass.
