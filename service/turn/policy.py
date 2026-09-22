"""Decision policy: turn P(over) and elapsed silence into hold / prompt / end.

The thresholds per patience level are design constants, NOT empirically derived; the benchmark exists to
tune them. `patience` comes from the interviewer's `ask(expected_structure=...)` via the blackboard."""
from __future__ import annotations

from dataclasses import dataclass

THRESHOLD = {"low": 0.50, "normal": 0.65, "high": 0.80}
MIN_END_SILENCE_S = 0.40
HARD_CAP_MULT = 2.0     # END regardless of probability after this many max_hold_s of silence


@dataclass(frozen=True)
class Decision:
    kind: str      # "hold" | "prompt" | "end"
    reason: str


def decide(p_end: float, silence_s: float, level: str, max_hold_s: float, already_prompted: bool = False) -> Decision:
    if silence_s >= max_hold_s * HARD_CAP_MULT:
        return Decision("end", "hard_cap")
    if silence_s >= MIN_END_SILENCE_S and p_end >= THRESHOLD[level]:
        return Decision("end", "model")
    if silence_s >= max_hold_s and not already_prompted:
        return Decision("prompt", "max_hold")
    return Decision("hold", "waiting")
