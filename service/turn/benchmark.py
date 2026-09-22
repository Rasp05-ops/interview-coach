"""Turn-taking benchmark: false cut-offs vs latency for timeout baselines and fused models.

Simulation per pause: silence is evaluated on a time grid; a policy that says END at a grid time t < pause_s on a
HOLD pause has CUT THE CANDIDATE OFF (false cut-off). On an END pause the latency is the first END time.
Trained models use leave-speakers-out cross-validation; confidence intervals resample SPEAKERS (clusters).

  python -m service.turn.benchmark --synthetic          # plumbing check ONLY, says nothing about real speech
  python -m service.turn.benchmark --data pauses.jsonl  # real labelled pauses (see dataset.py)
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import Callable, Optional, Protocol

import numpy as np

from .dataset import Example, load_jsonl
from .fusion import FEATURE_NAMES, HeuristicPrior, LogReg, PauseModel, build_features
from .policy import decide
from .structure import StructureState

GRID = [round(0.3 + 0.25 * i, 2) for i in range(0, 40)]     # 0.3 s ... 10 s
PATIENCE = {"star_story": ("normal", 5.0), "think_aloud": ("high", 10.0), "short_answer": ("low", 2.5), "open": ("normal", 5.0)}


def _struct(ex: Example) -> StructureState:
    s = dict(ex.struct)
    s["star_seen"] = tuple(s.get("star_seen", ()))
    return StructureState(**s) if s else StructureState()


def features_at(ex: Example, t: float) -> np.ndarray:
    return build_features(ex.prosody, _struct(ex), ex.expected_structure, t, ex.smart_turn)


class Policy(Protocol):
    name: str
    def end_time(self, ex: Example) -> Optional[float]: ...


@dataclass
class TimeoutPolicy:
    tau: float
    @property
    def name(self) -> str:
        return f"vad_timeout_{int(self.tau * 1000)}ms"
    def end_time(self, ex: Example) -> Optional[float]:
        return next((t for t in GRID if t >= self.tau and t < ex.pause_s + (1e-9 if ex.label == "end" else 0)), None)


@dataclass
class ModelPolicy:
    model: PauseModel
    agent_patience: bool = True        # False = ignore the interviewer's expected_structure, always "normal"
    label: str = "model"
    @property
    def name(self) -> str:
        return f"{self.label}{'+agent_patience' if self.agent_patience else '+fixed_patience'}"
    def end_time(self, ex: Example) -> Optional[float]:
        level, hold = PATIENCE[ex.expected_structure] if self.agent_patience else PATIENCE["open"]
        for t in GRID:
            if t >= ex.pause_s + (1e-9 if ex.label == "end" else 0):
                break
            p = float(self.model.predict_proba(features_at(ex, t))[0])
            if decide(p, t, level, hold).kind == "end":
                return t
        return None


def outcomes(examples: list[Example], policy: Policy) -> list[tuple[str, str, Optional[float], float]]:
    return [(e.speaker, e.label, policy.end_time(e), e.pause_s) for e in examples]


def summarize(outs: list[tuple[str, str, Optional[float], float]]) -> dict:
    holds = [o for o in outs if o[1] == "hold"]
    ends = [o for o in outs if o[1] == "end"]
    lat = [(o[2] if o[2] is not None else o[3]) for o in ends]
    return {"n_hold": len(holds), "n_end": len(ends),
            "false_cutoff_rate": round(sum(o[2] is not None for o in holds) / len(holds), 3) if holds else None,
            "median_end_latency_s": round(float(np.median(lat)), 2) if lat else None,
            "missed_end_rate": round(sum(o[2] is None for o in ends) / len(ends), 3) if ends else None}


def cluster_bootstrap(outs, key: str, n: int = 300, seed: int = 0) -> tuple[Optional[float], Optional[float]]:
    speakers = sorted({o[0] for o in outs})
    if len(speakers) < 2:
        return None, None
    rng = np.random.default_rng(seed)
    by = {s: [o for o in outs if o[0] == s] for s in speakers}
    vals = []
    for _ in range(n):
        pick = rng.choice(speakers, size=len(speakers), replace=True)
        v = summarize([o for s in pick for o in by[s]])[key]
        if v is not None:
            vals.append(v)
    return (round(float(np.percentile(vals, 2.5)), 3), round(float(np.percentile(vals, 97.5)), 3)) if vals else (None, None)


def rows(examples: list[Example]) -> tuple[np.ndarray, np.ndarray]:
    X, y = [], []
    for e in examples:
        for t in GRID:
            if t >= e.pause_s + (1e-9 if e.label == "end" else 0):
                break
            X.append(features_at(e, t)); y.append(1.0 if e.label == "end" else 0.0)
    return np.array(X), np.array(y)


def loso_outcomes(examples: list[Example], agent_patience: bool, label: str) -> tuple[list, list[tuple[set, set]]]:
    """Leave-one-speaker-out: each speaker is scored by a model that never saw them. Returns outcomes + the split audit."""
    speakers = sorted({e.speaker for e in examples})
    outs, audit = [], []
    for s in speakers:
        train = [e for e in examples if e.speaker != s]
        test = [e for e in examples if e.speaker == s]
        X, y = rows(train)
        model = LogReg().fit(X, y)
        audit.append(({e.speaker for e in train}, {e.speaker for e in test}))
        outs += outcomes(test, ModelPolicy(model, agent_patience, label))
    return outs, audit


def run(examples: list[Example]) -> dict:
    table = {}
    def add(name, outs):
        s = summarize(outs)
        s["false_cutoff_ci95"] = cluster_bootstrap(outs, "false_cutoff_rate")
        table[name] = s
    for tau in (0.3, 0.6, 1.0):
        add(TimeoutPolicy(tau).name, outcomes(examples, TimeoutPolicy(tau)))
    add("heuristic_prior+fixed_patience", outcomes(examples, ModelPolicy(HeuristicPrior(), False, "heuristic_prior")))
    add("heuristic_prior+agent_patience", outcomes(examples, ModelPolicy(HeuristicPrior(), True, "heuristic_prior")))
    if len({e.speaker for e in examples}) >= 3:
        for ap in (False, True):
            o, audit = loso_outcomes(examples, ap, "logreg_loso")
            assert all(not (tr & te) for tr, te in audit), "speaker leakage between train and test"
            add(f"logreg_loso+{'agent' if ap else 'fixed'}_patience", o)
    return table


# ── synthetic data: validates the plumbing only ─────────────────────────────────────
def synthesize(n_speakers: int = 8, per_speaker: int = 40, seed: int = 0) -> list[Example]:
    rng = np.random.default_rng(seed)
    out = []
    for s in range(n_speakers):
        off = rng.normal(0, 1.0)                                   # speaker-specific prosody offset
        for _ in range(per_speaker):
            structure = str(rng.choice(["star_story", "think_aloud", "short_answer"]))
            hold = rng.random() < 0.6
            mean = {"think_aloud": 1.6, "star_story": 0.9, "short_answer": 0.6}[structure]
            pause = float(np.clip(rng.lognormal(np.log(mean), 0.5), 0.35, 6.0)) if hold else 3.0
            p_inc, p_fill = (0.35, 0.25) if hold else (0.10, 0.08)
            st = {"words": 30, "looks_incomplete": bool(rng.random() < p_inc), "ends_with_filler": bool(rng.random() < p_fill),
                  "star_seen": [], "star_missing": int(rng.integers(0, 3)) if (hold and structure == "star_story") else int(rng.integers(0, 2)) if structure == "star_story" else 0,
                  "result_seen": bool(rng.random() < (0.3 if hold else 0.7))}
            pros = {"energy_slope_db_s": float(rng.normal(-1 if hold else -12, 6)), "energy_drop_db": float(rng.normal(-1 if hold else -6, 4)),
                    "f0_slope_st_s": float(rng.normal(0 if hold else -5, 3)) + off, "f0_end_rel_st": float(rng.normal(0 if hold else -2, 2)),
                    "voiced_ratio_end": float(rng.uniform(0.3, 1)), "lengthening_proxy": float(rng.normal(1, 0.3))}
            out.append(Example(f"spk{s}", structure, "hold" if hold else "end", round(pause, 2), pros, st, None, "", True))
    return out


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--synthetic", action="store_true")
    g.add_argument("--data")
    a = ap.parse_args(argv)
    ex = synthesize() if a.synthetic else load_jsonl(a.data)
    print(json.dumps({"data": "SYNTHETIC - plumbing check only; results say nothing about real speech" if a.synthetic
                      else f"{len(ex)} labelled pauses from {len({e.speaker for e in ex})} speaker(s)",
                      "results": run(ex)}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
