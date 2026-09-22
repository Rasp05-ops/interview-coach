"""Shared session state ("blackboard").

Every agent and tool reads and writes THIS object through typed methods, never through free text.
It is also the single source of truth the (future) EOT engine reads: `patience` carries the
interviewer's expectation for the current question so turn-taking can adapt to it.
"""
from __future__ import annotations

import threading
import time
from typing import Literal, Optional

from pydantic import BaseModel, Field, PrivateAttr

ExpectedStructure = Literal["star_story", "think_aloud", "short_answer", "open"]
PatienceLevel = Literal["low", "normal", "high"]
Intent = Literal["opener", "new_topic", "probe", "clarify", "challenge", "interject", "wrap_up"]
FOLLOWUP_INTENTS = {"probe", "clarify", "challenge"}

# Seconds of silence the turn-taking engine should tolerate before it may declare the turn over.
PATIENCE_MAX_HOLD_S: dict[str, float] = {"low": 2.5, "normal": 5.0, "high": 10.0}
# Default patience implied by what kind of answer the question invites.
STRUCTURE_DEFAULT_PATIENCE: dict[str, str] = {
    "star_story": "normal",
    "think_aloud": "high",   # candidates go quiet while reasoning; cutting them off is the costly error
    "short_answer": "low",
    "open": "normal",
}


class Claim(BaseModel):
    id: str
    text: str
    source: Literal["resume", "candidate_answer"]
    status: Literal["unverified", "supported", "contradicted", "unsupported"] = "unverified"
    note: str = ""
    turn: Optional[int] = None


class Evidence(BaseModel):
    id: str
    turn: int
    competency: str
    quote: str          # verified verbatim (or near-verbatim) from the candidate's answer
    score: int          # rubric level 1..5
    rationale: str = ""


class DeliverySignals(BaseModel):
    audio_seconds: float = 0.0
    wpm: float = 0.0
    filler_count: int = 0
    long_pause_count: int = 0
    longest_pause_s: float = 0.0
    first_word_delay_s: float = 0.0
    eot_probability: Optional[float] = None


class Turn(BaseModel):
    index: int
    question: str
    intent: Intent
    competency: Optional[str] = None
    expected_structure: ExpectedStructure = "open"
    answer: str = ""
    delivery: DeliverySignals = Field(default_factory=DeliverySignals)


class Patience(BaseModel):
    level: PatienceLevel = "normal"
    max_hold_s: float = PATIENCE_MAX_HOLD_S["normal"]
    expected_structure: ExpectedStructure = "open"


class Budget(BaseModel):
    max_turns: int = 8               # interviewer utterances that open a turn (excludes wrap_up)
    min_turns_before_wrap: int = 3   # stop the model quitting after one question
    max_probe_depth: int = 2         # consecutive follow-ups on one thread
    max_llm_steps_per_decision: int = 6
    max_session_seconds: int = 1800


class Event(BaseModel):
    seq: int
    ts: float
    actor: str
    kind: str
    payload: dict = Field(default_factory=dict)


