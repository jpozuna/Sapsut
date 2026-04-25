from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional, Tuple

import anthropic
import openai

from services import get_supabase


def _get_openai_client() -> openai.OpenAI:
    return openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _get_anthropic_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def _auto_approve_threshold() -> float:
    """
    Default is 1.0 (only auto-approve when model is fully confident).
    Organizer can relax it down to 0.9 via env var; we clamp to [0.9, 1.0].
    """
    raw = os.getenv("AUTO_APPROVE_CONFIDENCE_THRESHOLD", "1.0").strip()
    try:
        val = float(raw)
    except Exception:
        val = 1.0
    return max(0.9, min(1.0, val))


@dataclass(frozen=True)
class ScoreResult:
    score: int
    confidence: float
    rationale: str
    raw: Dict[str, Any]


def _parse_score_json(text: str, *, max_points: int) -> ScoreResult:
    """
    Parse and validate Claude output. We require strict JSON.
    If parsing/validation fails, raise ValueError.
    """
    obj = json.loads(text)
    if not isinstance(obj, dict):
        raise ValueError("Scoring output must be a JSON object.")

    if "score" not in obj or "confidence" not in obj or "rationale" not in obj:
        raise ValueError("Scoring output missing required keys.")

    score = int(obj["score"])
    confidence = float(obj["confidence"])
    rationale = str(obj["rationale"])

    if score < 0 or score > int(max_points):
        raise ValueError("Score out of range.")
    if confidence < 0.0 or confidence > 1.0:
        raise ValueError("Confidence out of range.")
    if not rationale.strip():
        raise ValueError("Rationale must be non-empty.")

    return ScoreResult(score=score, confidence=confidence, rationale=rationale, raw=obj)

async def score_submission(submission_id: str, task_id: str, team_id: str, text_answer: str, photo):
    try:
        supabase = get_supabase()
        openai_client = _get_openai_client()
        anthropic_client = _get_anthropic_client()

        # Idempotency: if already finalized, don't rescore (prevents double-counting team totals).
        existing = (
            supabase.table("submissions")
            .select("status")
            .eq("id", submission_id)
            .single()
            .execute()
            .data
        )
        if existing and existing.get("status") in {"approved", "flagged", "rejected"}:
            return

        # Fetch task details
        task = supabase.table("tasks").select("*").eq("id", task_id).single().execute().data
        max_points = int(task.get("max_points", 0) or 0)

        # Get GPT-4o description if photo submission
        gpt4o_description = None
        if photo:
            photo_bytes = await photo.read()
            import base64
            b64 = base64.b64encode(photo_bytes).decode("utf-8")
            response = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                        {"type": "text", "text": "Describe exactly what you see in this image in detail."}
                    ]
                }]
            )
            gpt4o_description = response.choices[0].message.content

        # If text answer is provided, check for exact match
        if text_answer and not photo:
            try:
                criteria = (
                    supabase.table("task_criteria")
                    .select("value")
                    .eq("task_id", task_id)
                    .eq("criteria_type", "exact")
                    .execute()
                    .data
                )
            except Exception:
                criteria = []
            for c in criteria:
                if text_answer.strip().lower() == c["value"].strip().lower():
                    _finalize_score(
                        supabase,
                        submission_id,
                        team_id,
                        max_points,
                        1.0,
                        "Exact match",
                        "approved",
                        ai_result={"mode": "exact_match", "criteria": c.get("value")},
                    )
                    return

        # Step 3: Claude scoring
        submission_text = gpt4o_description or text_answer or ""
        try:
            criteria = (
                supabase.table("task_criteria")
                .select("value, criteria_type")
                .eq("task_id", task_id)
                .execute()
                .data
            )
        except Exception:
            criteria = []
        criteria_text = "\n".join([f"- {c['value']}" for c in criteria])

        prompt = f"""Task: {task['title']}
Description: {task['description']}

Relevant criteria:
{criteria_text}

Submission: {submission_text}

Score this submission. Return JSON only:
{{"score": <0 to {max_points}>, "confidence": <0.0 to 1.0>, "rationale": "<explanation>"}}"""

        message = anthropic_client.messages.create(
            model="claude-opus-4-5",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}]
        )

        raw_text = message.content[0].text if message.content else ""
        try:
            parsed = _parse_score_json(raw_text, max_points=max_points)
        except Exception as e:
            # Can't parse: send to review (with explanation)
            supabase.table("submissions").update(
                {
                    "status": "flagged",
                    "score": None,
                    "confidence": None,
                    "rationale": f"Scoring output was invalid JSON: {e}",
                    "gpt4o_description": gpt4o_description,
                    "ai_result": {"raw_text": raw_text, "error": str(e)},
                }
            ).eq("id", submission_id).execute()
            return

        threshold = _auto_approve_threshold()
        status = "approved" if parsed.confidence >= threshold else "flagged"

        if status == "approved":
            _finalize_score(
                supabase,
                submission_id,
                team_id,
                parsed.score,
                parsed.confidence,
                parsed.rationale,
                "approved",
                ai_result={"mode": "llm", "threshold": threshold, "raw": parsed.raw},
            )
        else:
            supabase.table("submissions").update(
                {
                    "status": "flagged",
                    "score": parsed.score,
                    "confidence": parsed.confidence,
                    "rationale": parsed.rationale,
                    "gpt4o_description": gpt4o_description,
                    "ai_result": {"mode": "llm", "threshold": threshold, "raw": parsed.raw},
                }
            ).eq("id", submission_id).execute()
            try:
                supabase.table("review_queue").insert(
                    {
                        "submission_id": submission_id,
                        "claude_rationale": parsed.rationale,
                        "claude_score": parsed.score,
                        "confidence": parsed.confidence,
                    }
                ).execute()
            except Exception:
                pass

    except Exception as e:
        try:
            supabase = get_supabase()
            supabase.table("submissions").update(
                {"status": "error", "rationale": f"Scoring exception: {e}"}
            ).eq("id", submission_id).execute()
        except Exception:
            pass
        print(f"Scoring error: {e}")


def _finalize_score(
    supabase,
    submission_id: str,
    team_id: str,
    score: int,
    confidence: float,
    rationale: str,
    status: str,
    ai_result: Optional[Dict[str, Any]] = None,
):
    supabase.table("submissions").update(
        {
            "status": status,
            "score": score,
            "confidence": confidence,
            "rationale": rationale,
            "ai_result": ai_result,
        }
    ).eq("id", submission_id).execute()
    
    # Update team total score
    try:
        team = supabase.table("teams").select("total_score").eq("id", team_id).single().execute().data
        new_total = (team["total_score"] or 0) + score
        supabase.table("teams").update({"total_score": new_total}).eq("id", team_id).execute()
    except Exception:
        pass