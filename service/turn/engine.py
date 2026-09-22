"""Streaming turn-taking engine.

Feed 16 kHz mono PCM16 chunks; get back events. At each pause (after >= eval_first_s of silence, then every
eval_step_s) it computes P(over) from prosody-before-the-pause + answer structure + silence (+ optional Smart
Turn) and applies the patience-aware policy. Patience is read from the interviewer at call time, so the agent's
declared expectation for the current question changes how long the engine waits."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np

from .audio import HOP, SR, EnergyVAD, pcm16_to_float
from .features import FeatureExtractor, extract_prosody
from .fusion import HeuristicPrior, PauseModel, build_features
from .policy import decide
from .structure import AnswerStructureTracker

LONG_PAUSE_S = 0.7


@dataclass
class EngineConfig:
    eval_first_s: float = 0.30
    eval_step_s: float = 0.25
    min_speech_s: float = 0.15
    no_speech_prompt_s: float = 8.0
    max_turn_s: float = 180.0


class TurnEngine:
    def __init__(self, patience_fn: Callable[[], dict], model: Optional[PauseModel] = None,
                 extractor: FeatureExtractor = extract_prosody, smart_turn: Optional[Callable[[np.ndarray], float]] = None,
                 cfg: Optional[EngineConfig] = None, vad: Optional[EnergyVAD] = None):
        self.patience_fn, self.model = patience_fn, model or HeuristicPrior()
        self.extractor, self.smart_turn, self.cfg = extractor, smart_turn, cfg or EngineConfig()
        self.vad = vad or EnergyVAD()
        self.tracker = AnswerStructureTracker()
        self.reset_turn()

    # ── lifecycle ────────────────────────────────────────────────────────────
    def reset_turn(self) -> None:
        self.tracker.reset(self.patience_fn().get("expected_structure", "open"))
        self._chunks: list[np.ndarray] = []
        self._n = 0                       # samples consumed
        self._frames = 0
        self._speech_run = 0
        self.speaking = self.has_spoken = self.pause_active = self.over = False
        self._silence_frames = 0
        self._pause_start_sample = 0
        self._next_eval = self.cfg.eval_first_s
        self._prosody: dict = {}
        self._prompted = self._no_speech_prompted = False
        self._speech_frames = 0
        self._first_word_s = 0.0
        self.pauses: list[float] = []
        self.last_p_end: Optional[float] = None

    def set_transcript(self, text: str) -> None:
        self.tracker.update(text)

    def stats(self) -> dict:
        dur = self._n / SR
        return {"audio_seconds": round(dur, 2), "speech_seconds": round(self._speech_frames * HOP / SR, 2),
                "first_word_delay_s": round(self._first_word_s, 2),
                "long_pause_count": sum(p >= LONG_PAUSE_S for p in self.pauses),
                "longest_pause_s": round(max(self.pauses, default=0.0), 2), "eot_probability": self.last_p_end}

    # ── streaming ────────────────────────────────────────────────────────────
    def feed(self, pcm16: bytes) -> list[dict]:
        if self.over:
            return []
        x = pcm16_to_float(pcm16)
        self._chunks.append(x)
        events: list[dict] = []
        for is_speech, _db in self.vad.process(x):
            self._on_frame(is_speech, events)
            if self.over:
                break
        self._n += len(x)
        if not self.over and self._n / SR >= self.cfg.max_turn_s:
            self.over = True
            events.append({"type": "decision", "decision": "end", "reason": "max_turn", "silence_s": 0.0,
                           "p_end": self.last_p_end, "patience": self.patience_fn().get("level", "normal")})
        return events

    def _audio(self) -> np.ndarray:
        if len(self._chunks) > 1:
            self._chunks = [np.concatenate(self._chunks)]
        return self._chunks[0] if self._chunks else np.zeros(0, dtype=np.float32)

    def _on_frame(self, is_speech: bool, events: list[dict]) -> None:
        self._frames += 1
        t = self._frames * HOP / SR
        min_frames = int(self.cfg.min_speech_s * SR / HOP)
        if is_speech:
            self._speech_run += 1
            self._speech_frames += 1
            if self._speech_run >= min_frames:
                if not self.speaking:
                    self.speaking = True
                    if not self.has_spoken:
                        self._first_word_s = t
                    if self.pause_active:
                        self.pauses.append(self._silence_frames * HOP / SR)
                        events.append({"type": "resumed", "pause_s": round(self.pauses[-1], 2)})
                        self.pause_active = False
                    events.append({"type": "speech_start", "t": round(t, 2)})
                    self.has_spoken = True
                self._silence_frames = 0
                self._next_eval, self._prompted = self.cfg.eval_first_s, False
            return
        self._speech_run = 0
        if self.speaking:
            self.speaking = False
            self.pause_active = True
            self._silence_frames = 0
            self._pause_start_sample = self._frames * HOP
            audio = self._audio()
            self._prosody = self.extractor(audio[: self._pause_start_sample]) if len(audio) else {}
            events.append({"type": "pause_start", "t": round(t, 2)})
        self._silence_frames += 1
        silence_s = (self._silence_frames + self.vad.hangover_frames) * HOP / SR
        if not self.has_spoken:
            if silence_s >= self.cfg.no_speech_prompt_s and not self._no_speech_prompted:
                self._no_speech_prompted = True
                events.append({"type": "decision", "decision": "prompt", "reason": "no_speech", "silence_s": round(silence_s, 2)})
            return
        if silence_s + 1e-9 >= self._next_eval:
            self._next_eval += self.cfg.eval_step_s
            self._evaluate(silence_s, events)

    def _evaluate(self, silence_s: float, events: list[dict]) -> None:
        pat = self.patience_fn()
        level, max_hold = pat.get("level", "normal"), float(pat.get("max_hold_s", 5.0))
        st = self.tracker.state()
        smart = None
        if self.smart_turn is not None:
            audio = self._audio()
            smart = float(self.smart_turn(audio[: self._pause_start_sample][-8 * SR:]))
        x = build_features(self._prosody, st, pat.get("expected_structure", "open"), silence_s, smart)
        p = float(self.model.predict_proba(x)[0])
        self.last_p_end = round(p, 3)
        d = decide(p, silence_s, level, max_hold, self._prompted)
        if d.kind == "prompt":
            self._prompted = True
        if d.kind == "end":
            self.over = True
            self.pauses.append(silence_s)
        events.append({"type": "decision", "decision": d.kind, "reason": d.reason, "p_end": round(p, 3),
                       "silence_s": round(silence_s, 2), "patience": level})
