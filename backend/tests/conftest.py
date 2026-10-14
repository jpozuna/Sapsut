import os
import sys

import pytest


# Ensure `backend/` is on sys.path so `import services` works under pytest.
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    from services.rate_limit import reset_all_limiters

    reset_all_limiters()
    yield
