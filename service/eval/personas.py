"""Simulated candidates. `ScriptedPersona` is deterministic and offline (used to test the harness).
`LLMPersona` role-plays from a persona brief using a real model (needs GROQ_API_KEY)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..agent.blackboard import DeliverySignals
from ..agent.llm import LLM

STRONG = ("I built the Kafka consumer myself at Acme, and I owned the on-call runbook. We measured p95 latency before and after, "
          "and my change cut it by 40 percent. The trade-off was more partitions, which raised broker load, so I capped it at twelve.")
VAGUE = "Yeah so we worked on a bunch of stuff and it went pretty well overall. The team did a lot of things and it was a good experience."
INFLATED = "I single-handedly cut Kafka latency by 90 percent and I also rewrote the whole payments platform."
RAMBLER = ("So basically what happened was that there was this thing, and I think, well, the thing was that we had a system, "
           "and the system had components, and the components talked to each other, and, you know, that was the general idea. " * 6)


@dataclass
class Persona:
    name: str
    brief: str                       # what the persona is like (used by LLMPersona and in reports)
    canned: str = ""
    delivery: Optional[DeliverySignals] = None

    def respond(self, question: str, llm: Optional[LLM] = None) -> tuple[str, DeliverySignals]:
        if llm is None:
            text = self.canned
        else:
            resp = llm.chat([{"role": "system", "content": f"You are a job candidate. {self.brief} Answer the interviewer's question in 40-120 words, spoken style."},
                             {"role": "user", "content": question}], [])
            text = resp.content or self.canned
        words = len(text.split())
        d = self.delivery or DeliverySignals(audio_seconds=max(5.0, words / 2.5), wpm=150)
        return text, d


PERSONAS: dict[str, Persona] = {
    "strong": Persona("strong", "You are specific, quantify results, and describe your personal role. Resume: Acme Kafka intern, 40 percent latency cut.", STRONG),
    "vague": Persona("vague", "You are vague: you say 'we', avoid numbers, and never state your own contribution.", VAGUE),
    "inflated": Persona("inflated", "You exaggerate: you claim a 90 percent latency cut (the resume says 40) and claim work you did not do.", INFLATED),
    "rambler": Persona("rambler", "You ramble at length without making a point.", RAMBLER,
                       DeliverySignals(audio_seconds=150, wpm=170, filler_count=14, long_pause_count=0)),
    "thinker": Persona("thinker", "You pause a lot to think before answering, then give a correct, structured answer.", STRONG,
                       DeliverySignals(audio_seconds=70, wpm=95, filler_count=2, long_pause_count=6, longest_pause_s=4.2, first_word_delay_s=3.5)),
}
