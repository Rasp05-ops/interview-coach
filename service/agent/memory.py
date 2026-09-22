"""Persistent cross-session memory and the curator that writes to it.

The curator is deterministic on purpose: it turns the *report* (already built from verified evidence)
into notes. No LLM decides what the candidate is bad at."""
from __future__ import annotations

import json
import os
import tempfile
from typing import Optional

from .retrieval import InMemoryMemory
from .scoring import WEAK_THRESHOLD


class JsonFileMemory(InMemoryMemory):
    """InMemoryMemory persisted to a JSON file (atomic write). One file per candidate."""
    def __init__(self, path: str):
        super().__init__()
        self.path = path
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    self.notes = list(json.load(f).get("notes", []))
            except (OSError, ValueError):
                self.notes = []   # corrupt file: start clean rather than crash a session

    def add(self, topic: str, note: str, kind: str = "note", ts: Optional[float] = None) -> None:
        super().add(topic, note, kind, ts)
        self._flush()

    def _flush(self) -> None:
        d = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"notes": self.notes}, f)
        os.replace(tmp, self.path)


def curate(report: dict) -> list[dict]:
    """Report -> memory notes. Pure function; easy to test."""
    notes: list[dict] = []
    for comp, s in report.get("competencies", {}).items():
        lvl = s.get("mean_level")
        if lvl is not None and lvl <= WEAK_THRESHOLD:
            notes.append({"kind": "weak_spot", "topic": comp,
                          "note": f"{comp}: mean rubric level {lvl}/5 over {s['n_evidence']} evidence item(s)"})
        elif lvl is None:
            notes.append({"kind": "note", "topic": comp, "note": f"{comp}: not enough evidence last session"})
    for c in report.get("claims", []):
        if c["status"] in ("contradicted", "unsupported"):
            notes.append({"kind": "claim_issue", "topic": "claims", "note": f"{c['status']}: {c['text']}"})
    d = report.get("delivery") or {}
    if d.get("fillers_per_min") and d["fillers_per_min"] > 6:
        notes.append({"kind": "weak_spot", "topic": "filler words", "note": f"{d['fillers_per_min']} fillers/min"})
    if d.get("avg_wpm") and (d["avg_wpm"] > 180 or d["avg_wpm"] < 110):
        notes.append({"kind": "weak_spot", "topic": "speaking pace", "note": f"average {d['avg_wpm']} wpm"})
    return notes
