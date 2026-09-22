"""Causal prosody features computed on the audio BEFORE a pause (never on the silence itself).

These are simple, standard measures (energy trend, F0 trend via autocorrelation, voiced ratio, a rate proxy).
`extract_prosody` is the default `FeatureExtractor`; the feature extractor from a separate EOT project can be
passed to `TurnEngine(extractor=...)` as long as it returns a dict with the same keys (missing keys default to 0)."""
from __future__ import annotations

from typing import Callable

import numpy as np

from .audio import HOP, SR, frame_db

PROSODY_KEYS = ["energy_slope_db_s", "energy_drop_db", "f0_slope_st_s", "f0_end_rel_st", "voiced_ratio_end", "lengthening_proxy"]
FeatureExtractor = Callable[[np.ndarray], dict]


def _f0_track(x: np.ndarray, frame_ms: int = 40, hop_ms: int = 10, fmin: int = 75, fmax: int = 400) -> np.ndarray:
    """Autocorrelation F0 per frame in Hz; 0 where unvoiced."""
    fl, hp = SR * frame_ms // 1000, SR * hop_ms // 1000
    lo, hi = SR // fmax, SR // fmin
    out = []
    for s in range(0, max(0, len(x) - fl), hp):
        f = x[s:s + fl] - np.mean(x[s:s + fl])
        if np.sqrt(np.mean(f ** 2)) < 0.005:
            out.append(0.0); continue
        ac = np.correlate(f, f, mode="full")[fl - 1:]
        if ac[0] <= 0:
            out.append(0.0); continue
        seg = ac[lo:hi]
        k = int(np.argmax(seg)) + lo
        out.append(SR / k if ac[k] / ac[0] > 0.4 else 0.0)
    return np.array(out, dtype=np.float32)


def _slope(y: np.ndarray, dt: float) -> float:
    if len(y) < 3:
        return 0.0
    t = np.arange(len(y)) * dt
    return float(np.polyfit(t, y, 1)[0])


def extract_prosody(audio: np.ndarray, window_s: float = 1.0) -> dict:
    """Features of the last `window_s` seconds of speech before the pause."""
    x = audio[-int(window_s * SR):].astype(np.float32)
    if len(x) < SR // 4:
        return {k: 0.0 for k in PROSODY_KEYS}
    db = frame_db(x)
    dt = HOP / SR
    last500 = db[-50:]
    e_slope = _slope(last500, dt)
    drop = float(np.mean(db[-20:]) - np.mean(db[-70:-20])) if len(db) >= 40 else 0.0
    f0 = _f0_track(x)
    voiced = f0[f0 > 0]
    tail = f0[-50:]
    tail_voiced = tail[tail > 0]
    st = lambda f: 12 * np.log2(f / 100.0)
    f0_slope = _slope(st(tail_voiced), dt) if len(tail_voiced) >= 5 else 0.0
    f0_end_rel = float(st(np.median(f0[-20:][f0[-20:] > 0])) - st(np.median(voiced))) if len(voiced) >= 5 and np.any(f0[-20:] > 0) else 0.0
    # rate proxy: energy-peak density in the last 400 ms vs the whole window (<1 means slowing down = lengthening)
    def peaks(seg):
        return float(np.sum((seg[1:-1] > seg[:-2]) & (seg[1:-1] > seg[2:]) & (seg[1:-1] > np.mean(seg)))) / max(len(seg) * dt, 1e-3)
    rate_all, rate_end = peaks(db), peaks(db[-40:]) if len(db) > 45 else 0.0
    return {"energy_slope_db_s": e_slope, "energy_drop_db": drop, "f0_slope_st_s": f0_slope, "f0_end_rel_st": f0_end_rel,
            "voiced_ratio_end": float(np.mean(tail > 0)) if len(tail) else 0.0,
            "lengthening_proxy": (rate_end / rate_all) if rate_all > 0 else 1.0}
