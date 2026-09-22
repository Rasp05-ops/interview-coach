"""Scripted stand-ins for the interviewer LLM, used for offline harness tests and --dry-run.

They are NOT a measure of real model behaviour. `baseline_policy` never probes; `probing_policy`
probes short/vague answers. Together they let us test that the behavioural checks can tell the two apart."""
from __future__ import annotations

from ..agent.blackboard import Blackboard
from ..agent.llm import LLMResponse, call

QUESTIONS = [
    "Tell me about the Kafka pipeline you built. What did you own?",
    "How does Kafka keep ordering within a partition, and where can it break?",
    "Estimate how many requests per second a service needs for a million daily users.",
    "Explain your EOT detection project to a non-technical friend.",
    "Describe a disagreement in a team and how it ended.",
    "What would you change about the codebase assistant design?",
    "Tell me about a bug that took a long time to find.",
    "Why this role, and why now?",
]
COMPS = ["ownership", "technical_depth", "problem_solving", "communication", "collaboration",
         "technical_depth", "problem_solving", "motivation_fit"]
PLAN = ["ownership", "technical_depth", "problem_solving", "communication", "collaboration", "motivation_fit"]


def _next_topic(board: Blackboard) -> LLMResponse:
    i = len(board.turns)
    q = QUESTIONS[i % len(QUESTIONS)]
    return call("ask", question=q, intent="new_topic", competency=COMPS[i % len(COMPS)],
                expected_structure="think_aloud" if "Estimate" in q or "How does" in q else "star_story")


def baseline_policy(board: Blackboard, wrap_after: int = 5):
    def fn(messages, tools):
        if not board.plan:
            return call("update_plan", competencies=PLAN)
        if board.turns_left() <= 0 or board.answered_count() >= wrap_after:
            return call("wrap_up", message="Thank you, that is everything from my side today.")
        return _next_topic(board)
    return fn


def probing_policy(board: Blackboard, wrap_after: int = 5, vague_words: int = 25):
    """Like baseline, but follows up (up to the guardrail) when the last answer is short or has no digits."""
    base = baseline_policy(board, wrap_after)
    def fn(messages, tools):
        last = board.last_answered_turn()
        if board.plan and last and board.pending_turn() is None and board.turns_left() > 0:
            vague = len(last.answer.split()) < vague_words or not any(ch.isdigit() for ch in last.answer)
            if vague and board.trailing_followups() < board.budget.max_probe_depth and board.answered_count() < wrap_after:
                return call("ask", question=f"Can you be more specific about that, turn {len(board.turns)}: what exactly did you do personally?",
                            intent="probe", competency=last.competency or board.plan[0], expected_structure="short_answer")
        return base(messages, tools)
    return fn
