# Interview Coach

AI mock interview platform built on Groq, a local ONNX turn-detection model, and Postgres (or SQLite for local dev). It has two interview experiences that share the same resume/JD grounding: a turn-based practice room, and a realtime voice agent with tool calling and agentic retrieval.

## Technology stack

| Layer | What |
|---|---|
| LLM | Groq (chat + tool calling) |
| STT | Groq Whisper |
| TTS | Browser `SpeechSynthesis` API |
| Turn detection (EOT) | Smart Turn v3 ONNX model, run locally on CPU |
| Frontend | Next.js 14 (App Router), Tailwind |
| Realtime agent service | FastAPI (Python), WebSocket |
| Auth | NextAuth with Google OAuth |
| Database | Postgres in production, SQLite for local dev |

## Features

### Interview modes
- **Turn-based practice room** (`/setup` -> `/interview/[id]`) — upload a resume and job description, answer questions by voice, get scored feedback per answer and a session summary at the end.
- **Realtime voice agent** (`/agent`) — a continuous spoken conversation with the FastAPI service. Audio streams to the backend over a WebSocket; the interviewer, evaluator, and turn-taking engine all run server-side and react to you as you speak.

### Agentic RAG (retrieval)
Two retrieval layers exist so they can be compared:
- **Static baseline** — a single query against a BM25 index over the resume and job description, no grading.
- **Agentic retriever** (`service/agent/agentic_rag.py`) — plans one or more search queries for what it needs to know, retrieves, grades whether the results actually answer the need, and rewrites and retries if not. A grader that cites spans it wasn't actually given is overruled, and a "sufficient" verdict with no citations is rejected. Every LLM step degrades to the static result on failure rather than raising.
- The two are ablatable against each other via `service/eval/rag_bench.py`.
- The turn-based practice room uses a lighter keyword-overlap retriever (`lib/rag/context.ts`) to build the resume/JD/company context injected into each question.

### Tool-calling interviewer
The realtime agent's interviewer and evaluator don't just generate free text — they call a typed set of tools (`service/agent/tools.py`), each with a pydantic-validated schema, sent to Groq as OpenAI-style function definitions:

- `search_resume`, `search_jd`, `search_bank`, `get_rubric`, `recall_sessions` — retrieval
- `add_claim`, `resolve_claim`, `check_consistency`, `log_evidence`, `verify_quote` — evidence tracking
- `update_plan`, `set_patience`, `ask`, `interject`, `wrap_up`, `retrieve_evidence`, `finish_assessment` — interview control

Guardrails live in the tool implementations, not the prompt: a quote can only be logged as evidence if it verifiably appears in the candidate's actual transcript (`quote_in_text`, with fuzzy matching for minor transcription noise); follow-up depth, question budget, session time, and duplicate questions are all enforced in code. A rejected tool call returns a structured error instead of throwing, so the model can recover mid-conversation.

### End-of-turn detection (EOT) and the agent -> EOT coupling
- Smart Turn v3 (ONNX, ~8 MB, CPU) listens to the raw waveform to decide whether you've actually finished speaking, rather than just detecting silence.
- The interviewer's `set_patience` tool ties how long the turn-taking engine should wait to the kind of answer a question invites — a "think aloud" system-design question gets more tolerance for mid-thought silence than a short factual one. This is read from a shared `Blackboard` object that every agent and tool reads and writes through typed methods.
- If the Smart Turn service is unreachable, both interview modes fall back to a manual stop button / energy-based heuristic rather than failing outright.

### Deterministic scoring
Scoring itself is plain code, not an LLM call (`service/agent/scoring.py`) — the model's job is to find and quote evidence and assign a rubric level; the arithmetic that turns an evidence ledger into a score and final report is reproducible and testable independent of the model.

### Cross-session memory
The realtime agent can persist notes about a candidate across sessions (`service/agent/memory.py`). The curator that writes these notes is deterministic — it turns an already-verified report into notes rather than letting an LLM decide unprompted what a candidate is bad at.

### Delivery and structure analysis
- STAR structure detection (Situation/Task/Action/Result) on behavioral answers.
- Filler word counting ("um", "uh", "you know", parenthetical "like"), with hedges ("kind of", "actually") reported separately.
- Words-per-minute, duration, and — when Whisper returns word timestamps — pause and articulation-rate metrics per answer.
- Score trend chart across sessions.