class Blackboard(BaseModel):
    role: str = ""
    company: str = ""
    company_context: str = ""
    plan: list[str] = Field(default_factory=list)     # competency names, highest priority first
    claims: list[Claim] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    turns: list[Turn] = Field(default_factory=list)
    patience: Patience = Field(default_factory=Patience)
    budget: Budget = Field(default_factory=Budget)
    events: list[Event] = Field(default_factory=list)
    started_at: float = Field(default_factory=time.time)
    done: bool = False
    _lock: threading.RLock = PrivateAttr(default_factory=threading.RLock)

    @property
    def lock(self) -> threading.RLock:
        """Serialises tool handlers when the interviewer and evaluator run on different threads."""
        return self._lock

    # ── trace ────────────────────────────────────────────────────────────────
    def emit(self, actor: str, kind: str, **payload) -> None:
        self.events.append(Event(seq=len(self.events), ts=time.time(), actor=actor, kind=kind, payload=payload))

    # ── turns ────────────────────────────────────────────────────────────────
    def pending_turn(self) -> Optional[Turn]:
        return self.turns[-1] if self.turns and not self.turns[-1].answer else None

    def last_answered_turn(self) -> Optional[Turn]:
        for t in reversed(self.turns):
            if t.answer:
                return t
        return None

    def open_turn(self, question: str, intent: Intent, competency: Optional[str],
                  expected_structure: ExpectedStructure) -> Turn:
        turn = Turn(index=len(self.turns), question=question, intent=intent,
                    competency=competency, expected_structure=expected_structure)
        self.turns.append(turn)
        level = STRUCTURE_DEFAULT_PATIENCE[expected_structure]
        self.patience = Patience(level=level, max_hold_s=PATIENCE_MAX_HOLD_S[level],
                                 expected_structure=expected_structure)
        self.emit("interviewer", "turn_opened", index=turn.index, intent=intent,
                  competency=competency, patience=level)
        return turn

    def record_answer(self, text: str, delivery: Optional[DeliverySignals] = None) -> Turn:
        turn = self.pending_turn()
        if turn is None:
            raise ValueError("no open question to answer")
        turn.answer = text.strip()
        if delivery is not None:
            turn.delivery = delivery
        self.emit("candidate", "answer_recorded", index=turn.index, words=len(turn.answer.split()))
        return turn

    def answered_count(self) -> int:
        return sum(1 for t in self.turns if t.answer)

    def trailing_followups(self) -> int:
        n = 0
        for t in reversed(self.turns):
            if t.intent in FOLLOWUP_INTENTS:
                n += 1
            else:
                break
        return n

    def elapsed_s(self) -> float:
        return time.time() - self.started_at

    def turns_left(self) -> int:
        return max(0, self.budget.max_turns - len(self.turns))

    def time_exhausted(self) -> bool:
        return self.elapsed_s() > self.budget.max_session_seconds

    def coverage(self) -> dict[str, int]:
        cov = {c: 0 for c in self.plan}
        for t in self.turns:
            if t.answer and t.competency in cov:
                cov[t.competency] += 1
        return cov

    # ── claims / evidence ────────────────────────────────────────────────────
    def add_claim(self, text: str, source: str, turn: Optional[int]) -> Claim:
        claim = Claim(id=f"c{len(self.claims) + 1}", text=text.strip(), source=source, turn=turn)
        self.claims.append(claim)
        self.emit("agent", "claim_added", id=claim.id, source=source)
        return claim

    def get_claim(self, claim_id: str) -> Optional[Claim]:
        return next((c for c in self.claims if c.id == claim_id), None)

    def add_evidence(self, turn: int, competency: str, quote: str, score: int, rationale: str) -> Evidence:
        ev = Evidence(id=f"e{len(self.evidence) + 1}", turn=turn, competency=competency,
                      quote=quote.strip(), score=score, rationale=rationale.strip())
        self.evidence.append(ev)
        self.emit("agent", "evidence_logged", id=ev.id, competency=competency, score=score)
        return ev

    # ── views ────────────────────────────────────────────────────────────────
    def snapshot(self, recent_turns: int = 3) -> dict:
        """Compact state for prompts. Deliberately NOT the full transcript (token budget)."""
        cov = self.coverage()
        by_comp: dict[str, list[int]] = {}
        for e in self.evidence:
            by_comp.setdefault(e.competency, []).append(e.score)
        return {
            "role": self.role, "company": self.company,
            "plan": [{"competency": c, "answers": cov.get(c, 0),
                      "avg_rubric": round(sum(by_comp[c]) / len(by_comp[c]), 2) if c in by_comp else None}
                     for c in self.plan],
            "open_claims": [c.model_dump(include={"id", "text", "status", "note"})
                            for c in self.claims if c.status in ("unverified", "unsupported", "contradicted")],
            "turns_used": len(self.turns), "turns_left": self.turns_left(),
            "trailing_followups": self.trailing_followups(),
            "max_probe_depth": self.budget.max_probe_depth,
            "elapsed_s": int(self.elapsed_s()),
            "recent": [{"i": t.index, "intent": t.intent, "competency": t.competency, "q": t.question}
                       for t in self.turns[-recent_turns:]],
        }
