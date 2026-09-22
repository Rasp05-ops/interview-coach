"""Agentic retrieval: plan queries -> retrieve -> grade -> (rewrite -> retry) -> evidence pack.

`StaticRAG` is the non-agentic baseline with the same interface, so the two can be ablated head to head
(see service/eval/rag_bench.py). Everything the LLM decides is validated in code:
  * the grader may only cite span ids that were actually retrieved (hallucinated ids are dropped)
  * a grader that says "sufficient" while citing nothing is overruled
  * any LLM failure degrades to the static result instead of raising
  * total LLM calls are bounded: at most 2 per round, `max_rounds` rounds
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

from .llm import LLM, LLMError
from .retrieval import InMemoryMemory, Retriever, Span, query_coverage

Purpose = Literal["verify_claim", "ground_question", "find_requirement", "rubric_anchor", "recall_history"]
_DEFAULT_SOURCES = {"verify_claim": "resume", "ground_question": "both", "find_requirement": "jd",
                    "rubric_anchor": "resume", "recall_history": "resume"}


@dataclass
class EvidencePack:
    sufficient: bool
    spans: list[dict]
    rounds: int = 0
    llm_calls: int = 0
    queries: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)
    missing: str = ""
    mode: str = "static"

    def to_dict(self) -> dict:
        note = "" if self.sufficient else ("Evidence is insufficient: do not assert resume facts; ask the candidate. "
                                           + (f"Missing: {self.missing}" if self.missing else ""))
        return {"ok": True, "sufficient": self.sufficient, "spans": self.spans, "conflicts": self.conflicts,
                "missing": self.missing, "mode": self.mode, "rounds": self.rounds, "note": note.strip()}


def _search(retriever: Retriever, query: str, source: str, k: int, section: Optional[str] = None) -> list[Span]:
    out: list[Span] = []
    if source in ("resume", "both"):
        out += retriever.search_resume(query, k, section)
    if source in ("jd", "both"):
        out += retriever.search_jd(query, k)
    return out


class StaticRAG:
    """Baseline: one BM25 query with the need as-is, no grading. 'Sufficient' just means 'found something'."""
    def __init__(self, retriever: Retriever, k: int = 3):
        self.retriever, self.k = retriever, k

    def retrieve(self, need: str, purpose: Purpose = "ground_question") -> EvidencePack:
        spans = sorted(_search(self.retriever, need, _DEFAULT_SOURCES[purpose], self.k), key=lambda s: -s.score)[: self.k]
        return EvidencePack(sufficient=bool(spans), spans=[s.to_dict() for s in spans], rounds=1, queries=[need], mode="static")


# ── structured-output "tools" (used only to force JSON-shaped answers) ──────────────────────
class PlanQueries(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=4, description="Short keyword-rich search queries, using synonyms and numerals.")
    source: Literal["resume", "jd", "both"]
    section: Optional[str] = Field(None, description="Optional resume section filter.")


class GradeEvidence(BaseModel):
    sufficient: bool = Field(description="True only if the cited spans actually answer the need.")
    relevant_ids: list[str] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list, description="Ways the spans contradict the claim, if any (e.g. different numbers).")
    missing: str = Field("", description="What is still missing, to guide a rewrite.")


def _schema(name: str, desc: str, model: type[BaseModel]) -> dict:
    params = model.model_json_schema(); params.pop("title", None)
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": params}}


PLAN_TOOL = _schema("plan_queries", "Submit search queries for the retrieval need.", PlanQueries)
GRADE_TOOL = _schema("grade_evidence", "Grade retrieved spans against the need.", GradeEvidence)

PLAN_SYSTEM = ("You plan retrieval over a candidate's resume and a job description. Write up to 4 short, keyword-rich queries. "
               "Resumes are terse and use different words than spoken claims: include synonyms (latency/response time), "
               "numerals ('40' not 'forty'), and technology names. If previous feedback lists what was missing, target it.")
GRADE_SYSTEM = ("You grade retrieved spans. Cite ONLY ids that appear below. Mark sufficient=true only if the spans directly "
                "address the need. For claim verification, list any conflicts (different numbers, different scope).")


class AgenticRAG:
    def __init__(self, llm: LLM, retriever: Retriever, k: int = 3, max_rounds: int = 2,
                 fast_path_coverage: Optional[float] = 0.75):
        """`fast_path_coverage`: if a plain BM25 hit already contains at least this fraction of the need's
        tokens, accept it with zero LLM calls. Set to None to always use the LLM loop (for ablations)."""
        self.llm, self.retriever, self.k, self.max_rounds = llm, retriever, k, max_rounds
        self.fast_path_coverage = fast_path_coverage

    # ── public ───────────────────────────────────────────────────────────────
    def retrieve(self, need: str, purpose: Purpose = "ground_question") -> EvidencePack:
        default_source = _DEFAULT_SOURCES[purpose]
        base = sorted(_search(self.retriever, need, default_source, self.k), key=lambda s: -s.score)[: self.k]

        if self.fast_path_coverage is not None and base and purpose != "verify_claim" and \
                query_coverage(need, base[0].text) >= self.fast_path_coverage:
            return EvidencePack(True, [s.to_dict() for s in base], rounds=1, queries=[need], mode="agentic_fastpath")

        seen: dict[str, Span] = {s.id: s for s in base}
        queries, calls, feedback = [need], 0, ""
        pack: Optional[EvidencePack] = None
        try:
            for rnd in range(1, self.max_rounds + 2):
                plan = self._plan(need, purpose, feedback); calls += 1
                queries += plan.queries
                for q in plan.queries:
                    for sp in _search(self.retriever, q, plan.source, self.k, plan.section):
                        if sp.id not in seen or sp.score > seen[sp.id].score:
                            seen[sp.id] = sp
                cand = sorted(seen.values(), key=lambda s: -s.score)[: self.k + 2]
                grade = self._grade(need, purpose, cand); calls += 1
                valid = [i for i in grade.relevant_ids if i in seen]                 # drop hallucinated ids
                sufficient = grade.sufficient and bool(valid)                         # overrule "sufficient" with no citation
                chosen = [seen[i] for i in valid] or cand[: self.k]
                pack = EvidencePack(sufficient, [s.to_dict() for s in chosen], rounds=rnd, llm_calls=calls,
                                    queries=queries, conflicts=grade.conflicts, missing=grade.missing, mode="agentic")
                if sufficient:
                    return pack
                feedback = grade.missing or "nothing relevant found yet; try different terms"
        except (LLMError, ValidationError, ValueError) as e:
            fallback = EvidencePack(bool(base), [s.to_dict() for s in base], rounds=max(1, len(queries) - 1),
                                    llm_calls=calls, queries=queries, mode="agentic_fallback",
                                    missing=f"retrieval agent failed: {type(e).__name__}")
            return pack or fallback
        return pack or EvidencePack(False, [], rounds=self.max_rounds + 1, llm_calls=calls, queries=queries, mode="agentic")

    # ── LLM steps ────────────────────────────────────────────────────────────
    def _forced(self, system: str, user: str, tool: dict) -> dict:
        resp = self.llm.chat([{"role": "system", "content": system}, {"role": "user", "content": user}],
                             [tool], tool_choice=tool["function"]["name"])
        for c in resp.tool_calls:
            if c.name == tool["function"]["name"]:
                return c.arguments
        raise ValueError("model did not return the requested structured output")

    def _plan(self, need: str, purpose: str, feedback: str) -> PlanQueries:
        secs = self.retriever.sections()
        user = (f"Need ({purpose}): {need}\nResume sections: {secs or 'unknown'}\n"
                + (f"Previous attempt was insufficient. Missing: {feedback}\n" if feedback else ""))
        return PlanQueries(**self._forced(PLAN_SYSTEM, user, PLAN_TOOL))

    def _grade(self, need: str, purpose: str, spans: list[Span]) -> GradeEvidence:
        body = "\n".join(f"[{s.id}] ({s.source}/{s.section}) {s.text[:400]}" for s in spans) or "(no spans retrieved)"
        return GradeEvidence(**self._forced(GRADE_SYSTEM, f"Need ({purpose}): {need}\n\nSpans:\n{body}", GRADE_TOOL))
