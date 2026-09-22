"""Deterministic, code-side signals that nudge the interviewer's judgment.

These never decide anything by themselves (the model still chooses the tool call), but relying on the
model to *notice* vagueness on its own, on top of everything else it's tracking each turn, is unreliable in
practice — a live run showed a reasoning model skip both evidence logging and probing in the same turn.
Making the signal explicit and code-computed raises the odds the model acts on it without hiding the
decision itself in code."""
from __future__ import annotations

import re

_FILLER_PHRASES = [
    r"\bwent (pretty )?(well|fine|okay|ok)\b", r"\boverall\b", r"\bin general\b",
    r"\bit worked out\b", r"\busually\b", r"\bsometimes\b", r"\bkind of\b", r"\bsort of\b",
    r"\bstuff\b", r"\bthings?\b(?! that| like| such)", r"\ba lot of\b", r"\bwe (worked on|did|handled)\b",
]
_HAS_NUMBER = re.compile(r"\d")
_FILLER_RE = re.compile("|".join(_FILLER_PHRASES), re.I)


def vagueness_signal(text: str, very_short_words: int = 8, short_words: int = 20) -> tuple[bool, list[str]]:
    """Cheap, explainable heuristic — not a judgment of quality, just what to flag for the model to weigh.
    Returns (flagged, reasons). A short answer PACKED with a specific number (e.g. "Cut latency 40 percent.")
    is not vague, so length alone only flags below `very_short_words`; between that and `short_words` it
    only counts as a contributing reason, combined with the no-number/filler-phrase signals below.
    False positives are expected and fine: the model still decides."""
    words = text.split()
    n = len(words)
    has_number = bool(_HAS_NUMBER.search(text))
    fillers = sorted(set(m.group(0).lower() for m in _FILLER_RE.finditer(text)))
    reasons = []
    if n < short_words:
        reasons.append(f"short ({n} words)")
    if not has_number:
        reasons.append("no numbers or metrics")
    if len(fillers) >= 2:
        reasons.append(f"generic phrasing ({', '.join(fillers[:3])})")
    flagged = n < very_short_words or (not has_number and (n < short_words or len(fillers) >= 2))
    return flagged, reasons