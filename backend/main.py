from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(title="Sapsut API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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