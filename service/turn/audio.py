"""Streaming audio primitives: PCM conversion, frame energy, and a small adaptive energy VAD.

The energy VAD is a dependency-free default that works on clean, close-mic audio. It is NOT robust to
background noise; swap in Silero VAD behind the same `process()` interface for real use."""
from __future__ import annotations

from collections import deque

import numpy as np

SR = 16000
FRAME = 400   # 25 ms
HOP = 160     # 10 ms


def pcm16_to_float(data: bytes) -> np.ndarray:
    return np.frombuffer(data[: len(data) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0


def frame_db(x: np.ndarray) -> np.ndarray:
    """Per-frame RMS in dBFS for complete frames only."""
    if len(x) < FRAME:
        return np.zeros(0, dtype=np.float32)
    n = 1 + (len(x) - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(n)[:, None]
    rms = np.sqrt(np.mean(x[idx] ** 2, axis=1))
    return (20 * np.log10(rms + 1e-9)).astype(np.float32)


class EnergyVAD:
    def __init__(self, margin_db: float = 12.0, abs_floor_db: float = -50.0, hangover_frames: int = 8):
        self.margin_db, self.abs_floor_db, self.hangover_frames = margin_db, abs_floor_db, hangover_frames
        self._buf = np.zeros(0, dtype=np.float32)
        self._hist: deque[float] = deque(maxlen=300)   # last 3 s of frame energies
        self._hang = 0

    def _threshold(self) -> float:
        floor = float(np.percentile(self._hist, 10)) if len(self._hist) >= 20 else -60.0
        return max(min(floor, -35.0) + self.margin_db, self.abs_floor_db)

    def process(self, x: np.ndarray) -> list[tuple[bool, float]]:
        """Consume samples; return one (is_speech, dB) per completed 10 ms hop."""
        self._buf = np.concatenate([self._buf, x])
        out: list[tuple[bool, float]] = []
        while len(self._buf) >= FRAME:
            db = float(frame_db(self._buf[:FRAME])[0])
            self._buf = self._buf[HOP:]
            speech = db > self._threshold()
            self._hist.append(db)
            if speech:
                self._hang = self.hangover_frames
            elif self._hang > 0:
                self._hang -= 1
                speech = True
            out.append((speech, db))
        return out
