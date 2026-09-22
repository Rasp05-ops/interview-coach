"""Run simulated candidates against the interviewer and report invariants + behaviours.

  python -m service.eval.simulate --dry-run                # offline: scripted policy, checks the harness itself
  GROQ_API_KEY=... python -m service.eval.simulate --persona vague --runs 3     # live: real model, real behaviour

Live runs spend API tokens (several LLM calls per turn); start with one persona and one run.
`--dry-run` says nothing about how a real model behaves: it only proves the harness and guardrails work.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Callable, Optional

from ..agent.blackboard import Blackboard, Budget
from ..agent.interviewer import InterviewerAgent
from ..agent.llm import LLM, GroqChat, ScriptedLLM
from ..agent.retrieval import Retriever
from .checks import behaviours, invariants
from .personas import PERSONAS, Persona
from .policies import baseline_policy

DEFAULT_RESUME = """EXPERIENCE
Backend intern at Acme Corp. Built a Kafka ingestion pipeline that cut end-to-end latency by 40 percent.
Owned the on-call runbook for the payments service.

PROJECTS
EOT detection: logistic regression on prosody features for voice agent turn-taking.
Codebase onboarding assistant using LangGraph, FastAPI and pgvector.

SKILLS
Python, C++, PyTorch, SQL
"""
DEFAULT_JD = "Backend engineer: streaming data pipelines with Kafka and Python; own services in production."

LLMFactory = Callable[[Blackboard], LLM]   # given the session's blackboard, return the interviewer LLM


def run_session(make_llm: LLMFactory, persona: Persona, resume: str = DEFAULT_RESUME, jd: str = DEFAULT_JD,
                max_turns: int = 6, persona_llm: Optional[LLM] = None, evaluator_mode: str = "inline") -> dict:
    board = Blackboard(role="Backend Engineer", company="Acme",
                       budget=Budget(max_turns=max_turns, min_turns_before_wrap=min(3, max_turns)))
    llm = make_llm(board)
    agent = InterviewerAgent(llm, board, Retriever(resume, jd), evaluator_mode=evaluator_mode,
                             evaluator_llm=llm if evaluator_mode == "async" else None)
    action = agent.start()
    steps = 0
    while action["kind"] != "wrap_up" and steps < max_turns + 4:
        text, delivery = persona.respond(action["text"], persona_llm)
        action = agent.answer(text, delivery)
        steps += 1
    report = agent.report()
    agent.close()
    return {"persona": persona.name, "board": board, "report": report,
            "invariants": invariants(board), "behaviours": behaviours(board, persona.name),
            "events": len(board.events), "fallbacks": sum(e.kind == "fallback" for e in board.events),
            "llm_calls": getattr(llm, "calls", None) if isinstance(getattr(llm, "calls", None), int) else None}


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", choices=[*PERSONAS, "all"], default="all")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--dry-run", action="store_true", help="use the scripted (non-LLM) interviewer policy")
    ap.add_argument("--llm-candidate", action="store_true", help="role-play the candidate with the LLM too (more tokens)")
    ap.add_argument("--async-eval", action="store_true",
                    help="log evidence via a separate evaluator agent instead of inline (matches cli.py's fix; "
                         "use this if inline mode is hitting the step budget / falling back a lot)")
    ap.add_argument("--turns", type=int, default=6, help="max_turns per session (lower = fewer LLM calls = cheaper smoke test)")
    args = ap.parse_args(argv)
    mode = "async" if args.async_eval else "inline"

    if not args.dry_run and not os.getenv("GROQ_API_KEY"):
        print("GROQ_API_KEY not set. Use --dry-run for the offline harness check.", file=sys.stderr)
        return 2

    names = list(PERSONAS) if args.persona == "all" else [args.persona]
    results = []
    for name in names:
        for _ in range(args.runs):
            if args.dry_run:
                r = run_session(lambda board: ScriptedLLM(baseline_policy(board)), PERSONAS[name],
                                max_turns=args.turns, evaluator_mode=mode)
            else:
                shared = GroqChat()
                r = run_session(lambda board: shared, PERSONAS[name], persona_llm=shared if args.llm_candidate else None,
                                max_turns=args.turns, evaluator_mode=mode)
                r["llm_calls"] = shared.calls
            r.pop("board")
            results.append(r)
            print(json.dumps({k: r[k] for k in ("persona", "invariants", "behaviours", "fallbacks", "llm_calls")}))
    bad = [r["persona"] for r in results if not all(r["invariants"].values())]
    print(f"\n{len(results)} session(s); invariant violations: {bad or 'none'}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())