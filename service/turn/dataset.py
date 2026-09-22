"""Turn-taking dataset: labelled pauses with automatic HOLD/END labels.

Every pause inside a recorded answer that is followed by more speech is a HOLD; the silence after the last word
is the END. No manual labelling is needed for the primary label, but recordings MUST include >= ~2 s of trailing
silence, otherwise END examples are truncated and latency is under-measured.

Only the audio/transcript BEFORE each pause is used for features (causal), never the silence or what follows."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Callable, Iterable, Optional

import numpy as np

from .audio import SR
from .features import FeatureExtractor, extract_prosody
from .structure import AnswerStructureTracker


@dataclass
class Example:
    speaker: str
    expected_structure: str
    label: str                    # "hold" | "end"
    pause_s: float                # hold: how long the silence lasted; end: trailing silence available
    prosody: dict = field(default_factory=dict)
    struct: dict = field(default_factory=dict)   # StructureState as dict
    smart_turn: Optional[float] = None
    text_so_far: str = ""
    synthetic: bool = False


def pauses_from_words(words: list[dict], total_s: float, min_gap: float = 0.3) -> list[tuple[float, float, str]]:
    """words: [{word,start,end}] sorted by time. Returns (pause_start, pause_end, label)."""
    out = []
    for a, b in zip(words, words[1:]):
        if b["start"] - a["end"] >= min_gap:
            out.append((a["end"], b["start"], "hold"))
    if words and total_s - words[-1]["end"] >= min_gap:
        out.append((words[-1]["end"], total_s, "end"))
    return out


def examples_from_recording(audio: np.ndarray, words: list[dict], speaker: str, expected_structure: str,
                            extractor: FeatureExtractor = extract_prosody, min_gap: float = 0.3,
                            smart_turn: Optional[Callable[[np.ndarray], float]] = None) -> list[Example]:
    total_s = len(audio) / SR
    tracker = AnswerStructureTracker(expected_structure)
    out = []
    for start, end, label in pauses_from_words(words, total_s, min_gap):
        text = " ".join(w["word"] for w in words if w["end"] <= start + 1e-6)
        st = tracker.update(text)
        before = audio[: int(start * SR)]
        out.append(Example(speaker, expected_structure, label, round(end - start, 3),
                           extractor(before), asdict(st) | {"star_seen": list(st.star_seen)},
                           float(smart_turn(before[-8 * SR:])) if smart_turn else None, text))
    return out


def save_jsonl(examples: Iterable[Example], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for e in examples:
            f.write(json.dumps(asdict(e)) + "\n")


def load_jsonl(path: str) -> list[Example]:
    with open(path, encoding="utf-8") as f:
        return [Example(**json.loads(line)) for line in f if line.strip()]
