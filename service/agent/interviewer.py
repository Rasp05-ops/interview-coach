"""Interviewer supervisor loop.

One `decide` = a bounded tool-calling loop that must end in exactly one speaking action
(ask / interject / wrap_up). Hard guarantees, enforced in code and independent of model behaviour:
  * the loop never exceeds `max_llm_steps_per_decision`
  * if the model never produces a valid action, a deterministic fallback acts instead
  * budget, follow-up depth and evidence integrity are enforced by the tools (see tools.py)

Two evaluation modes:
  inline  the interviewer logs evidence/claims itself before choosing its next move (simple, more latency)
  async   a separate Evaluator agent scores the answer in parallel, off the critical path; the interviewer
          decides immediately and the ledger catches up before the next answer is processed
"""
from __future__ import annotations

import json
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Optional

from .agentic_rag import AgenticRAG, StaticRAG
from .blackboard import Blackboard, DeliverySignals
from .evaluator import Evaluator
from .heuristics import vagueness_signal
from .llm import LLM
from .loop import run_tool_loop
from .memory import curate
from .retrieval import InMemoryMemory, Retriever, search_bank
from .scoring import build_report
from .tools import ToolBox

_COMMON = """You are a senior interviewer conducting a live voice interview. You act ONLY through tools.

SPEAKING: you speak by calling exactly one of `ask`, `interject`, or `wrap_up`. Everything else is thinking/bookkeeping.

GROUNDING: use `retrieve_evidence` (verify a claim, ground a question, find a JD requirement), `search_bank`, `recall_sessions`. Never invent resume facts. If evidence is insufficient, say so and ask the candidate.

EVERY `ask` must declare `expected_structure`: star_story (behavioral story), think_aloud (technical or quantitative reasoning; the candidate will pause to think, so silence is normal), short_answer, or open. This tells turn-taking how patient to be.
STYLE: one question at a time, under 40 words, natural spoken English. Do not reveal scores or that you are logging evidence.
If a tool returns an error, read it and correct your call."""

_NEXT_MOVE = """Check these IN ORDER and act on the FIRST one that applies — do not skip ahead to "cover a new competency" just because it is easier:
   1. The answer is flagged SIGNAL: vague below, or is otherwise vague/unquantified/"we" without a personal role, AND you have not already reached the follow-up limit -> `ask` with intent=probe, citing the candidate's own words. Do this BEFORE moving to a new competency.
   2. The answer contradicts the resume or claims something you cannot find on it -> intent=challenge (politely; you may be wrong).
   3. The candidate is rambling with no new content -> `interject`.
   4. Otherwise, if a competency in the plan has zero logged evidence (check "avg_rubric" in the plan below — null means uncovered) -> new_topic on it.
   5. Enough is covered, or budget/time is exhausted -> `wrap_up`."""

# Inline-only: async mode doesn't expose `log_evidence` in its toolset (a separate evaluator calls it instead),
# so this instruction must never reach PROMPT_ASYNC — the model tried to call it anyway and Groq 400'd
# ("tool call validation failed... not in request.tools") because the tool isn't declared for that mode.
_ALWAYS_LOG = "\nALWAYS call `log_evidence` for the answer you were just given before deciding the next move (steps 1-5), even if you also decide to probe — do not skip logging just because you're following up."

PROMPT_INLINE = _COMMON + f"""

EACH TIME THE CANDIDATE ANSWERS, in this order:
1. Log evidence: for each competency the answer demonstrates, call `log_evidence` with the candidate's EXACT words and a 1-5 rubric level (use `get_rubric`). Quotes are verified; paraphrases are rejected.
2. Track claims: `add_claim` for checkable statements; verify with `check_consistency` / `retrieve_evidence`, then `resolve_claim`.
3. Decide the next move:
{_NEXT_MOVE}{_ALWAYS_LOG}"""

PROMPT_ASYNC = _COMMON + f"""

A separate evaluator logs evidence and verifies claims for each answer IN PARALLEL; you do not. Evidence for the newest answer may not be visible yet, so decide from your own reading of the answer plus the state you are given.
EACH TIME THE CANDIDATE ANSWERS, decide the next move:
{_NEXT_MOVE}"""

_STATE_TOOLS_INLINE = {"search_resume", "search_jd", "search_bank", "get_rubric", "recall_sessions", "retrieve_evidence",
                       "update_plan", "add_claim", "resolve_claim", "check_consistency", "log_evidence", "verify_quote",
                       "set_patience", "budget_status", "ask", "interject", "wrap_up"}
_STATE_TOOLS_ASYNC = _STATE_TOOLS_INLINE - {"add_claim", "resolve_claim", "log_evidence", "check_consistency", "verify_quote"}


class Action(dict):
    """A plain dict with attribute-style convenience for kind/text."""
    @property
    def kind(self) -> str:
        return self["kind"]

    @property
    def text(self) -> str:
        return self["text"]


