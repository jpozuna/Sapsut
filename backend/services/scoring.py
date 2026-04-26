from __future__ import annotations

import base64
import json
import math
import os
import mimetypes
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import anyio
import anthropic
import openai

from services import get_supabase
from services.storage import storage_bucket


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


def _cosine_similarity(a: Iterable[float], b: Iterable[float]) -> float:
    a_list = list(a)
    b_list = list(b)
    if len(a_list) != len(b_list) or not a_list:
        return float("-inf")
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a_list, b_list):
        fx = float(x)
        fy = float(y)
        dot += fx * fy
        na += fx * fx
        nb += fy * fy
    if na <= 0.0 or nb <= 0.0:
        return float("-inf")
    return dot / (math.sqrt(na) * math.sqrt(nb))


def _embed_text(openai_client: openai.OpenAI, text: str) -> List[float]:
    resp = openai_client.embeddings.create(model="text-embedding-3-small", input=text)
    return list(resp.data[0].embedding)


def _mark_submission_error(
    supabase,
    submission_id: str,
    message: str,
    *,
    ai_result: Optional[Dict[str, Any]] = None,
):
    payload: Dict[str, Any] = {"status": "error", "rationale": message}
    if ai_result is not None:
        payload["ai_result"] = ai_result
    supabase.table("submissions").update(payload).eq("id", submission_id).execute()


def _mime_type_from_path(path: str) -> str:
    mt, _ = mimetypes.guess_type(path)
    if mt and mt.startswith("image/"):
        return mt
    return "image/jpeg"


async def score_submission(
    submission_id: str,
    task_id: str,
    team_id: str,
    text_answer: Optional[str],
    photo_path: Optional[str],
):
    try:
        supabase = get_supabase()

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

        openai_client = _get_openai_client()
        anthropic_client = _get_anthropic_client()

        # Fetch task details
        task = supabase.table("tasks").select("*").eq("id", task_id).single().execute().data
        max_points = int(task.get("max_points", 0) or 0)

        # Get GPT-4o description if photo submission
        gpt4o_description = None
        if photo_path:
            try:
                # Supabase Storage download is synchronous; offload to worker thread.
                photo_bytes = await anyio.to_thread.run_sync(
                    lambda: supabase.storage.from_(storage_bucket()).download(photo_path)
                )
            except Exception as e:
                _mark_submission_error(
                    supabase,
                    submission_id,
                    f"Storage download failed for photo_path={photo_path}: {e}",
                    ai_result={"mode": "storage_download", "photo_path": photo_path, "error": str(e)},
                )
                return

            b64 = base64.b64encode(photo_bytes).decode("utf-8")
            image_mime = _mime_type_from_path(photo_path)
            try:
                response = openai_client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{b64}"}},
                                {"type": "text", "text": "Describe exactly what you see in this image in detail."},
                            ],
                        }
                    ],
                )
                gpt4o_description = response.choices[0].message.content
            except Exception as e:
                _mark_submission_error(
                    supabase,
                    submission_id,
                    f"GPT-4o image description failed: {e}",
                    ai_result={"mode": "gpt4o_describe", "error": str(e)},
                )
                return

        # If text answer is provided, check for exact match
        normalized_text_answer = text_answer or ""
        if normalized_text_answer and not photo_path:
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
                if normalized_text_answer.strip().lower() == c["value"].strip().lower():
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
        submission_text = gpt4o_description or normalized_text_answer
        if not submission_text.strip():
            _mark_submission_error(
                supabase,
                submission_id,
                "No submission content to score (empty text and no photo description).",
                ai_result={"mode": "empty_submission"},
            )
            return
        # RAG: embed submission_text and retrieve top matching criteria by cosine similarity.
        retrieved_criteria: List[Dict[str, Any]] = []
        if submission_text.strip():
            try:
                submission_embedding = _embed_text(openai_client, submission_text)
            except Exception as e:
                _mark_submission_error(
                    supabase,
                    submission_id,
                    f"Embedding call failed: {e}",
                    ai_result={"mode": "embed_submission", "error": str(e)},
                )
                return

            try:
                criteria_rows = (
                    supabase.table("task_criteria")
                    .select("value,criteria_type,embedding")
                    .eq("task_id", task_id)
                    .execute()
                    .data
                )
            except Exception:
                criteria_rows = []

            scored: List[Tuple[float, Dict[str, Any]]] = []
            for row in criteria_rows or []:
                emb = row.get("embedding")
                if not emb:
                    continue
                try:
                    sim = _cosine_similarity(submission_embedding, emb)
                except Exception:
                    continue
                if sim == float("-inf"):
                    continue
                scored.append((sim, row))

            scored.sort(key=lambda t: t[0], reverse=True)
            for sim, row in scored[:5]:
                retrieved_criteria.append(
                    {"value": row.get("value"), "criteria_type": row.get("criteria_type"), "similarity": sim}
                )

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
        retrieved_text = "\n".join(
            [
                f"- ({c.get('criteria_type')}, sim={c.get('similarity'):.3f}) {c.get('value')}"
                for c in retrieved_criteria
                if c.get("value")
            ]
        )

        prompt = f"""Task: {task['title']}
Description: {task['description']}

Relevant criteria (all):
{criteria_text}

Top semantically relevant criteria (retrieved):
{retrieved_text or "- (none)"}

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
                    "ai_result": {
                        "raw_text": raw_text,
                        "error": str(e),
                        "retrieved_criteria": retrieved_criteria,
                    },
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
                ai_result={
                    "mode": "llm",
                    "threshold": threshold,
                    "raw": parsed.raw,
                    "retrieved_criteria": retrieved_criteria,
                },
            )
        else:
            supabase.table("submissions").update(
                {
                    "status": "flagged",
                    "score": parsed.score,
                    "confidence": parsed.confidence,
                    "rationale": parsed.rationale,
                    "gpt4o_description": gpt4o_description,
                    "ai_result": {
                        "mode": "llm",
                        "threshold": threshold,
                        "raw": parsed.raw,
                        "retrieved_criteria": retrieved_criteria,
                    },
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
            _mark_submission_error(supabase, submission_id, f"Scoring exception: {e}")
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