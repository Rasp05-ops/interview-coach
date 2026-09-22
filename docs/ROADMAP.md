# Roadmap and status

Goal: turn the mock-interview app into an **interview agent** with interview-aware turn-taking, and back every
claim with a measurement. This file is the source of truth for what exists, what is verified, and what is next.

## Status

| # | Item | State | Verified how |
|---|------|-------|--------------|
| 0 | Fixes to the original app (duration fallback, no answer truncation, filler false-positives, turn ownership, honest copy) | Done | 18 vitest tests (incl. PDF/DOCX extraction fixtures), `tsc`, `next build` |
| 1 | Blackboard, typed tools, bounded interviewer loop, deterministic fallback (`service/agent`) | Done | pytest incl. mutation checks on each guardrail |
| 2 | Static retrieval baseline: section-aware chunking + BM25, rubrics, question bank | Done | pytest; baseline numbers below |
| 3 | Agentic RAG loop (planner, router, grader, bounded retry, fast path) | Built, **not measured live** | pytest with scripted LLM; live run: `python -m service.eval.rag_bench --mode agentic` |
| 4 | Async Evaluator (separate agent, pinned to one turn, runs off the critical path) | Built, **not run with a real model** | pytest incl. threaded tests repeated 15x, mutation check |
| 5 | Cross-session memory: JSON store + deterministic curator; weak spots feed the next plan | Done | pytest |
| 6 | Turn-taking engine: VAD, causal prosody, structure tracker, fusion model, patience-aware policy | Built; tested on **synthetic signals only** | pytest |
| 7 | Realtime WebSocket gateway: audio -> engine -> agent -> next question -> new patience | Built | pytest (TestClient) + a real WebSocket against uvicorn with the dry-run interviewer |
| 8 | Turn-taking dataset builder + benchmark (timeout baselines, leave-speakers-out CV, speaker-cluster bootstrap) | Harness built; **no real data, no real results** | pytest; synthetic run is a plumbing check only |
| 9 | Text-mode UI (`/agent`) + Next proxy to the service | Done | `next build`; Next -> FastAPI round trip in dry-run mode |
| 10 | Browser voice client: AudioWorklet PCM16 streaming + server-side rolling Whisper | Built, **live STT not measured** | `next build`, Vitest, pytest; requires `GROQ_API_KEY` for live transcription |

## Resume upload

PDF, DOCX and TXT are accepted (original setup page and `/agent`). The old PDF parser (`pdf-parse` 1.1.4) failed on 2 of
3 PDFs from different generators with "bad XRef entry"; it was replaced with `unpdf`, and regression fixtures from
three generators plus a DOCX are in `tests/fixtures/`. Limits: image-only/scanned PDFs have no text layer and are
rejected (no OCR); heavily designed multi-column or table layouts can come out in a scrambled order, so check the
extracted text (it is shown in an editable box on `/agent`). Uploaded text, including contact details, is sent to the
model provider; remove personal details first if that matters to you.

## Measured so far

Static BM25 retriever on the synthetic claim set (`service/eval/rag_bench.py`: one fictional resume, 22 claims that
**I wrote**, 8 lexical / 8 paraphrase / 6 unsupported; the paraphrases were written to avoid word overlap, so the low
paraphrase number is partly by construction):

| metric | value |
|---|---|
| recall@3, lexical claims | 1.00 |
| recall@3, paraphrased claims | 0.375 |
| "sufficient" on claims that are NOT on the resume (false sufficiency) | 0.333 |

The agentic loop's numbers on the same set need a live model.

## What is and isn't proven

* Guardrails (probe limit, budgets, quote verification, patience-from-structure, bounded loops, hallucinated-id
  filtering in RAG, evaluator turn pinning, speaker-leakage audit in CV) are enforced in code and tested; removing
  each one makes a test fail.
* **Not yet observed:** how a real model (Groq / Llama) behaves in the interviewer, evaluator or RAG loops -
  tool-calling quality, latency and token use are all unmeasured. `GroqChat` has never run against the live API here.
