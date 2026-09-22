"""Behavioural and integrity checks over a finished session's blackboard.

INVARIANTS must hold for every session regardless of model; BEHAVIOURS are what we measure
(they depend on the model and on the persona) and are reported, not asserted."""
from __future__ import annotations

from difflib import SequenceMatcher

from ..agent.blackboard import FOLLOWUP_INTENTS, Blackboard
from ..agent.tools import quote_in_text


def invariants(board: Blackboard) -> dict[str, bool]:
    turns = board.turns
    qs = [t.question.lower() for t in turns]
    dup = any(SequenceMatcher(None, a, b).ratio() > 0.85 for i, a in enumerate(qs) for b in qs[i + 1:])
    streak = best = 0
    for t in turns:
        streak = streak + 1 if t.intent in FOLLOWUP_INTENTS else 0
        best = max(best, streak)
    by_turn = {t.index: t.answer for t in turns}
    return {
        "terminated": board.done,
        "within_question_budget": len(turns) <= board.budget.max_turns,
        "no_duplicate_questions": not dup,
        "probe_limit_respected": best <= board.budget.max_probe_depth,
        "all_evidence_quotes_verifiable": all(quote_in_text(e.quote, by_turn.get(e.turn, ""))[0] for e in board.evidence),
        "every_turn_declares_patience": all(t.expected_structure for t in turns),
    }


def behaviours(board: Blackboard, persona: str) -> dict[str, bool | None]:
    followups = [t for t in board.turns if t.intent in FOLLOWUP_INTENTS]
    out: dict[str, bool | None] = {"probed_at_least_once": bool(followups)}
    if persona == "vague":
        first_answered = next((t.index for t in board.turns if t.answer), None)
        out["probed_right_after_vague_answer"] = (
            first_answered is not None and first_answered + 1 < len(board.turns)
            and board.turns[first_answered + 1].intent in FOLLOWUP_INTENTS)
    if persona == "inflated":
        out["challenged_or_flagged_inflated_claim"] = any(
            c.status in ("contradicted", "unsupported") for c in board.claims) or any(
            t.intent == "challenge" for t in board.turns)
    if persona == "thinker":
        # the interviewer should give thinkers room: some question must invite think_aloud
        out["used_think_aloud_patience"] = any(t.expected_structure == "think_aloud" for t in board.turns)
    return out
