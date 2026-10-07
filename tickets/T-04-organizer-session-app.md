# T-04: Secure, verified organizer session in the app

Status: done
Branch: t-04-organizer-session-app

## Goal

The organizer code is exchanged for a 24h server-signed token kept in secure
storage, the token is checked against the server on restore, and any 401 drops the user back to
participant.

## Done when

- [x] Entering a code in Settings calls `POST /organizer/session` with
      `X-Organizer-Code`. On 200 the app keeps the returned `token` and
      `expires_at`, and the plaintext code is never stored. 401 shows an
      "incorrect code" error, 429 a "too many attempts, try again in a few
      minutes" error, and a network failure a retryable error.
- [x] Every organizer request (`organizerJson`, `organizerUploadJson`) sends
      `Authorization: Bearer <token>` instead of `X-Organizer-Code`.
- [x] On native, `{ token, expiresAt }` is stored with `expo-secure-store`. An
      expired entry is treated as absent and deleted.
- [x] On web (`Platform.OS === 'web'`), the token is held in memory only (lost on
      reload) and never written to `localStorage`.
- [x] The old AsyncStorage key `sapsut.organizerCode.v1` is removed on launch.
- [x] On launch, a restored token is verified with `GET /organizer/session`.
      `isHydrating` stays true until verification finishes. On 401, the stored
      token is cleared and the role is participant. On a network failure, keep the
      organizer role (the server still authorizes every call).
- [x] Any organizer request that gets a 401 clears the stored token and switches
      to participant.
- [x] No organizer request is sent without a token (for example a screen firing
      before the session is restored), so participants never hit organizer routes.
- [x] Switching to participant clears the stored token.
- [x] Repo checks pass.

### Review round 2 (from code review and security audit)

- [x] Restore can't wipe a newer session: the launch-time 401 path clears the
      session only if the stored token is still the one that was verified (same
      stale-token guard as `handleOrganizerUnauthorized`). The first SecureStore
      read in `getOrganizerSession` doesn't overwrite a session saved while it
      was in flight.
- [x] Settings doesn't offer organizer sign-in while `isHydrating` is true.
- [x] `GET` and `POST /organizer/session` time out after about 10 seconds
      (`AbortController` signal passed through `httpJson`'s init; don't edit
      `lib/http.ts`). A verify timeout counts as unreachable, so hydration
      always finishes.
- [x] A missing or expired token while the role is organizer switches the app to
      participant: `withOrganizerToken` notifies the unauthorized listeners and
      throws an AppError with `status: 401`, not a plain Error. Listeners are
      notified synchronously once the in-memory session is nulled.
- [x] `signInWithOrganizerCode` no longer clears the existing session before the
      POST. It only sends `X-Organizer-Code`, and a successful sign-in replaces
      the session.
