# Interview agent service

```bash
pip install -r service/requirements.txt
python -m pytest                                    # 94 tests, no network needed

# Try it without an API key (scripted stand-in for the model; NOT a real interviewer)
AGENT_DRY_RUN=1 uvicorn service.app:app --port 8001
npm run build && npm start                          # then open http://localhost:3000/agent
python -m service.eval.simulate --dry-run

# Live (spends API tokens)
export GROQ_API_KEY=gsk_...
python -m service.cli --resume resume.txt --jd jd.txt --debug
python -m service.eval.simulate --persona vague --runs 1
python -m service.eval.rag_bench --mode static      # baseline; --mode agentic needs the key
uvicorn service.app:app --port 8001

# Turn-taking benchmark
python -m service.turn.benchmark --synthetic        # plumbing check ONLY
python -m service.turn.benchmark --data pauses.jsonl
```

`POST /sessions` accepts `evaluator_mode` (`inline` | `async`), `agentic_rag` (bool) and `candidate_id`
(enables cross-session memory, stored under `AGENT_MEMORY_DIR`). `WS /ws/{session_id}` is the realtime gateway
(binary 16 kHz mono PCM16 in; JSON events out). With `GROQ_API_KEY`, the gateway performs rolling and final Whisper
transcription; clients may still send `{"type":"transcript","text":...}` as an STT override or use `{"type":"end"}`
to submit immediately.

Layout
- `agent/` blackboard, typed tools + guardrails, interviewer loop, evaluator, agentic RAG, retrieval, memory, scoring
- `turn/` VAD, prosody, structure tracker, fusion model, policy, streaming engine, dataset, benchmark, Smart Turn adapter
- `eval/` personas, behavioural checks, simulation harness, retrieval benchmark
- `app.py` HTTP + WebSocket, `gateway.py` audio-to-agent loop, `cli.py` text chat

See `docs/ROADMAP.md` for what is verified and what is not.
