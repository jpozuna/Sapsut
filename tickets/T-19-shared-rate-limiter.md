# T-19: Shared in-memory rate limiter

Status: done
Branch: fix/56-abuse-limits

## Goal

Move the failed-code limiter in `backend/auth/organizer.py` into a reusable
`SlidingWindowLimiter` in `backend/services/rate_limit.py` (contract in
BOARD.md), with organizer code checks behaving exactly as before.

## Done when

- [x] `backend/services/rate_limit.py` exports `SlidingWindowLimiter`,
      `client_ip`, `too_many_requests` and `reset_all_limiters` with the
      signatures in the BOARD.md contract. No new dependency is added.
- [x] `require_organizer` uses one `SlidingWindowLimiter(10, 300)` instance;
      the reserve/release logic and the module-level `_failures`, `_lock`,
      `_reserve`, `_release`, `_prune` and `_sweep` helpers are gone from
      `backend/auth/organizer.py`. `reset_rate_limit()` and `MAX_FAILURES`,
      `WINDOW_SECONDS`, `RATE_LIMITED_DETAIL` stay importable from it.
- [x] Every existing test in `backend/tests/test_organizer_auth.py`,
      `test_organizer_gating.py` and `test_teams_routes.py` passes. Changes
      to `test_organizer_auth.py` are limited to monkeypatch targets (clock,
      sweep interval, key cap now set on the limiter instance); no assertion
      is removed or weakened.
- [x] New `backend/tests/test_rate_limit.py` covers: the limit is per key; a
      blocked key gets `retry_after >= 1` and the block does not extend while
      blocked; `release` gives back a slot; events age out after the window;
      the key cap evicts the oldest key; `reset_all_limiters()` clears every
      instance; `too_many_requests` returns a 429 with a `Retry-After` header.
- [x] `backend/tests/conftest.py` has an autouse fixture that calls
      `reset_all_limiters()` before each test.
- [x] Repo checks pass.

## Owns

- backend/services/rate_limit.py
- backend/auth/organizer.py
- backend/tests/test_rate_limit.py
- backend/tests/test_organizer_auth.py
- backend/tests/conftest.py

## Deletes

- none

## Reads (not edits)

- backend/tests/test_organizer_gating.py
- backend/tests/test_teams_routes.py
- tickets/BOARD.md (contract)

## Depends on

- none

## Specialists

- tests: no
- research: no
- extra: security-auditor
- verify-live: none

## Handoff

Filled in by the worker when finished.

- What changed: new `backend/services/rate_limit.py` (`SlidingWindowLimiter`,
  `client_ip`, `too_many_requests`, `reset_all_limiters`, per BOARD contract;
  instances tracked in a WeakSet). `auth/organizer.py` now uses
  `_limiter = SlidingWindowLimiter(MAX_FAILURES, WINDOW_SECONDS)`; the old
  helpers and constants `SWEEP_EVERY`/`MAX_TRACKED_IPS` are gone.
  `reset_rate_limit()` calls `_limiter.reset()`. Organizer tests now patch
  `organizer_auth._limiter` (`clock`, `sweep_every`, `max_keys`) and read
  `_limiter._events`; no assertion removed. conftest has an autouse
  `reset_all_limiters()` fixture.
- Interfaces/contracts other tickets rely on: exactly the BOARD.md contract.
  `retry_after` is `max(1, int(window - (now - oldest)) + 1)`;
  `too_many_requests` clamps the header to at least 1. Clock is read inside
  the lock. Internal state is `limiter._events` (key -> deque of timestamps).
- Tests per Done-when item: exports/no dependency: `test_rate_limit.py` imports;
  organizer wiring: `test_organizer_auth.py` (all pass); new coverage in
  `test_rate_limit.py` (per key, retry_after and no extension, release, age out,
  key cap, reset_all, 429 + Retry-After); conftest fixture autouse. Full
  backend suite 448 passed, ruff clean.
- Known gaps or follow-ups: none.
- Manager to delete: none
- Blocked reason (if blocked): n/a