### Company research
Given an optional company URL, the app fetches and cleans the page (script/style stripped, size-capped) and folds it into the question-generation context. Requests are restricted to public http(s) URLs — no localhost, loopback, or private-network targets.

### Simulated-candidate evaluation harness
`service/eval/` runs the agent against scripted personas and policies (`personas.py`, `policies.py`, `simulate.py`) with automated checks (`checks.py`), so interviewer/evaluator behavior can be regression-tested without a human in the loop.

### Authentication and data isolation
Google sign-in via NextAuth gates every page and API route. Every session and turn is scoped to the signed-in user's id at the database query level, not just the UI — one account can never read or list another account's interview history.

## Quick start (local development)

### 1. Add your Groq API key
Create or sign in to a Groq account at **console.groq.com** and copy your API key.

### 2. Install
Prerequisites: Node 18+, Python 3.10+, and **ffmpeg** on your PATH (the Smart Turn bridge uses it to decode audio).
```bash
npm install
pip install -r service/requirements.txt
```

### 3. Download the Smart Turn model (~8 MB, one-time)
```bash
python3 python/download_model.py
```
If this step is skipped, both interview modes fall back to an energy-based heuristic instead of failing.

### 4. Configure environment variables
```bash
cp .env.local.example .env.local
```
At minimum, set `GROQ_API_KEY`. For Google sign-in, also set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXTAUTH_SECRET` (see Google Cloud Console -> APIs & Services -> Credentials). For the realtime agent locally, run `python -m uvicorn service.app:app --reload` alongside `npm run dev` and point `NEXT_PUBLIC_AGENT_WS_URL` / `NEXT_PUBLIC_EOT_WS_URL` at it.

### 5. Run
```bash
npm run dev
# -> http://localhost:3000
```

## Production deployment
The Next.js app deploys to Vercel; the FastAPI agent service deploys separately (for example, to Render) since it keeps interview sessions in memory and must run as a single instance. See the project's deployment notes for the full environment variable list and setup steps.

## Rate limits
Groq usage limits (requests, tokens, and audio seconds per minute/hour/day, per model) change over time and vary by account. Check **console.groq.com -> Settings -> Limits** for current numbers rather than relying on any figure written here. Browser TTS has no additional service billing. On a 429, wait for the reset.

## Structure
```
app/
  page.tsx                     Dashboard (score trend + session list)
  sign-in/page.tsx              Google sign-in
  setup/page.tsx                Setup form (role, company, resume, JD)
  interview/[id]/page.tsx       Turn-based practice room
  agent/page.tsx                Realtime voice agent UI
  review/[id]/page.tsx          Post-interview review + study plan
  api/
    auth/[...nextauth]          NextAuth handler
    session/create|list|get     Session CRUD, scoped to the signed-in user
    interview/start             Generate first question
    interview/answer            Transcribe + STAR + eval + next question
    interview/feedback          Session summary + study plan
    upload/resume|jd            PDF/DOCX text extraction
    agent/[...path]             Server-side proxy to the FastAPI agent service

components/
  interview/                    Turn-based practice room UI (mic, question card, feedback, TTS hook)
  dashboard/                    Session list, score trend chart, full review page
  providers/AuthProvider.tsx    NextAuth SessionProvider wrapper

lib/
  auth.ts                       NextAuth config (Google provider)
  ai/                           Groq client, question generation, STAR/eval, transcription
  rag/context.ts                Keyword-overlap retrieval for the practice room
  audio/eot.ts                  Smart Turn subprocess bridge
  db/index.ts                   Postgres/SQLite schema + typed, user-scoped queries

service/                        FastAPI realtime agent
  app.py                        HTTP + WebSocket endpoints
  agent/
    loop.py                     Tool-calling loop
    tools.py                    Typed tool layer + guardrails
    agentic_rag.py               Plan -> retrieve -> grade -> retry retrieval
    retrieval.py                 BM25 index, section-aware chunking
    blackboard.py                Shared session state, patience/EOT coupling
    interviewer.py, evaluator.py Interviewer and (parallel) answer evaluator agents
    scoring.py                   Deterministic scoring from the evidence ledger
    memory.py                    Cross-session candidate memory
  eval/                          Simulated-persona regression harness

python/
  eot_detect.py                 Smart Turn ONNX CLI
  download_model.py             HuggingFace model downloader
```
