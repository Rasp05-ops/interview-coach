"""Typed tool layer. Every capability the interviewer has is a tool with a pydantic-validated schema.

Guardrails live HERE, in code, not in the prompt:
  * evidence can only be logged with a quote that actually appears in the candidate's answer
  * follow-up depth, question budget, session time, duplicate questions and early wrap-up are enforced
  * every `ask` must declare the expected answer structure, which sets the patience the
    turn-taking engine will use for that question (the agent -> EOT coupling)
A rejected call returns {"ok": False, "error": ...} so the model can recover; it never raises.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Callable, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from .blackboard import (FOLLOWUP_INTENTS, PATIENCE_MAX_HOLD_S, STRUCTURE_DEFAULT_PATIENCE, Blackboard, Patience)
from .agentic_rag import StaticRAG
from .retrieval import InMemoryMemory, Retriever, get_rubric, norm_competency, search_bank, tokenize


# ── quote verification ─────────────────────────────────────────────────────────
def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s%$.]", " ", s.lower())).strip()


def quote_in_text(quote: str, text: str, threshold: float = 0.9) -> tuple[bool, float]:
    """True if `quote` appears in `text` verbatim after normalisation, or nearly so.

    Supports ellipses: "we built X ... latency dropped" verifies each fragment independently.
    """
    parts = [p for p in re.split(r"\.{3}|…", quote) if len(_norm(p).split()) >= 3]
    if not parts:
        return False, 0.0
    hay = _norm(text)
    hay_words = hay.split()
    worst = 1.0
    for p in parts:
        q = _norm(p)
        if q in hay:
            continue
        qw = q.split()
        best = 0.0
        for size in range(max(1, len(qw) - 2), len(qw) + 3):
            for i in range(0, max(1, len(hay_words) - size + 1)):
                cand = " ".join(hay_words[i:i + size])
                best = max(best, SequenceMatcher(None, q, cand).ratio())
        worst = min(worst, best)
        if best < threshold:
            return False, round(worst, 3)
    return True, round(worst, 3)


# ── argument models (their JSON schemas are what the LLM sees) ─────────────────────
class SearchResumeArgs(BaseModel):
    query: str = Field(description="What to look for in the candidate's resume.")
    section: Optional[str] = Field(None, description="Optional section filter, e.g. 'projects' or 'experience'.")
    k: int = Field(3, ge=1, le=5)

class SearchJDArgs(BaseModel):
    query: str
    k: int = Field(3, ge=1, le=5)

class SearchBankArgs(BaseModel):
    competency: str
    difficulty: Literal["easy", "medium", "hard"] = "medium"

class GetRubricArgs(BaseModel):
    competency: str

class RecallSessionsArgs(BaseModel):
    topic: str

class UpdatePlanArgs(BaseModel):
    competencies: list[str] = Field(min_length=2, max_length=8,
        description="Competencies to cover, highest priority first (e.g. ownership, technical_depth, problem_solving).")

class AddClaimArgs(BaseModel):
    text: str = Field(min_length=6, description="A checkable statement: a number, technology, or ownership claim.")
    source: Literal["resume", "candidate_answer"]

class ResolveClaimArgs(BaseModel):
    id: str
    status: Literal["supported", "contradicted", "unsupported"]
    note: str = ""

class CheckConsistencyArgs(BaseModel):
    claim_id: str

class LogEvidenceArgs(BaseModel):
    competency: str
    quote: str = Field(min_length=8, description="Exact words from the candidate's latest answer.")
    score: int = Field(ge=1, le=5, description="Rubric level 1-5 (see get_rubric).")
    rationale: str = ""

class VerifyQuoteArgs(BaseModel):
    quote: str

class SetPatienceArgs(BaseModel):
    level: Literal["low", "normal", "high"]

class AskArgs(BaseModel):
    question: str = Field(min_length=10, max_length=400, description="One question, under ~40 words.")
    intent: Literal["new_topic", "probe", "clarify", "challenge"]
    competency: str
    expected_structure: Literal["star_story", "think_aloud", "short_answer", "open"] = Field(
        description="What kind of answer this invites. think_aloud tells turn-taking to tolerate long silences.")

class InterjectArgs(BaseModel):
    message: str = Field(min_length=6, max_length=300, description="Polite interruption, e.g. to redirect a rambling answer.")

class WrapUpArgs(BaseModel):
    message: str = Field(min_length=6, max_length=400)

class RetrieveEvidenceArgs(BaseModel):
    need: str = Field(min_length=4, description="What you need evidence for, in plain words (a claim to verify, a topic to ground a question in, a JD requirement).")
    purpose: Literal["verify_claim", "ground_question", "find_requirement", "rubric_anchor", "recall_history"] = "ground_question"

class FinishAssessmentArgs(BaseModel):
    summary: str = Field(min_length=6, max_length=400, description="One-sentence assessment of this answer.")

class NoArgs(BaseModel):
    pass


class Tool:
    def __init__(self, name: str, description: str, args: type[BaseModel],
                 handler: Callable[[BaseModel], dict], terminal: bool = False):
        self.name, self.description, self.args, self.handler, self.terminal = name, description, args, handler, terminal

    def schema(self) -> dict:
        params = self.args.model_json_schema()
        params.pop("title", None)
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": params}}


class ToolBox:
    def __init__(self, board: Blackboard, retriever: Retriever, memory: Optional[InMemoryMemory] = None, *,
                 rag=None, allowed: Optional[set[str]] = None, bound_turn: Optional[int] = None):
        """`allowed` restricts which tools this agent may call; `bound_turn` pins evidence/claims to one
        turn (used by the async evaluator so it never races the interviewer on 'latest answer')."""
        self.board, self.retriever = board, retriever
        self.memory = memory or InMemoryMemory()
        self.rag = rag or StaticRAG(retriever)
        self.allowed, self.bound_turn = allowed, bound_turn
        self.tools: dict[str, Tool] = {}
        self._register()

    # ── public ───────────────────────────────────────────────────────────────
    def schemas(self) -> list[dict]:
        return [t.schema() for n, t in self.tools.items() if self.allowed is None or n in self.allowed]

    def execute(self, name: str, arguments: dict[str, Any]) -> dict:
        tool = self.tools.get(name)
        if tool is None or (self.allowed is not None and name not in self.allowed):
            avail = sorted(n for n in self.tools if self.allowed is None or n in self.allowed)
            res = {"ok": False, "error": f"unknown tool '{name}'. Available: {avail}"}
        else:
            try:
                with self.board.lock:
                    res = tool.handler(tool.args(**(arguments or {})))
            except ValidationError as e:
                res = {"ok": False, "error": "invalid arguments: " + "; ".join(
                    f"{'.'.join(map(str, err['loc']))}: {err['msg']}" for err in e.errors())}
            except Exception as e:  # tools must never crash the loop
                res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self.board.emit("tool", name, args=arguments, ok=res.get("ok", True), error=res.get("error"))
        return res

    # ── registration ─────────────────────────────────────────────────────────
    def _register(self) -> None:
        add = lambda n, d, a, h, terminal=False: self.tools.__setitem__(n, Tool(n, d, a, h, terminal))
        add("search_resume", "Search the candidate's resume. Use before asking about or verifying anything on it.", SearchResumeArgs, self._search_resume)
        add("search_jd", "Search the job description for requirements.", SearchJDArgs, self._search_jd)
        add("search_bank", "Find curated questions for a competency at a difficulty, excluding ones already asked.", SearchBankArgs, self._search_bank)
        add("get_rubric", "Get the 1-5 scoring anchors for a competency.", GetRubricArgs, lambda a: {"ok": True, **get_rubric(a.competency)})
        add("recall_sessions", "Recall notes from the candidate's previous sessions on a topic.", RecallSessionsArgs, lambda a: {"ok": True, "notes": self.memory.recall(a.topic)})
        add("retrieve_evidence", "Agentic retrieval over resume/JD: plans queries, grades results, retries. Returns cited spans and whether they are sufficient.", RetrieveEvidenceArgs, self._retrieve_evidence)
        add("update_plan", "Set the competencies to cover, highest priority first. Call once at the start.", UpdatePlanArgs, self._update_plan)
        add("add_claim", "Record a checkable claim from the resume or the candidate's answer.", AddClaimArgs, self._add_claim)
        add("resolve_claim", "Mark a claim supported / contradicted / unsupported after checking the resume.", ResolveClaimArgs, self._resolve_claim)
        add("check_consistency", "Retrieve resume evidence for a claim and report whether its numbers appear there.", CheckConsistencyArgs, self._check_consistency)
        add("log_evidence", "Log a rubric-scored piece of evidence with an EXACT quote from the candidate's latest answer.", LogEvidenceArgs, self._log_evidence)
        add("verify_quote", "Check that a quote appears in the candidate's latest answer.", VerifyQuoteArgs, self._verify_quote)
        add("set_patience", "Override how long turn-taking should wait through silence for the current question.", SetPatienceArgs, self._set_patience)
        add("budget_status", "See turns left, follow-up depth, and time used.", NoArgs, lambda a: {"ok": True, **self._budget()})
        add("ask", "Speak to the candidate: ask ONE question. Ends your decision.", AskArgs, self._ask, terminal=True)
        add("interject", "Speak to the candidate: politely interrupt or redirect. Ends your decision.", InterjectArgs, self._interject, terminal=True)
        add("finish_assessment", "Evaluator only: end your assessment of the answer you were given.", FinishAssessmentArgs, self._finish_assessment, terminal=True)
        add("wrap_up", "Close the interview. Ends your decision. Only allowed after enough questions or when budget is exhausted.", WrapUpArgs, self._wrap_up, terminal=True)

    # ── retrieval tools ──────────────────────────────────────────────────────
    def _search_resume(self, a: SearchResumeArgs) -> dict:
        spans = self.retriever.search_resume(a.query, a.k, a.section)
        return {"ok": True, "spans": [s.to_dict() for s in spans],
                "note": "" if spans else "No relevant resume content found. Do not invent details; ask the candidate."}

    def _search_jd(self, a: SearchJDArgs) -> dict:
        spans = self.retriever.search_jd(a.query, a.k)
        return {"ok": True, "spans": [s.to_dict() for s in spans],
                "note": "" if spans else "No relevant JD content found."}

    def _retrieve_evidence(self, a: RetrieveEvidenceArgs) -> dict:
        if a.purpose == "rubric_anchor":
            return {"ok": True, **get_rubric(a.need)}
        if a.purpose == "recall_history":
            return {"ok": True, "notes": self.memory.recall(a.need)}
        pack = self.rag.retrieve(a.need, a.purpose)
        self.board.emit("rag", "retrieve", purpose=a.purpose, mode=pack.mode, rounds=pack.rounds,
                        llm_calls=pack.llm_calls, sufficient=pack.sufficient)
        return pack.to_dict()

    def _finish_assessment(self, a: FinishAssessmentArgs) -> dict:
        return {"ok": True, "terminal": True, "action": {"kind": "assessment_done", "text": a.summary.strip()}}

    def _search_bank(self, a: SearchBankArgs) -> dict:
        asked = [t.question for t in self.board.turns]
        return {"ok": True, "questions": search_bank(a.competency, a.difficulty, asked)}

    # ── state tools ──────────────────────────────────────────────────────────
    def _update_plan(self, a: UpdatePlanArgs) -> dict:
        seen: list[str] = []
        for c in a.competencies:
            k = norm_competency(c)
            if k not in seen:
                seen.append(k)
        self.board.plan = seen
        self.board.emit("agent", "plan_set", plan=seen)
        return {"ok": True, "plan": seen}

    def _add_claim(self, a: AddClaimArgs) -> dict:
        latest = self._latest_answer()
        claim = self.board.add_claim(a.text, a.source, latest[0] if latest else None)
        return {"ok": True, "id": claim.id}

    def _resolve_claim(self, a: ResolveClaimArgs) -> dict:
        claim = self.board.get_claim(a.id)
        if claim is None:
            return {"ok": False, "error": f"no claim with id '{a.id}'. Known: {[c.id for c in self.board.claims]}"}
        claim.status, claim.note = a.status, a.note
        self.board.emit("agent", "claim_resolved", id=a.id, status=a.status)
        return {"ok": True}

    def _check_consistency(self, a: CheckConsistencyArgs) -> dict:
        claim = self.board.get_claim(a.claim_id)
        if claim is None:
            return {"ok": False, "error": f"no claim with id '{a.claim_id}'"}
        spans = self.retriever.search_resume(claim.text, k=3)
        nums = set(re.findall(r"\d+(?:\.\d+)?", claim.text))
        span_nums = set(re.findall(r"\d+(?:\.\d+)?", " ".join(s.text for s in spans)))
        ctoks = set(tokenize(claim.text))
        stoks = set(tokenize(" ".join(s.text for s in spans)))
        overlap = round(len(ctoks & stoks) / len(ctoks), 2) if ctoks else 0.0
        mismatch = bool(nums) and not (nums & span_nums)
        hint = ("Numbers in the claim do not appear in the resume evidence; probe this." if mismatch
                else "No resume evidence found." if not spans
                else "Some overlap with resume; judge whether it actually supports the claim.")
        return {"ok": True, "claim": claim.text, "spans": [s.to_dict() for s in spans],
                "token_overlap": overlap, "numeric_mismatch": mismatch, "hint": hint}

    def _latest_answer(self) -> Optional[tuple[int, str]]:
        if self.bound_turn is not None:
            t = self.board.turns[self.bound_turn] if self.bound_turn < len(self.board.turns) else None
            return (t.index, t.answer) if t and t.answer else None
        t = self.board.last_answered_turn()
        return (t.index, t.answer) if t else None

    def _verify_quote(self, a: VerifyQuoteArgs) -> dict:
        latest = self._latest_answer()
        if latest is None:
            return {"ok": False, "error": "no candidate answer to verify against yet"}
        found, ratio = quote_in_text(a.quote, latest[1])
        return {"ok": True, "found": found, "match": ratio}

    def _log_evidence(self, a: LogEvidenceArgs) -> dict:
        latest = self._latest_answer()
        if latest is None:
            return {"ok": False, "error": "no candidate answer yet; nothing to log evidence against"}
        comp = norm_competency(a.competency)
        if comp not in self.board.plan:
            return {"ok": False, "error": f"competency '{comp}' is not in the plan {self.board.plan}. Use one of these or call update_plan."}
        found, ratio = quote_in_text(a.quote, latest[1])
        if not found:
            return {"ok": False, "error": "quote not found in the candidate's latest answer (best match "
                    f"{ratio}). Quote their exact words; do not paraphrase or invent."}
        key = re.sub(r"\W+", " ", a.quote.lower()).strip()
        for e in self.board.evidence:
            if e.turn == latest[0] and e.competency == comp and re.sub(r"\W+", " ", e.quote.lower()).strip() == key:
                return {"ok": True, "id": e.id, "note": "already logged"}
        ev = self.board.add_evidence(latest[0], comp, a.quote, a.score, a.rationale)
        return {"ok": True, "id": ev.id}

    def _set_patience(self, a: SetPatienceArgs) -> dict:
        p = self.board.patience
        self.board.patience = Patience(level=a.level, max_hold_s=PATIENCE_MAX_HOLD_S[a.level],
                                       expected_structure=p.expected_structure)
        self.board.emit("agent", "patience_override", level=a.level)
        return {"ok": True, "max_hold_s": self.board.patience.max_hold_s}

    def _budget(self) -> dict:
        b = self.board
        return {"turns_used": len(b.turns), "turns_left": b.turns_left(), "answered": b.answered_count(),
                "trailing_followups": b.trailing_followups(), "max_probe_depth": b.budget.max_probe_depth,
                "min_turns_before_wrap": b.budget.min_turns_before_wrap,
                "elapsed_s": int(b.elapsed_s()), "time_exhausted": b.time_exhausted()}

    # ── action tools (terminal) ────────────────────────────────────────────────
    def _is_duplicate(self, question: str) -> bool:
        return any(SequenceMatcher(None, question.lower(), t.question.lower()).ratio() > 0.85 for t in self.board.turns)

    def _ask(self, a: AskArgs) -> dict:
        b = self.board
        if b.pending_turn() is not None:
            return {"ok": False, "error": "the previous question has not been answered yet."}
        if b.time_exhausted():
            return {"ok": False, "error": "session time is up. Call wrap_up."}
        if b.turns_left() <= 0:
            return {"ok": False, "error": "question budget exhausted. Call wrap_up."}
        if not b.plan:
            return {"ok": False, "error": "no plan set. Call update_plan first."}
        comp = norm_competency(a.competency)
        if comp not in b.plan:
            return {"ok": False, "error": f"competency '{comp}' is not in the plan {b.plan}."}
        if a.intent in FOLLOWUP_INTENTS:
            if not b.answered_count():
                return {"ok": False, "error": f"cannot {a.intent} before the candidate has answered anything."}
            if b.trailing_followups() >= b.budget.max_probe_depth:
                return {"ok": False, "error": f"follow-up limit reached ({b.budget.max_probe_depth} in a row). "
                        "Move to a new_topic on a less-covered competency, or wrap_up."}
        if self._is_duplicate(a.question):
            return {"ok": False, "error": "that question is (nearly) a repeat of one already asked. Ask something new."}
        intent = "opener" if not b.turns else a.intent
        turn = b.open_turn(a.question.strip(), intent, comp, a.expected_structure)
        return {"ok": True, "terminal": True, "action": {
            "kind": "ask", "text": turn.question, "intent": turn.intent, "competency": comp,
            "expected_structure": a.expected_structure, "turn_index": turn.index,
            "patience": b.patience.model_dump()}}

    def _interject(self, a: InterjectArgs) -> dict:
        b = self.board
        if b.pending_turn() is None:
            return {"ok": False, "error": "nothing to interject on: there is no open question. Use ask instead."}
        b.emit("interviewer", "interjection", turn=b.pending_turn().index)
        return {"ok": True, "terminal": True, "action": {
            "kind": "interject", "text": a.message.strip(), "intent": "interject",
            "turn_index": b.pending_turn().index, "patience": b.patience.model_dump()}}

    def _wrap_up(self, a: WrapUpArgs) -> dict:
        b = self.board
        forced = b.turns_left() <= 0 or b.time_exhausted()
        if not forced and b.answered_count() < b.budget.min_turns_before_wrap:
            return {"ok": False, "error": f"too early to wrap up: only {b.answered_count()} answered, "
                    f"need at least {b.budget.min_turns_before_wrap}. Ask another question."}
        if b.pending_turn() is not None:
            return {"ok": False, "error": "the last question is still unanswered."}
        b.done = True
        b.emit("interviewer", "wrap_up", answered=b.answered_count())
        return {"ok": True, "terminal": True, "action": {"kind": "wrap_up", "text": a.message.strip(), "intent": "wrap_up"}}
