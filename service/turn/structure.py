"""Incremental answer-structure tracker: a cheap, model-free read of where the candidate is in their answer.

Works on the running transcript. Cues are deliberately simple regexes; the point is a signal the turn-taking
model can use ("has not stated a result yet", "last clause is unfinished"), and it is evaluated in the benchmark,
not assumed to be right."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

STAR_CUES = {
    "situation": r"\b(when i was|at my|during my|in my|last (year|summer|semester)|our team|the project|the problem was|we had)\b",
    "task": r"\b(my (goal|task|job|role)|i (was|am) (responsible|tasked)|i needed to|we needed to|the goal was)\b",
    "action": r"\b(i (built|wrote|designed|implemented|decided|led|created|fixed|trained|proposed|ran|set up)|so i)\b",
    "result": r"\b(as a result|which (led|resulted)|resulting in|in the end|ended up|reduced|improved|increased|cut|saved|\d+\s?(%|percent)|we (shipped|launched|won))\b",
}
DANGLING_END = {"and", "but", "so", "because", "the", "a", "an", "to", "of", "in", "on", "for", "with", "that", "which",
                "then", "or", "as", "if", "when", "while", "is", "was", "are", "were", "my", "our", "i", "we", "it", "is", "would", "could"}
FILLER_END = {"um", "uh", "umm", "uhh", "er", "erm", "hmm", "like"}


@dataclass
class StructureState:
    words: int = 0
    looks_incomplete: bool = False      # ends on a dangling word (and/because/the/...)
    ends_with_filler: bool = False
    star_seen: tuple = ()
    star_missing: int = 0               # of (action, result) not yet seen; 0 unless expecting a star_story
    result_seen: bool = False


class AnswerStructureTracker:
    def __init__(self, expected_structure: str = "open"):
        self.expected_structure = expected_structure
        self.text = ""

    def reset(self, expected_structure: str = "open") -> None:
        self.expected_structure, self.text = expected_structure, ""

    def update(self, text: str) -> StructureState:
        self.text = text or ""
        return self.state()

    def state(self) -> StructureState:
        t = self.text.strip().lower()
        toks = re.findall(r"[a-z']+", t)
        last = toks[-1] if toks else ""
        seen = tuple(k for k, pat in STAR_CUES.items() if re.search(pat, t))
        missing = sum(1 for k in ("action", "result") if k not in seen) if self.expected_structure == "star_story" else 0
        return StructureState(
            words=len(toks),
            looks_incomplete=bool(toks) and (last in DANGLING_END) and not t.endswith((".", "?", "!")),
            ends_with_filler=last in FILLER_END,
            star_seen=seen, star_missing=missing, result_seen="result" in seen)


def structure_features(s: StructureState, expected_structure: str) -> dict:
    return {"log_words": math.log1p(s.words), "looks_incomplete": float(s.looks_incomplete),
            "ends_with_filler": float(s.ends_with_filler), "star_result_seen": float(s.result_seen),
            "star_missing": float(s.star_missing), "think_aloud": float(expected_structure == "think_aloud")}
