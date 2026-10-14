from types import SimpleNamespace

import pytest

from services.rate_limit import (
    SlidingWindowLimiter,
    client_ip,
    reset_all_limiters,
    too_many_requests,
)


@pytest.fixture()
def clock():
    return [1000.0]


def make(clock, max_events=3, window=60, **kwargs):
    limiter = SlidingWindowLimiter(max_events, window, **kwargs)
    limiter.clock = lambda: clock[0]
    return limiter


def test_limit_is_per_key(clock):
    limiter = make(clock)
    for _ in range(3):
        assert limiter.reserve("a")[0] is None
    assert limiter.reserve("a")[0] is not None
    assert limiter.reserve("b")[0] is None


def test_blocked_key_gets_retry_after_and_block_does_not_extend(clock):
    limiter = make(clock)
    for _ in range(3):
        limiter.reserve("a")

    retry_after, _ = limiter.reserve("a")
    assert retry_after is not None and retry_after >= 1
    assert retry_after == 61

    clock[0] += 59
    for _ in range(5):
        retry_after, _ = limiter.reserve("a")
        assert retry_after is not None and retry_after >= 1
    assert len(limiter._events["a"]) == 3

    clock[0] += 2
    assert limiter.reserve("a")[0] is None


def test_retry_after_is_at_least_one_second_near_expiry(clock):
    limiter = make(clock, max_events=1)
    limiter.reserve("a")
    clock[0] += 59.9999
    retry_after, _ = limiter.reserve("a")
    assert retry_after == 1


def test_release_gives_back_a_slot(clock):
    limiter = make(clock, max_events=1)
    _, reserved_at = limiter.reserve("a")
    assert limiter.reserve("a")[0] is not None
    limiter.release("a", reserved_at)
    assert "a" not in limiter._events
    assert limiter.reserve("a")[0] is None


def test_release_of_unknown_slot_is_a_noop(clock):
    limiter = make(clock, max_events=1)
    limiter.release("missing", 1.0)
    limiter.reserve("a")
    limiter.release("a", 12345.0)
    assert len(limiter._events["a"]) == 1


def test_events_age_out_after_the_window(clock):
    limiter = make(clock)
    for _ in range(3):
        limiter.reserve("a")
    clock[0] += 59
    assert limiter.reserve("a")[0] is not None
    clock[0] += 1
    assert limiter.reserve("a")[0] is None


def test_key_cap_evicts_the_oldest_key(clock):
    limiter = make(clock, max_keys=3)
    for key in ("k1", "k2", "k3"):
        limiter.reserve(key)
        clock[0] += 1
    limiter.reserve("k4")
    assert list(limiter._events) == ["k2", "k3", "k4"]
    limiter.reserve("k3")
    assert list(limiter._events) == ["k2", "k3", "k4"]


def test_sweep_drops_expired_keys(clock):
    limiter = make(clock, sweep_every=3)
    limiter.reserve("old")
    clock[0] += 61
    limiter.reserve("x")
    limiter.reserve("x")
    assert set(limiter._events) == {"x"}


def test_reset_all_limiters_clears_every_instance(clock):
    first = make(clock, max_events=1)
    second = make(clock, max_events=1)
    first.reserve("a")
    second.reserve("b")
    reset_all_limiters()
    assert first._events == {} and second._events == {}
    assert first.reserve("a")[0] is None
    assert second.reserve("b")[0] is None


def test_reset_clears_one_instance(clock):
    limiter = make(clock, max_events=1)
    limiter.reserve("a")
    limiter.reset()
    assert limiter.reserve("a")[0] is None


def test_too_many_requests_is_a_429_with_retry_after():
    exc = too_many_requests(42, "slow down")
    assert exc.status_code == 429
    assert exc.detail == "slow down"
    assert exc.headers == {"Retry-After": "42"}
    assert too_many_requests(0, "x").headers == {"Retry-After": "1"}


def test_client_ip():
    assert client_ip(SimpleNamespace(client=SimpleNamespace(host="1.2.3.4"))) == "1.2.3.4"
    assert client_ip(SimpleNamespace(client=None)) == "unknown"
    assert client_ip(SimpleNamespace(client=SimpleNamespace(host=""))) == "unknown"
