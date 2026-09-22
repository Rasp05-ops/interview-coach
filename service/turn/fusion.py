"""Fusion of prosody, answer structure, silence and (optionally) a Smart Turn probability into P(turn is over).

* `HeuristicPrior` is an UNTRAINED starting point that uses only signals whose direction is uncontroversial
  (longer silence -> more likely over; unfinished clause / trailing filler / missing STAR result -> less likely).
  Its weights are hand-set, not fitted. Replace it with a `LogReg` trained on real labelled pauses.
* `LogReg` is a plain numpy L2-regularised logistic regression with standardisation, JSON-serialisable."""
from __future__ import annotations

import json
from typing import Optional, Protocol

import numpy as np

from .features import PROSODY_KEYS
from .structure import StructureState, structure_features

FEATURE_NAMES = ["silence_s", "log_words", "looks_incomplete", "ends_with_filler", "star_result_seen", "star_missing",
                 "think_aloud", *PROSODY_KEYS, "smart_turn_prob", "smart_turn_missing"]


def build_features(prosody: dict, struct: StructureState, expected_structure: str, silence_s: float,
                   smart_turn: Optional[float] = None) -> np.ndarray:
    d = {"silence_s": silence_s, **structure_features(struct, expected_structure), **prosody,
         "smart_turn_prob": 0.0 if smart_turn is None else float(smart_turn),
         "smart_turn_missing": 1.0 if smart_turn is None else 0.0}
    return np.array([float(d.get(n, 0.0)) for n in FEATURE_NAMES], dtype=np.float64)


class PauseModel(Protocol):
    def predict_proba(self, x: np.ndarray) -> np.ndarray: ...   # shape (n, d) -> (n,)


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))


class HeuristicPrior:
    """UNTRAINED. See module docstring."""
    W = {"silence_s": 2.8, "looks_incomplete": -1.8, "ends_with_filler": -1.2, "star_missing": -0.5, "think_aloud": -0.4}
    BIAS = -2.4

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        x = np.atleast_2d(x)
        z = np.full(len(x), self.BIAS)
        for name, w in self.W.items():
            z = z + w * x[:, FEATURE_NAMES.index(name)]
        return _sigmoid(z)


class LogReg:
    def __init__(self, l2: float = 1.0, lr: float = 0.1, iters: int = 800):
        self.l2, self.lr, self.iters = l2, lr, iters
        self.mu = self.sd = self.w = None
        self.b = 0.0

    def fit(self, X: np.ndarray, y: np.ndarray) -> "LogReg":
        X = np.asarray(X, dtype=np.float64); y = np.asarray(y, dtype=np.float64)
        self.mu, self.sd = X.mean(0), X.std(0) + 1e-6
        Z = (X - self.mu) / self.sd
        w, b = np.zeros(Z.shape[1]), 0.0
        for _ in range(self.iters):
            p = _sigmoid(Z @ w + b)
            g = Z.T @ (p - y) / len(y) + self.l2 * w / len(y)
            w -= self.lr * g
            b -= self.lr * float(np.mean(p - y))
        self.w, self.b = w, b
        return self

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        x = np.atleast_2d(np.asarray(x, dtype=np.float64))
        return _sigmoid(((x - self.mu) / self.sd) @ self.w + self.b)

    def to_json(self) -> str:
        return json.dumps({"names": FEATURE_NAMES, "mu": self.mu.tolist(), "sd": self.sd.tolist(), "w": self.w.tolist(), "b": self.b})

    @classmethod
    def from_json(cls, s: str) -> "LogReg":
        d = json.loads(s)
        if d["names"] != FEATURE_NAMES:
            raise ValueError("feature set changed since this model was trained; retrain")
        m = cls(); m.mu, m.sd, m.w, m.b = np.array(d["mu"]), np.array(d["sd"]), np.array(d["w"]), d["b"]
        return m