- [x] Native `SecureStore.setItemAsync` uses
      `keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- [x] `lib/organizer-upload.ts`: a fetch-level failure throws an AppError
      (`kind: 'network'`), and an array `detail` (FastAPI 422) becomes a
      readable message, not `[object Object]`. Header merge handles a `Headers`
      instance in `init.headers`.
- [x] Settings doesn't set state after unmount when `enterOrganizerMode` resolves.
- [x] Repo checks pass.

Out of scope (follow-ups on the board): removing the organizer code field and
deprecated overloads from the three organizer screens; rejecting a non-https
API base URL in production builds (`lib/api.ts`).

## Owns

- lib/organizer-session.ts
- lib/role-context.tsx
- lib/organizer-api.ts
- lib/organizer-upload.ts
- app/(tabs)/settings.tsx

## Reads (not edits)

- lib/http.ts
- lib/app-error.ts
- lib/api.ts
- backend/auth/organizer.py
- backend/routes/organizer.py
- package.json

## Depends on

- M-00 (needs: `expo-secure-store` installed in package.json)
- T-02 (needs: `POST`/`GET /organizer/session` token contract, Bearer auth and 401/429 behavior)

## Specialists

- tests: no
- research: no
- extra: security-auditor

## Handoff

Filled in by the ticket thread when finished.

- What changed:
  - `lib/organizer-session.ts`: token store (SecureStore on native, memory only
    on web, expired entry deleted), `signInWithOrganizerCode` (clears any stale
    token, sends only `X-Organizer-Code`, maps 401/429/network/other to
    user-facing AppError messages), `verifyOrganizerSession` (only 401 means
    invalid), `withOrganizerToken` (throws before any fetch when no token; on
    401 clears the token and notifies listeners, ignoring late 401s from a
    replaced token), `removeLegacyOrganizerCode` (AsyncStorage key).
  - `lib/role-context.tsx`: hydration removes the legacy key, restores the
    token, verifies it, keeps `isHydrating` true until done; 401 listener sets
    participant; `enterOrganizerMode(code)` is now async and rejects on failure.
  - `lib/organizer-api.ts`, `lib/organizer-upload.ts`: send
    `Authorization: Bearer <token>`. Upload errors are now AppErrors with status.
  - `app/(tabs)/settings.tsx`: awaits sign-in, shows the error in the modal,
    loading state, clears the draft code.
- Interfaces/contracts other tickets rely on:
  - New signatures: `organizerJson(path, init?)` and
    `organizerUploadJson(path, formData, init?)`. The old forms
    `(path, code, init?)` / `(path, code, formData, init?)` still compile
    (deprecated overloads); the code argument is ignored and never sent.
  - `useRole().organizerCode` is now only a non-secret marker (`'session'`
    while organizer, `''` otherwise); `setOrganizerCode` is a no-op;
    `setRole('organizer')` is a no-op (only `participant` has effect).
- Known gaps or follow-ups:
  - The organizer screens (`app/(tabs)/organizer/{create-task,review,history}.tsx`,
    not owned here) still show an "Organizer code" text field prefilled with the
    marker and gate on it being non-empty. They work through the compat shim but
    should be updated in a follow-up to drop the field and the code argument.
  - Not tested on a device or against a running backend; checks run:
    `npx tsc --noEmit`, `npx expo lint`, prettier on owned files all pass.
- Review round 2 (all items done):
  - `lib/organizer-session.ts`: `getOrganizerSession`'s first SecureStore read is
    deduped and only applied if no save/clear happened while it was in flight
    (`sessionVersion` counter). SecureStore writes/deletes go through a
    sequential queue so a late delete can't land after a newer save.
    `handleOrganizerUnauthorized` now returns a boolean, clears memory, and
    notifies listeners synchronously before awaiting the SecureStore delete.
    `withOrganizerToken` with a missing or expired token notifies listeners and
    throws `{ kind: 'unknown', status: 401 }` (an AppError), no fetch.
    `signInWithOrganizerCode` no longer clears first; it only sends
    `X-Organizer-Code` and replaces the session on success. GET and POST
    `/organizer/session` use a 10 s `AbortController` timeout through
    `httpJson`'s init (`signal` passes through via the `...init` spread, so
    `lib/http.ts` is untouched); a timeout is a `network` AppError, so verify
    returns `unreachable` and sign-in shows the retryable message. SecureStore
    save uses `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  - `lib/role-context.tsx`: the launch-time 401 path calls
    `handleOrganizerUnauthorized(session.token)` (stale-token guard) instead of
    `clearOrganizerSession`; the organizer role is only set if the stored token
    is still the verified one.
  - `lib/organizer-upload.ts`: fetch failures become AppErrors (via
    `toAppError`, so `kind: 'network'` for connection failures), FastAPI array
    `detail` becomes the joined `msg` strings, `Headers`/tuple-array
    `init.headers` are flattened, empty body is an AppError.
  - `app/(tabs)/settings.tsx`: the organizer button is disabled and the prompt
    won't open while `isHydrating`; no state updates or navigation after unmount.
  - Contract change: `handleOrganizerUnauthorized` returns `Promise<boolean>`
    (was `void`). Unauthorized listeners may now fire when a request is made
    with no session while the role is participant (harmless: sets participant).
  - Checks: `npx tsc --noEmit`, `npx expo lint`, prettier on owned files and the
    ticket pass. Not run on a device.
- Blocked reason (if blocked): n/a
