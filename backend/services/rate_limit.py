"""In-memory sliding-window rate limiter shared by the auth and route guards.

State is per process: it resets on restart and is not shared across workers.
Memory is bounded: expired keys are swept every ``sweep_every`` reservations and
at most ``max_keys`` keys are tracked (the oldest-tracked key is evicted first).
"""

from __future__ import annotations

import threading
import time
import weakref
from collections import deque
from typing import Callable, Deque, Dict, Optional, Tuple

from fastapi import HTTPException, Request

_instances: "weakref.WeakSet[SlidingWindowLimiter]" = weakref.WeakSet()
_instances_lock = threading.Lock()


class SlidingWindowLimiter:
    """At most ``max_events`` reserved events per key within ``window_seconds``."""

    def __init__(
        self,
        max_events: int,
        window_seconds: float,
        *,
        max_keys: int = 10_000,
        sweep_every: int = 100,
    ) -> None:
        self.max_events = max_events
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self.sweep_every = sweep_every
        self.clock: Callable[[], float] = time.monotonic
        self._events: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()
        self._reservations_since_sweep = 0
        with _instances_lock:
            _instances.add(self)

    def _prune(self, key: str, now: float) -> Optional[Deque[float]]:
        """Drop expired events for one key. Caller holds the lock. None if none left."""
        window = self._events.get(key)
        if window is None:
            return None
        while window and now - window[0] >= self.window_seconds:
            window.popleft()
        if not window:
            self._events.pop(key, None)
            return None
        return window

    def _sweep(self, now: float) -> None:
        """Prune every tracked key. Caller holds the lock."""
        for key in list(self._events):
            self._prune(key, now)

    def reserve(self, key: str) -> Tuple[Optional[int], float]:
        """Atomically check the limit and reserve a slot for ``key``.

        Returns ``(None, reserved_at)`` when a slot was taken (the caller keeps it, or
        calls ``release`` to give it back), or ``(retry_after_seconds, now)`` when the
        key is blocked. A blocked call takes no slot, so it does not extend the block.
        The check and the reservation happen under one lock acquisition, so concurrent
        callers cannot overshoot ``max_events``.
        """
        with self._lock:
            now = self.clock()
            self._reservations_since_sweep += 1
            if self._reservations_since_sweep >= self.sweep_every:
                self._reservations_since_sweep = 0
                self._sweep(now)

            window = self._prune(key, now)
            if window is not None and len(window) >= self.max_events:
                retry_after = int(self.window_seconds - (now - window[0])) + 1
                return max(1, retry_after), now

            if window is None:
                while len(self._events) >= self.max_keys:
                    self._events.pop(next(iter(self._events)))
                window = self._events.setdefault(key, deque())
            window.append(now)
            return None, now

    def release(self, key: str, reserved_at: float) -> None:
        """Give back a slot taken by ``reserve``."""
        with self._lock:
            window = self._events.get(key)
            if window is None:
                return
            try:
                window.remove(reserved_at)
            except ValueError:
                pass
            if not window:
                self._events.pop(key, None)

    def reset(self) -> None:
        """Forget every key (used by tests)."""
        with self._lock:
            self._events.clear()
            self._reservations_since_sweep = 0


def reset_all_limiters() -> None:
    """Reset every limiter instance created in this process (used by tests)."""
    with _instances_lock:
        limiters = list(_instances)
    for limiter in limiters:
        limiter.reset()


def client_ip(request: Request) -> str:
    """The direct peer address, or "unknown". Does not trust forwarding headers."""
    client = request.client
    return client.host if client and client.host else "unknown"


def too_many_requests(retry_after: int, detail: str) -> HTTPException:
    """A 429 carrying a ``Retry-After`` header (whole seconds, at least 1)."""
    return HTTPException(
        status_code=429,
        detail=detail,
        headers={"Retry-After": str(max(1, int(retry_after)))},
    )
