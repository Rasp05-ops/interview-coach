# Interview Coach — AI Mock Interviews

AI-powered mock interview platform built with Groq, local models, and SQLite.

## Technology stack

| Layer | What | Cost |
|---|---|---|
| LLM | Groq `llama-3.3-70b-versatile` | Usage-based plan |
| STT | Groq `whisper-large-v3-turbo` | Usage-based plan |
| TTS | Browser `SpeechSynthesis` API | Offline, no extra setup |
| EOT | Smart Turn v3 ONNX (local) | Runs on CPU |
| DB | SQLite (`better-sqlite3`) | Zero config |

## Features

- 🎙️ **Realtime voice agent** — `/agent` streams microphone PCM through an AudioWorklet to the turn-taking gateway; server-side Whisper supplies rolling and final transcripts when `GROQ_API_KEY` is configured.
- 🧠 **Adaptive questioning** — Llama 3.3 70B adjusts difficulty based on your running score
- 📄 **Resume + JD grounding** (PDF, DOCX or TXT upload) — resume and JD are chunked and matched to each question by keyword overlap (no embeddings yet)
- ⭐ **STAR structure scoring** — automatic Situation/Task/Action/Result detection on behavioral answers
- 📊 **Score trend chart** — line chart of your scores across sessions
- 📋 **Filler word detection** — counts "um", "uh", "you know", parenthetical "like"; hedges ("kind of", "actually") are reported separately
- 📈 **Delivery metrics** — WPM, duration, and (when Whisper returns word timestamps) pauses and articulation rate per answer
- 🗂️ **Session history** — all past sessions with full per-question breakdowns

## Quick start

### 1. Add your Groq API key
Create or sign in to your Groq account at **https://console.groq.com** and copy your API key.

### 2. Install
**Prerequisites:** Node 18+, Python 3.10+, and **ffmpeg** on your PATH (the Smart Turn bridge uses it to decode audio).
```bash
npm install
pip install -r python/requirements.txt   # onnxruntime, transformers, soundfile
```

### 3. Download Smart Turn model (~8 MB, one-time)
```bash
python3 python/download_model.py
```
The app falls back to an energy-heuristic if this step is skipped. If the Python bridge fails entirely, audio duration falls back to the browser-measured value.

### 4. Configure
```bash
cp .env.local.example .env.local
# add your key:  GROQ_API_KEY=gsk_...
```

### 5. Run
```bash
npm run dev
# → http://localhost:3000
```

## Rate limits
Groq usage limits (requests, tokens and audio seconds per minute/hour/day, per model) change over time and vary by model. Check **console.groq.com → Settings → Limits** for your account's real numbers rather than relying on figures in this README. Browser TTS is available without any additional service billing. On a 429, wait for the reset.

## Structure
```
app/
  page.tsx                   Dashboard (score trend + session list)
  setup/page.tsx             Setup form (role, company, resume, JD)
  interview/[id]/page.tsx    Live interview session
  review/[id]/page.tsx       Post-interview review + study plan
  api/
    session/create|list|get  Session CRUD
    interview/start          Generate first question
    interview/answer         Transcribe + STAR + eval + next question
    interview/feedback       Session summary + study plan
    upload/resume|jd         PDF/DOCX text extraction

components/
  interview/
    InterviewSession.tsx     Main loop state machine
    VoiceRecorder.tsx        Mic + live volume bars
    QuestionCard.tsx         Typewriter effect + progress
    AnswerFeedback.tsx       Score, delivery, STAR, improvements
    STARBreakdown.tsx        S/T/A/R grid
    useBrowserTTS.ts         Web Speech API hook (free TTS)
    SetupForm.tsx            Resume + JD upload/paste
  dashboard/
    Dashboard.tsx            Session list + score trend
    ReviewPage.tsx           Full review with accordion
    ScoreTrendChart.tsx      Recharts line chart

lib/
  ai/client.ts               Groq lazy singleton + model constants
  ai/interviewer.ts          Question gen, STAR, eval, summary
  ai/transcribe.ts           Groq Whisper + filler detection
  ai/extract.ts              PDF/DOCX extraction
  rag/context.ts             keyword-overlap retrieval + context builder
  audio/eot.ts               Smart Turn subprocess bridge
  db/index.ts                SQLite schema + typed queries

python/
  eot_detect.py              Smart Turn ONNX CLI
  download_model.py          HuggingFace model downloader
  requirements.txt
```

## Agent service

The Python service provides the realtime `/agent` flow and a standalone `/ws/eot` Smart Turn endpoint used by the main interview recorder. The browser streams 16 kHz PCM while recording; Smart Turn emits an end decision and the existing manual stop remains available as a fallback.

## Production deployment

### Vercel frontend

1. Import this repository into Vercel with the Next.js framework.
2. Add `GROQ_API_KEY` as an encrypted environment variable for Production, Preview, and Development.
3. Add `AGENT_SERVICE_URL` with the public Railway HTTPS URL, for example `https://your-agent.up.railway.app`.
4. Add `NEXT_PUBLIC_AGENT_WS_URL` with the Railway WebSocket URL, for example `wss://your-agent.up.railway.app`.
5. Deploy and verify the health of the `/agent` flow.

### Railway backend

1. Create a Railway service from the same repository.
2. Railway will use `requirements.txt` and `railway.toml` at the repository root.
3. Add `GROQ_API_KEY` to the Railway service variables.
4. Deploy and confirm `https://your-agent.up.railway.app/health` returns `{\"ok\":true,...}`.

The Render equivalent uses `render.yaml` and downloads the Smart Turn CPU model during its build. Set `NEXT_PUBLIC_EOT_WS_URL` to `wss://your-render-service.onrender.com/ws/eot` on Vercel when the backend is deployed on Render.

The Railway service is stateful in memory and its optional candidate memory is written to local disk. Use one running replica for this service; multiple replicas require shared session storage. The main Next.js interview flow uses SQLite, which is not durable on Vercel serverless deployments. Use a persistent database such as Railway Postgres or another hosted SQLite-compatible database before relying on session history in production.
