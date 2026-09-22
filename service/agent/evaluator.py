"""Evaluator: a second, non-speaking agent that scores ONE answer.

It uses the same guardrailed tools as the interviewer (so evidence quotes are still verified) but is pinned
to a single turn, so it can run in parallel with the interviewer without racing on 'latest answer'."""
from __future__ import annotations

from typing import Optional

from .blackboard import Blackboard
from .llm import LLM
from .loop import run_tool_loop
from .retrieval import InMemoryMemory, Retriever
from .tools import ToolBox

EVAL_TOOLS = {"log_evidence", "add_claim", "resolve_claim", "check_consistency", "verify_quote", "get_rubric",
              "retrieve_evidence", "search_resume", "finish_assessment"}

EVAL_SYSTEM = """You are an interview evaluator. You never speak to the candidate. You assess ONE answer using tools.

1. For each competency in the plan that the answer demonstrates (or fails to), call `log_evidence` with an EXACT quote from the answer and a 1-5 rubric level. Use `get_rubric` for anchors. Quotes are verified; paraphrases are rejected. Log 1-3 items, not more.
2. For each checkable claim (numbers, technologies, ownership), call `add_claim`, then verify with `retrieve_evidence` (purpose=verify_claim) or `check_consistency`, then `resolve_claim` (supported / contradicted / unsupported). Say 'unsupported' when the resume has nothing, 'contradicted' only when it says something different.
3. Finish with `finish_assessment` (one sentence)."""


class Evaluator:
    def __init__(self, llm: LLM, board: Blackboard, retriever: Retriever,
                 memory: Optional[InMemoryMemory] = None, rag=None, max_steps: int = 8):
        self.llm, self.board, self.retriever = llm, board, retriever
        self.memory, self.rag, self.max_steps = memory, rag, max_steps

    def assess(self, turn_index: int) -> Optional[str]:
        b = self.board
        with b.lock:
            turn = b.turns[turn_index]
            plan = list(b.plan)
            q, a, comp = turn.question, turn.answer, turn.competency
        tb = ToolBox(b, self.retriever, self.memory, rag=self.rag, allowed=EVAL_TOOLS, bound_turn=turn_index)
        user = (f"Plan competencies: {plan}\nQuestion ({comp}): {q}\nCandidate answer: \"{a}\"")
        action = run_tool_loop(self.llm, tb, b, EVAL_SYSTEM, user, self.max_steps, "evaluator")
        if action is None:
            b.emit("evaluator", "incomplete", turn=turn_index)
            return None
        b.emit("evaluator", "assessed", turn=turn_index, summary=action["text"])
        return action["text"]