* **Turn-taking has no empirical result.** The engine runs on synthetic tones; prosody feature signs are checked on
  known glides, not on speech. `HeuristicPrior` weights are hand-set, not fitted. The synthetic benchmark's numbers
  are meaningless as evidence (its generator makes the features predictive by construction).
* The Smart Turn adapter (`service/turn/smart_turn.py`) is untested: the model host was unreachable from the build
  sandbox. `lengthening_proxy` is an unvalidated experimental feature and is not used by the prior.
* The Whisper disfluency prompt and word-timestamp request in `lib/ai/transcribe.ts` are untested against live
  Groq; the code falls back to the previous plain-text call on any error.

## Not built

* A local faster-whisper option for offline/server-side speech-to-text.
* Silero VAD (the energy VAD is a dependency-free default that is fragile under noise).
* The consented dataset, a trained fusion model, and the ablations (agentic vs static retrieval, agent-set vs fixed
  patience, async vs inline evaluation) - all need real recordings or a live model.
* An LLM-based Coach; the curator is deterministic on purpose.

## Design decisions

* The agent decides *what to say*; code decides *what is allowed*. Scores are computed from a quote-verified
  evidence ledger (`service/agent/scoring.py`), never by asking a model for a number.
* Every `ask` declares `expected_structure`; that sets the patience the turn-taking engine reads. This coupling is the
  hypothesis the benchmark will test.
* Retrieval and evaluation each have a simple baseline behind the same interface so the agentic version can be
  ablated against it.
  ## Known issue found in a live run, and the fix

A live CLI session (real Groq, `openai/gpt-oss-120b`) showed the interviewer:
1. **Not probing a vague answer** ("we had some disagreements... it worked out fine overall") - it moved
   straight to a new topic instead of following the system prompt's probe rule.
2. **Re-asking about a topic already covered** (the Redis caching project came up twice), suggesting it
   also skipped calling `log_evidence` on an earlier turn, so the plan's coverage looked emptier than it was.

Root cause (plausible, not proven): inline mode asks the model to log evidence AND decide the next move in
one turn; a reasoning model appears to sometimes skip the "bookkeeping" step under multi-step instructions.

Fixes shipped:
- `service/agent/heuristics.py`: a deterministic, code-computed vagueness signal (short answer / no numbers /
  generic filler phrases) injected into the prompt as an explicit `SIGNAL:` line, so the model doesn't have
  to notice vagueness unaided. Verified against the actual vague answer from that session.
- System prompt (`interviewer.py`): the "next move" rules are now an explicit, ordered checklist with
  imperative language ("check these IN ORDER... do not skip ahead"), probing placed before covering a new
  competency.
- `--async-eval` flag on the CLI (also available via the API's `evaluator_mode: "async"`): runs evidence
  logging as a separate agent call per turn, so it can't be skipped by the interviewer being busy deciding
  what to ask next.
- Tests: `test_heuristics.py` (incl. the exact failing case from the live session and a bug the new tests
  caught - a short-but-specific numeric answer was initially miscategorized as vague), and two tests in
  `test_interviewer.py` proving the `SIGNAL:` line does/doesn't appear in the model's prompt as expected.

**Not yet confirmed:** whether this actually changes `gpt-oss-120b`'s behavior live - the signal reaching the
prompt is verified; the model acting on it reliably is not. Needs a repeat of the original session
(`python -m service.cli --resume resume.txt --jd jd.txt --debug --async-eval`) to check.

## Next

1. Live smoke tests with a key: `python -m service.cli --resume r.txt --debug`, `python -m service.eval.simulate
   --persona vague`, `python -m service.eval.rag_bench --mode agentic`. Record latency / tokens / results here.
2. Record consented answers (>= 2 s trailing silence), build pauses with `service/turn/dataset.py`, run
   `python -m service.turn.benchmark --data pauses.jsonl`.
3. Measure the live browser voice path with a key, then retire the legacy record-then-upload flow.
