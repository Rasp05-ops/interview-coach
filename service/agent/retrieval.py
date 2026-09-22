"""Static retrieval layer (step 2 of the build order): section-aware chunking + BM25 in pure Python.

This is deliberately the *non-agentic* baseline. The agentic loop (planner / router / grader / retry)
will wrap this and be ablated against it. Dense embeddings + a cross-encoder reranker plug in behind
the same `Retriever.search` signature.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

STOP = set("""a an and are as at be but by for from has have i in is it its of on or that the their this to was were will with
my we our you your they he she them his her been being do did done so than then there these those into over under about""".split())
_TOKEN = re.compile(r"[a-z0-9][a-z0-9+#.\-]*")

SECTION_HEADINGS = {
    "summary", "objective", "education", "experience", "work experience", "professional experience",
    "internships", "internship", "projects", "academic projects", "personal projects", "skills",
    "technical skills", "achievements", "awards", "publications", "certifications",
    "positions of responsibility", "leadership", "extracurricular", "extracurriculars", "research",
}


def tokenize(text: str) -> list[str]:
    return [t.strip(".-") for t in _TOKEN.findall(text.lower()) if t not in STOP and len(t.strip(".-")) > 0]


@dataclass
class Span:
    id: str
    source: str            # "resume" | "jd"
    section: Optional[str]
    text: str
    score: float = 0.0

    def to_dict(self) -> dict:
        return {"id": self.id, "source": self.source, "section": self.section,
                "text": self.text, "score": round(self.score, 3)}


def _heading(line: str) -> Optional[str]:
    s = line.strip().rstrip(":").strip()
    if 0 < len(s) <= 40 and s.lower() in SECTION_HEADINGS:
        return s.lower()
    return None


def _split_long(text: str, max_words: int) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [text]
    lines = [l for l in text.split("\n") if l.strip()]
    chunks, cur, n = [], [], 0
    for line in lines:
        w = len(line.split())
        if cur and n + w > max_words:
            chunks.append("\n".join(cur)); cur, n = [], 0
        cur.append(line); n += w
    if cur:
        chunks.append("\n".join(cur))
    # a single enormous line: hard split by words
    out = []
    for c in chunks:
        ws = c.split()
        if len(ws) > max_words * 2:
            out += [" ".join(ws[i:i + max_words]) for i in range(0, len(ws), max_words)]
        else:
            out.append(c)
    return out


def chunk_document(text: str, source: str, max_words: int = 110) -> list[Span]:
    """Split on blank lines, track the current section heading, cap chunk size."""
    section: Optional[str] = None
    spans: list[Span] = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        lines = block.split("\n")
        body: list[str] = []
        for line in lines:
            h = _heading(line)
            if h and source == "resume":
                if body:
                    for piece in _split_long("\n".join(body), max_words):
                        spans.append(Span(f"{source}:{len(spans)}", source, section, piece.strip()))
                    body = []
                section = h
            elif line.strip():
                body.append(line)
        if body:
            for piece in _split_long("\n".join(body), max_words):
                if piece.strip():
                    spans.append(Span(f"{source}:{len(spans)}", source, section, piece.strip()))
    return spans


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = docs
        self.N = len(docs)
        self.avgdl = (sum(len(d) for d in docs) / self.N) if self.N else 0.0
        df: Counter = Counter()
        for d in docs:
            df.update(set(d))
        self.idf = {t: math.log(1 + (self.N - n + 0.5) / (n + 0.5)) for t, n in df.items()}
        self.tf = [Counter(d) for d in docs]

    def score(self, query: list[str], i: int) -> float:
        if not self.avgdl:
            return 0.0
        dl, s = len(self.docs[i]), 0.0
        for t in query:
            f = self.tf[i].get(t, 0)
            if not f:
                continue
            s += self.idf.get(t, 0.0) * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
        return s


class Index:
    def __init__(self, spans: list[Span]):
        self.spans = spans
        self.bm25 = BM25([tokenize(s.text + " " + (s.section or "")) for s in spans])

    def search(self, query: str, k: int = 3, section: Optional[str] = None) -> list[Span]:
        q = tokenize(query)
        if not q:
            return []
        want = section.lower().strip() if section else None
        hits = []
        for i, sp in enumerate(self.spans):
            if want and (sp.section or "") != want:
                continue
            sc = self.bm25.score(q, i)
            if sc > 0:
                hits.append(Span(sp.id, sp.source, sp.section, sp.text, sc))
        hits.sort(key=lambda s: s.score, reverse=True)
        return hits[:k]


class Retriever:
    def __init__(self, resume_text: str, jd_text: str):
        self.resume = Index(chunk_document(resume_text or "", "resume"))
        self.jd = Index(chunk_document(jd_text or "", "jd"))

    def sections(self) -> list[str]:
        return sorted({s.section for s in self.resume.spans if s.section})

    def search_resume(self, query: str, k: int = 3, section: Optional[str] = None) -> list[Span]:
        return self.resume.search(query, k, section)

    def search_jd(self, query: str, k: int = 3) -> list[Span]:
        return self.jd.search(query, k)


# ── rubrics ───────────────────────────────────────────────────────────────────
RUBRICS: dict[str, dict[int, str]] = {
    "ownership": {1: "Describes what the team did; no personal role.",
                  3: "Clear personal contribution but limited scope or no outcome.",
                  5: "Owned a defined problem end to end; specific decisions, trade-offs and measurable outcome."},
    "technical_depth": {1: "Buzzwords only; cannot explain how or why.",
                        3: "Correct high-level explanation; misses trade-offs or failure modes.",
                        5: "Explains mechanism, alternatives considered, trade-offs and limits with concrete detail."},
    "problem_solving": {1: "Jumps to an answer; no structure.",
                        3: "Reasonable approach but skips assumptions or validation.",
                        5: "States assumptions, decomposes the problem, checks the result and notes edge cases."},
    "communication": {1: "Rambling or unclear; hard to follow.",
                      3: "Understandable but unstructured or too long.",
                      5: "Structured, concise, leads with the point and supports it with specifics."},
    "collaboration": {1: "No evidence of working with others.",
                      3: "Works with others; conflict or influence not addressed.",
                      5: "Specific example of aligning others or resolving disagreement with an outcome."},
    "leadership": {1: "No initiative described.",
                   3: "Took initiative in a small scope.",
                   5: "Led people or a decision through ambiguity; clear impact beyond own work."},
    "motivation_fit": {1: "Generic reasons; no link to role or company.",
                       3: "Some link to the role but not to their own background.",
                       5: "Specific, credible link between their experience, the role and the team."},
}
_GENERIC_RUBRIC = {1: "Vague or unsupported.", 3: "Adequate with some specifics.", 5: "Specific, verifiable, well-structured."}


def norm_competency(name: str) -> str:
    return re.sub(r"[\s\-/]+", "_", name.strip().lower())


def get_rubric(competency: str) -> dict:
    key = norm_competency(competency)
    if key in RUBRICS:
        return {"competency": key, "levels": RUBRICS[key], "known": True}
    return {"competency": key, "levels": _GENERIC_RUBRIC, "known": False}


# ── question bank ─────────────────────────────────────────────────────────────
QUESTION_BANK: list[dict] = [
    {"competency": "ownership", "difficulty": "easy", "q": "Tell me about a project you're proud of. What exactly did you own?"},
    {"competency": "ownership", "difficulty": "medium", "q": "Describe a time something you owned went wrong. What did you do first, and what changed afterwards?"},
    {"competency": "ownership", "difficulty": "hard", "q": "Tell me about a decision you made alone that you later regretted. How did you find out, and what did it cost?"},
    {"competency": "technical_depth", "difficulty": "easy", "q": "Pick one technology on your resume and explain how it works under the hood."},
    {"competency": "technical_depth", "difficulty": "medium", "q": "Walk me through a design decision on one of your projects. What alternatives did you reject and why?"},
    {"competency": "technical_depth", "difficulty": "hard", "q": "Where does your most complex project break? Describe the failure mode and how you'd measure it."},
    {"competency": "problem_solving", "difficulty": "easy", "q": "Tell me about a bug that took you a while to find. How did you narrow it down?"},
    {"competency": "problem_solving", "difficulty": "medium", "q": "You have an ML model whose accuracy dropped after deployment. Talk me through how you'd investigate."},
    {"competency": "problem_solving", "difficulty": "hard", "q": "Estimate how many requests per second a service needs to handle if it serves one million daily users. State your assumptions as you go."},
    {"competency": "communication", "difficulty": "easy", "q": "Explain one of your projects to someone who isn't technical."},
    {"competency": "communication", "difficulty": "medium", "q": "Tell me about a time you had to convince someone who disagreed with you."},
    {"competency": "collaboration", "difficulty": "easy", "q": "Describe a team project. What was your role and how did the group make decisions?"},
    {"competency": "collaboration", "difficulty": "medium", "q": "Tell me about a disagreement in a team and how it was resolved."},
    {"competency": "leadership", "difficulty": "medium", "q": "Tell me about a time you took the lead without being asked."},
    {"competency": "motivation_fit", "difficulty": "easy", "q": "Why this role, and why now?"},
    {"competency": "motivation_fit", "difficulty": "medium", "q": "What in your background makes you a fit for this team specifically?"},
]


def search_bank(competency: str, difficulty: str, exclude_questions: list[str]) -> list[dict]:
    from difflib import SequenceMatcher
    key = norm_competency(competency)
    def seen(q: str) -> bool:
        return any(SequenceMatcher(None, q.lower(), e.lower()).ratio() > 0.8 for e in exclude_questions)
    pool = [b for b in QUESTION_BANK if b["competency"] == key and not seen(b["q"])]
    exact = [b for b in pool if b["difficulty"] == difficulty]
    return (exact or pool)[:3]


# ── cross-session memory (interface now, curator later) ──────────────────────────────
@dataclass
class InMemoryMemory:
    """Cross-session memory store. `kind` is one of: weak_spot, claim_issue, delivery, note."""
    notes: list[dict] = field(default_factory=list)

    def add(self, topic: str, note: str, kind: str = "note", ts: Optional[float] = None) -> None:
        import time as _t
        self.notes.append({"kind": kind, "topic": topic, "note": note, "ts": ts if ts is not None else _t.time()})

    def recall(self, topic: str, k: int = 3) -> list[dict]:
        q = set(tokenize(topic))
        scored = [(len(q & set(tokenize(n["topic"] + " " + n["note"]))), n) for n in self.notes]
        return [n for s, n in sorted(scored, key=lambda x: -x[0]) if s > 0][:k]

    def weak_spots(self, k: int = 3) -> list[dict]:
        """Most frequently / recently flagged weak spots, one entry per topic."""
        by_topic: dict[str, dict] = {}
        for n in self.notes:
            if n.get("kind") != "weak_spot":
                continue
            cur = by_topic.setdefault(n["topic"], {"topic": n["topic"], "count": 0, "last": n["note"], "ts": 0})
            cur["count"] += 1
            if n["ts"] >= cur["ts"]:
                cur["last"], cur["ts"] = n["note"], n["ts"]
        return sorted(by_topic.values(), key=lambda d: (-d["count"], -d["ts"]))[:k]


def query_coverage(query: str, text: str) -> float:
    """Fraction of distinct query tokens that appear in `text` (a cheap, model-free confidence signal)."""
    q = set(tokenize(query))
    return len(q & set(tokenize(text))) / len(q) if q else 0.0
