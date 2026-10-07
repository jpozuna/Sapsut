from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

_DEFAULT_CORS_ORIGINS = "http://localhost:8081,http://localhost:19006"


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOW_ORIGINS") or _DEFAULT_CORS_ORIGINS
    return [o.strip() for o in raw.split(",") if o.strip() and o.strip() != "*"]


app = FastAPI(title="Sapsut API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

from routes import leaderboard, organizer, submissions, tasks, teams  # noqa: E402

app.include_router(submissions.router, prefix="/submissions", tags=["submissions"])
app.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
app.include_router(leaderboard.router, prefix="/leaderboard", tags=["leaderboard"])
app.include_router(teams.router, prefix="/teams", tags=["teams"])
app.include_router(organizer.router, prefix="/organizer", tags=["organizer"])


@app.get("/health")
def health():
    return {"status": "ok", "env": os.getenv("ENV", "dev")}