class InterviewerAgent:
    def __init__(self, llm: LLM, board: Blackboard, retriever: Retriever,
                 memory: Optional[InMemoryMemory] = None, *,
                 evaluator_mode: str = "inline", evaluator_llm: Optional[LLM] = None,
                 agentic_rag: bool = False, rag_llm: Optional[LLM] = None):
        if evaluator_mode not in ("inline", "async"):
            raise ValueError("evaluator_mode must be 'inline' or 'async'")
        self.llm, self.board, self.retriever, self.memory = llm, board, retriever, memory
        self.mode = evaluator_mode
        self.rag = AgenticRAG(rag_llm or llm, retriever) if agentic_rag else StaticRAG(retriever)
        self.toolbox = ToolBox(board, retriever, memory, rag=self.rag,
                               allowed=_STATE_TOOLS_ASYNC if evaluator_mode == "async" else _STATE_TOOLS_INLINE)
        self.system = PROMPT_ASYNC if evaluator_mode == "async" else PROMPT_INLINE
        self._pool: Optional[ThreadPoolExecutor] = None
        self._futures: dict[int, Future] = {}
        self.evaluator: Optional[Evaluator] = None
        if evaluator_mode == "async":
            self.evaluator = Evaluator(evaluator_llm or llm, board, retriever, memory, rag=self.rag)
            self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="evaluator")
        self._finished = False

    # ── public API ───────────────────────────────────────────────────────────
    def start(self) -> Action:
        b = self.board
        weak = self.memory.weak_spots() if self.memory else []
        prior = ("Previous sessions flagged these weak spots (include them in the plan and probe them): "
                 + "; ".join(f"{w['topic']} ({w['count']}x)" for w in weak) + ".\n") if weak else ""
        msg = (f"New interview. Role: {b.role or 'unspecified'} at {b.company or 'a company'}.\n"
             f"Company research: {b.company_context or '(not provided)'}\n"
               f"Resume sections available: {self.retriever.sections() or ['(unstructured)']}. "
               f"Resume chunks: {len(self.retriever.resume.spans)}, JD chunks: {len(self.retriever.jd.spans)}.\n{prior}"
               "First call `update_plan` with 4-6 competencies suited to this role (highest priority first), "
               "retrieve evidence from the resume/JD, then `ask` an opening question (intent=new_topic).")
        return self._decide(msg)

    def answer(self, text: str, delivery: Optional[DeliverySignals] = None) -> Action:
        b = self.board
        if b.done:
            raise ValueError("interview already finished")
        self.join_evaluations()                      # ledger is complete for all previous turns before we decide
        turn = b.record_answer(text, delivery)
        if self._pool is not None:
            self._futures[turn.index] = self._pool.submit(self._run_eval, turn.index)
        d = turn.delivery
        exhausted = b.turns_left() <= 0 or b.time_exhausted()
        flagged, reasons = vagueness_signal(turn.answer)
        signal = f"SIGNAL: this answer looks vague ({'; '.join(reasons)}). Probe it unless the follow-up limit is reached.\n" if flagged else ""
        msg = (f"State: {json.dumps(b.snapshot())}\n\n"
               f"Question {turn.index} ({turn.intent}, {turn.competency}): {turn.question}\n"
               f"Candidate answer: \"{turn.answer}\"\n"
               f"{signal}"
               f"Delivery: {d.audio_seconds:.0f}s, {d.wpm:.0f} wpm, {d.filler_count} fillers, "
               f"{d.long_pause_count} long pauses, first word after {d.first_word_delay_s:.1f}s.\n"
               + ("Budget is exhausted: " + ("call wrap_up.\n" if self.mode == "async" else "log evidence for this answer, then call wrap_up.\n") if exhausted else ""))
        return self._decide(msg)

    def join_evaluations(self, timeout: float = 60.0) -> None:
        for idx, fut in list(self._futures.items()):
            try:
                fut.result(timeout=timeout)
            except Exception as e:                   # evaluator must never take the session down
                self.board.emit("evaluator", "failed", turn=idx, error=f"{type(e).__name__}: {e}")
            self._futures.pop(idx, None)

    def report(self) -> dict:
        self.join_evaluations()
        return build_report(self.board)

    def finish(self) -> dict:
        """Join evaluators, build the report, and write curated notes to memory (once)."""
        rep = self.report()
        if self.memory is not None and not self._finished:
            for n in curate(rep):
                self.memory.add(n["topic"], n["note"], n["kind"])
            self.board.emit("coach", "memory_updated")
        self._finished = True
        return rep

    def close(self) -> None:
        if self._pool is not None:
            self._pool.shutdown(wait=True)

    # ── internals ────────────────────────────────────────────────────────────
    def _run_eval(self, turn_index: int) -> None:
        assert self.evaluator is not None
        self.evaluator.assess(turn_index)

    def _decide(self, user_message: str) -> Action:
        action = run_tool_loop(self.llm, self.toolbox, self.board, self.system, user_message,
                               self.board.budget.max_llm_steps_per_decision, "interviewer",
                               nudge="You must act through a tool. Call `ask`, `interject`, or `wrap_up` (after any bookkeeping).")
        return Action(action) if action else self._fallback("no valid action within step limit")

    def _fallback(self, reason: str) -> Action:
        """Deterministic action when the model fails to produce one. Goes through the same guardrailed tools."""
        b = self.board
        b.emit("interviewer", "fallback", reason=reason)
        if b.pending_turn() is None and b.turns_left() > 0 and not b.time_exhausted():
            if not b.plan:
                self.toolbox.execute("update_plan", {"competencies": ["motivation_fit", "ownership", "technical_depth", "problem_solving"]})
            cov = b.coverage()
            for comp in sorted(b.plan, key=lambda c: (cov.get(c, 0), b.plan.index(c))):
                options = search_bank(comp, "medium", [t.question for t in b.turns])
                if options:
                    res = self.toolbox.execute("ask", {
                        "question": options[0]["q"], "intent": "new_topic", "competency": comp,
                        "expected_structure": "think_aloud" if comp in ("problem_solving", "technical_depth") else "star_story"})
                    if res.get("ok"):
                        return Action(res["action"])
        res = self.toolbox.execute("wrap_up", {"message": "Thanks, that's all the time we have. Let's review how it went."})
        if res.get("ok"):
            return Action(res["action"])
        pending = b.pending_turn()
        return Action({"kind": "ask", "text": pending.question if pending else "Could you say a bit more about that?",
                       "intent": "clarify", "turn_index": pending.index if pending else None,
                       "patience": b.patience.model_dump(), "fallback": True})