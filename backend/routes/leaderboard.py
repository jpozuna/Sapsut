from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/")
def get_leaderboard():
    return {"teams": []}

