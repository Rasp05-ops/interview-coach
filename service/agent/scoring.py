"""Deterministic scoring from the evidence ledger. No LLM in this file — by design.

The model's job is to find and quote evidence and assign a rubric level; the arithmetic that turns
evidence into scores and the final report is plain code so it is reproducible and testable.
"""
from __future__ import annotations

from .blackboard import Blackboard

WEAK_THRESHOLD = 2.5   # mean rubric level (1-5) at or below this counts as a gap


def _weights(n: int) -> list[int]:
    # plan is ordered by priority: first 3 carry weight 3, next 3 weight 2, rest weight 1
    return [3 if i < 3 else 2 if i < 6 else 1 for i in range(n)]


def competency_scores(board: Blackboard) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for comp in board.plan:
        ev = [e for e in board.evidence if e.competency == comp]
        mean = sum(e.score for e in ev) / len(ev) if ev else None
        out[comp] = {
            "n_evidence": len(ev),
            "mean_level": round(mean, 2) if mean is not None else None,
            "score_10": round(mean * 2, 1) if mean is not None else None,
            "quotes": [{"turn": e.turn, "quote": e.quote, "score": e.score} for e in ev],
        }
    return out


def overall_score(board: Blackboard) -> float | None:
    scored = [(c, s) for c, s in competency_scores(board).items() if s["mean_level"] is not None]
    if not scored:
        return None
    w = dict(zip(board.plan, _weights(len(board.plan))))
    num = sum(w[c] * s["mean_level"] for c, s in scored)
    den = sum(w[c] for c, _ in scored)
    return round(num / den * 2, 1)


def delivery_summary(board: Blackboard) -> dict:
    ans = [t for t in board.turns if t.answer]
    if not ans:
        return {}
    secs = sum(t.delivery.audio_seconds for t in ans)
    fillers = sum(t.delivery.filler_count for t in ans)
    return {
        "answers": len(ans),
        "total_speaking_s": round(secs, 1),
        "avg_wpm": round(sum(t.delivery.wpm for t in ans) / len(ans), 1),
        "fillers_per_min": round(fillers / (secs / 60), 2) if secs > 0 else None,
        "long_pauses": sum(t.delivery.long_pause_count for t in ans),
    }


def build_report(board: Blackboard) -> dict:
    scores = competency_scores(board)
    gaps = [c for c, s in scores.items() if s["mean_level"] is None or s["mean_level"] <= WEAK_THRESHOLD]
    return {
        "role": board.role, "company": board.company,
        "overall_score_10": overall_score(board),
        "competencies": scores,
        "gaps": gaps,
        "unscored": [c for c, s in scores.items() if s["n_evidence"] == 0],
        "claims": [c.model_dump() for c in board.claims],
        "delivery": delivery_summary(board),
        "turns": [{"i": t.index, "intent": t.intent, "competency": t.competency,
                   "question": t.question, "answer": t.answer} for t in board.turns],
        "questions_asked": len(board.turns),
    }
