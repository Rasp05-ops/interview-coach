"""Retrieval benchmark for claim verification: static BM25 vs the agentic loop.

Small, hand-written and SYNTHETIC (one fictional resume, 22 claims). It exists to (1) give a reproducible
baseline number for the static retriever today and (2) let the agentic loop be measured against it with a live
model. It is not a claim about real-world retrieval quality.

  python -m service.eval.rag_bench --mode static
  GROQ_API_KEY=... python -m service.eval.rag_bench --mode agentic
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Optional

from ..agent.agentic_rag import AgenticRAG, StaticRAG
from ..agent.llm import GroqChat
from ..agent.retrieval import Retriever

RESUME = """EXPERIENCE
Software Engineering Intern, Acme Payments (Summer 2025)
Built a Kafka ingestion pipeline that cut end-to-end latency by 40 percent.
Owned the on-call runbook and reduced pager alerts by 25 percent.

Data Science Intern, Northwind Analytics (Winter 2024)
Trained a gradient boosting churn model reaching 0.87 AUC on 200k customers.
Presented findings to the retention team and shipped a weekly scoring job in Airflow.

PROJECTS
Turn detector: logistic regression on prosody features (energy, pitch, fillers) for voice agent turn-taking.
Repo assistant: LangGraph agents with pgvector retrieval over 50 repositories.
Interview coach: Next.js app with Whisper transcription and STAR scoring.

EDUCATION
B.Tech Mechanical Engineering, State Technical University, CGPA 8.4

SKILLS
Python, C++, PyTorch, SQL, Docker
"""
JD = "Backend engineer for streaming data pipelines using Kafka and Python; own services in production."

# kind: lexical = shares words with the resume; paraphrase = different words, same fact; unsupported = not on resume
ITEMS: list[dict] = [
    {"kind": "lexical", "claim": "I built a Kafka ingestion pipeline", "gold": "Kafka ingestion pipeline"},
    {"kind": "lexical", "claim": "I owned the on-call runbook", "gold": "on-call runbook"},
    {"kind": "lexical", "claim": "I trained a gradient boosting churn model", "gold": "gradient boosting churn model"},
    {"kind": "lexical", "claim": "I shipped a weekly scoring job in Airflow", "gold": "weekly scoring job"},
    {"kind": "lexical", "claim": "I built LangGraph agents with pgvector retrieval", "gold": "LangGraph agents"},
    {"kind": "lexical", "claim": "My model reached 0.87 AUC", "gold": "0.87 AUC"},
    {"kind": "lexical", "claim": "I used logistic regression on prosody features", "gold": "logistic regression on prosody"},
    {"kind": "lexical", "claim": "I built a Next.js interview app with Whisper transcription", "gold": "Next.js app"},
    {"kind": "paraphrase", "claim": "I reduced response time by forty percent on the streaming service", "gold": "cut end-to-end latency by 40 percent"},
    {"kind": "paraphrase", "claim": "I decreased paging noise by a quarter", "gold": "reduced pager alerts by 25 percent"},
    {"kind": "paraphrase", "claim": "I predicted customer attrition with a boosted trees model", "gold": "churn model"},
    {"kind": "paraphrase", "claim": "I automated a batch job that scores customers every week", "gold": "weekly scoring job"},
    {"kind": "paraphrase", "claim": "I worked on detecting when a speaker has finished talking", "gold": "voice agent turn-taking"},
    {"kind": "paraphrase", "claim": "I built a tool that helps new developers understand codebases", "gold": "Repo assistant"},
    {"kind": "paraphrase", "claim": "I communicated results to stakeholders", "gold": "Presented findings"},
    {"kind": "paraphrase", "claim": "I worked with hundreds of thousands of customer records", "gold": "200k customers"},
    {"kind": "unsupported", "claim": "I led a team of ten engineers", "gold": None},
    {"kind": "unsupported", "claim": "I published a paper at NeurIPS", "gold": None},
    {"kind": "unsupported", "claim": "I built a mobile app in Swift", "gold": None},
    {"kind": "unsupported", "claim": "I managed a two million dollar budget", "gold": None},
    {"kind": "unsupported", "claim": "I won a national hackathon", "gold": None},
    {"kind": "unsupported", "claim": "I migrated a monolith to microservices", "gold": None},
]


def evaluate(rag, k: int = 3) -> dict:
    hit = {"lexical": [], "paraphrase": []}
    false_sufficient, calls, packs = [], 0, []
    for it in ITEMS:
        pack = rag.retrieve(it["claim"], "verify_claim")
        calls += pack.llm_calls
        packs.append(pack)
        if it["gold"] is None:
            false_sufficient.append(pack.sufficient)     # said "evidence found" for a claim that is not on the resume
        else:
            hit[it["kind"]].append(any(it["gold"].lower() in s["text"].lower() for s in pack.spans[:k]))
    r = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
    return {
        "n": len(ITEMS), f"recall@{k}_lexical": r(hit["lexical"]), f"recall@{k}_paraphrase": r(hit["paraphrase"]),
        "false_sufficiency_unsupported": r(false_sufficient),
        "avg_llm_calls_per_claim": round(calls / len(ITEMS), 2),
        "modes": sorted({p.mode for p in packs}),
    }


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["static", "agentic"], default="static")
    a = ap.parse_args(argv)
    retriever = Retriever(RESUME, JD)
    if a.mode == "static":
        rag = StaticRAG(retriever)
    else:
        if not os.getenv("GROQ_API_KEY"):
            print("GROQ_API_KEY not set; agentic mode needs a live model.", file=sys.stderr)
            return 2
        rag = AgenticRAG(GroqChat(), retriever)
    print(json.dumps({"mode": a.mode, **evaluate(rag)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
