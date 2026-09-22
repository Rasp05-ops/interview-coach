"""Text-mode chat with the interviewer agent (no audio). Needs GROQ_API_KEY.

  python -m service.cli --resume resume.txt [--jd jd.txt] [--role "Backend Engineer"] [--company Acme] \
      [--turns 6] [--debug] [--async-eval]

Type your answer and press Enter. /quit ends early. --debug prints tool calls and the patience the
turn-taking engine would use for each question. --async-eval runs evidence-logging as a separate agent call
instead of relying on the interviewer to log it inline; use this if you see the interviewer re-asking about
things you already covered (it means it's not reliably logging evidence for itself in inline mode).
"""
from __future__ import annotations

import argparse
import json
import sys

from .agent.blackboard import Blackboard, Budget
from .agent.interviewer import InterviewerAgent
from .agent.llm import GroqChat
from .agent.retrieval import Retriever


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--resume", required=True)
    ap.add_argument("--jd", default=None)
    ap.add_argument("--role", default="Software Engineer")
    ap.add_argument("--company", default="")
    ap.add_argument("--turns", type=int, default=6)
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--async-eval", action="store_true", help="log evidence via a separate evaluator agent instead of inline")
    a = ap.parse_args(argv)

    resume = open(a.resume, encoding="utf-8").read()
    jd = open(a.jd, encoding="utf-8").read() if a.jd else ""
    board = Blackboard(role=a.role, company=a.company, budget=Budget(max_turns=a.turns))
    llm = GroqChat()
    agent = InterviewerAgent(llm, board, Retriever(resume, jd),
                             evaluator_mode="async" if a.async_eval else "inline",
                             evaluator_llm=llm if a.async_eval else None)

    def show(action):
        print(f"\nInterviewer: {action['text']}")
        if a.debug and action.get("patience"):
            p = action["patience"]
            print(f"   [intent={action.get('intent')} competency={action.get('competency')} "
                  f"structure={p['expected_structure']} patience={p['level']} max_hold={p['max_hold_s']}s]")

    action = agent.start()
    show(action)
    while action["kind"] != "wrap_up":
        try:
            text = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if text == "/quit":
            break
        if not text:
            continue
        action = agent.answer(text)
        show(action)
    rep = agent.finish()
    agent.close()
    print("\n── Report ──")
    print(json.dumps({k: rep[k] for k in ("overall_score_10", "gaps", "unscored")}, indent=2))
    for comp, s in rep["competencies"].items():
        print(f"  {comp}: {s['score_10']} ({s['n_evidence']} evidence)")
    return 0


if __name__ == "__main__":
    sys.exit(main())