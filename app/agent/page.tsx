"use client";
import { useEffect, useRef, useState } from "react";

type Action = { kind: string; text: string; intent?: string; competency?: string; patience?: { level: string; max_hold_s: number; expected_structure: string } };
type Msg = { who: "agent" | "you"; text: string; meta?: string };

const api = async (path: string, body?: unknown) => {
  const res = await fetch(`/api/agent/${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Text-mode client for the agent service (no audio yet). Shows the intent and the patience the
// turn-taking engine would use for each question, so the agent -> turn-taking coupling is visible.
export default function AgentPage() {
  const [resume, setResume] = useState("");
  const [jd, setJd] = useState("");
  const [role, setRole] = useState("Software Engineer");
  const [company, setCompany] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [mode, setMode] = useState<"inline" | "async">("inline");
  const [agenticRag, setAgenticRag] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [err, setErr] = useState("");
  const [socketReady, setSocketReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [fileNote, setFileNote] = useState<{ resume?: string; jd?: string }>({});
  const endRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<{ context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; node: AudioWorkletNode } | null>(null);

  const push = (a: Action) => setMsgs(m => [...m, {
    who: "agent", text: a.text,
    meta: a.patience ? `${a.intent ?? a.kind} · ${a.competency ?? "-"} · ${a.patience.expected_structure} · patience ${a.patience.level} (${a.patience.max_hold_s}s)` : a.intent,
  }]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50); }
  };

  // Reuses the original app's extractors (PDF / DOCX / TXT). The text stays editable so extraction errors can be fixed.
  const upload = async (file: File | undefined, kind: "resume" | "jd") => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setErr("File is too large. Please upload a file smaller than 10 MB.");
      return;
    }
    setErr("");
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`/api/upload/${kind}`, { method: "POST", body: form });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      (kind === "resume" ? setResume : setJd)(j.text);
      setFileNote(n => ({ ...n, [kind]: `${file.name} · ${j.chars} characters extracted` }));
    } catch (e) { setErr(`Could not read ${file.name}: ${(e as Error).message}. Scanned/image-only PDFs have no text; paste the text instead.`); }
  };

  const start = () => guard(async () => {
    let companyContext = "";
    if (companyUrl.trim()) {
      const research = await fetch("/api/company/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: companyUrl.trim() }) });
      const researchResult = await research.json();
      if (!research.ok) throw new Error(researchResult.error || "Could not research company website.");
      companyContext = researchResult.context;
    }
    const r = await api("sessions", { role, company, company_context: companyContext, resume_text: resume, jd_text: jd, evaluator_mode: mode, agentic_rag: agenticRag });
    setSid(r.session_id); setMsgs([]); push(r.action); setDone(r.done);
    await connectRealtime(r.session_id);
  });

  const connectRealtime = (sessionId: string) => new Promise<void>((resolve, reject) => {
    const configured = process.env.NEXT_PUBLIC_AGENT_WS_URL;
    const base = configured || `ws://${window.location.hostname}:8001`;
    const ws = new WebSocket(`${base.replace(/\/$/, "")}/ws/${sessionId}`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => { wsRef.current = ws; setSocketReady(true); resolve(); };
    ws.onerror = () => reject(new Error("Realtime audio service is unavailable"));
    ws.onclose = () => { setSocketReady(false); setListening(false); };
    ws.onmessage = event => {
      const message = JSON.parse(event.data) as { type: string; text?: string; final?: boolean; action?: Action; done?: boolean; error?: string };
      if (message.type === "transcript") setInterim(message.text || "");
      if (message.type === "stt_error") setErr(`Speech recognition: ${message.error || "unavailable"}. You can type your answer below.`);
      if (message.type === "action" && message.action) {
        push(message.action); setInterim(""); setDone(Boolean(message.done));
        if (message.done) void loadReport(sessionId);
      }
      if (message.type === "done") stopCapture();
    };
  });

  const loadReport = async (sessionId: string) => {
    const response = await fetch(`/api/agent/sessions/${sessionId}/report`);
    if (response.ok) setReport(await response.json());
  };

  const startCapture = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || listening) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const context = new AudioContext();
      await context.audioWorklet.addModule("/audio-stream-processor.js");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "audio-stream-processor");
      node.port.onmessage = event => {
        if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(event.data);
      };
      source.connect(node);
      node.connect(context.destination);
      await context.resume();
      audioRef.current = { context, stream, source, node };
      setListening(true); setErr("");
    } catch (error) {
      setErr(`Microphone error: ${(error as Error).message}`);
    }
  };

  const stopCapture = (submit = false) => {
    if (submit && wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: "end" }));
    const audio = audioRef.current;
    if (!audio) return;
    audio.node.disconnect(); audio.source.disconnect(); audio.stream.getTracks().forEach(track => track.stop());
    void audio.context.close(); audioRef.current = null; setListening(false);
  };

  useEffect(() => () => {
    stopCapture(); wsRef.current?.close();
  }, []);

  const send = () => guard(async () => {
    const text = draft.trim(); if (!text || !sid) return;
    setDraft(""); setMsgs(m => [...m, { who: "you", text }]);
    const r = await api(`sessions/${sid}/answer`, { answer: text });
    push(r.action); setDone(r.done);
    if (r.done) setReport(await (await fetch(`/api/agent/sessions/${sid}/report`)).json());
  });

  if (!sid) return (
    <main className="max-w-6xl mx-auto pb-12">
      <header className="flex items-center justify-between mb-12">
        <a href="/" className="flex items-center gap-3"><span className="grid place-items-center w-10 h-10 rounded-2xl bg-forest text-white">✦</span><span><span className="block text-sm font-bold text-forest">INTERVIEW</span><span className="block text-xs tracking-[0.2em] text-muted">STUDIO</span></span></a>
        <span className="text-xs uppercase tracking-[0.18em] text-muted">Session setup · 01</span>
      </header>
      <div className="grid lg:grid-cols-[.8fr_1.2fr] gap-8 items-start">
        <section className="pt-3 lg:sticky lg:top-8">
          <div className="text-xs uppercase tracking-[0.2em] text-accent mb-5">Build your room</div>
          <h1 className="display-face text-5xl sm:text-6xl leading-[.98] text-forest">Bring your<br /><em className="text-accent not-italic">best story.</em></h1>
          <p className="text-muted leading-7 mt-6 max-w-sm">Give the coach enough context to ask sharper questions. Your resume stays editable after extraction, so you stay in control.</p>
          <div className="mt-10 grid grid-cols-2 gap-3 max-w-sm"><div className="bg-forest-dim rounded-2xl p-4"><div className="text-2xl text-forest">01</div><div className="text-xs text-muted mt-2">Grounded in your experience</div></div><div className="bg-accent-dim rounded-2xl p-4"><div className="text-2xl text-accent">02</div><div className="text-xs text-muted mt-2">Adaptive question pacing</div></div></div>
        </section>
        <section className="bg-white border border-border rounded-[28px] p-5 sm:p-8 shadow-[0_20px_60px_rgba(33,76,58,0.08)]">
          <div className="flex items-start justify-between gap-4 mb-7"><div><div className="text-xs uppercase tracking-[0.16em] text-muted mb-2">Interview brief</div><h2 className="display-face text-3xl text-forest">Set the context</h2></div><span className="text-xs px-3 py-1.5 rounded-full bg-forest-dim text-success">Practice session</span></div>
          <div className="grid sm:grid-cols-2 gap-4 mb-6"><label className="block"><span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Role *</span><input className="mt-2 w-full bg-[#f7f9f6] border border-border rounded-xl px-4 py-3 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" value={role} onChange={e => setRole(e.target.value)} placeholder="Software Engineer" /></label><label className="block"><span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Company</span><input className="mt-2 w-full bg-[#f7f9f6] border border-border rounded-xl px-4 py-3 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" value={company} onChange={e => setCompany(e.target.value)} placeholder="Company name" /></label></div>
          <label className="block mb-6"><span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Company website <span className="font-normal text-dim">(optional)</span></span><input className="mt-2 w-full bg-[#f7f9f6] border border-border rounded-xl px-4 py-3 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" value={companyUrl} onChange={e => setCompanyUrl(e.target.value)} placeholder="https://company.com" /></label>
          <div className="space-y-5">
            <div><div className="flex items-center justify-between mb-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Resume</span><span className="text-xs text-dim">PDF · DOCX · TXT</span></div><label className={`block border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-colors ${resume ? "border-success/40 bg-success-dim/40" : "border-border hover:border-accent/50 bg-[#fbfcfa]"}`}><input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={e => upload(e.target.files?.[0], "resume")} />{fileNote.resume ? <span className="text-sm text-success">✓ {fileNote.resume}</span> : <span className="text-sm text-muted">Drop your resume here or browse files</span>}</label><textarea className="mt-3 w-full h-32 bg-[#f7f9f6] border border-border rounded-xl p-3 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" value={resume} onChange={e => setResume(e.target.value)} placeholder="Your extracted resume text will appear here…" /></div>
            <div><div className="flex items-center justify-between mb-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Job description</span><span className="text-xs text-dim">Optional, but useful</span></div><label className="block border border-border rounded-2xl px-4 py-3 cursor-pointer hover:border-accent/50 bg-[#fbfcfa]"><input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={e => upload(e.target.files?.[0], "jd")} /><span className="text-sm text-muted">{fileNote.jd || "Attach a JD or paste it below"}</span></label><textarea className="mt-3 w-full h-24 bg-[#f7f9f6] border border-border rounded-xl p-3 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" value={jd} onChange={e => setJd(e.target.value)} placeholder="What does this role need?" /></div>
          </div>
          <div className="flex flex-wrap gap-4 items-center mt-6 pt-5 border-t border-border text-sm text-muted"><label className="flex items-center gap-2">Evaluation <select className="bg-[#f7f9f6] border border-border rounded-lg px-2 py-1.5 text-xs" value={mode} onChange={e => setMode(e.target.value as any)}><option value="inline">Inline</option><option value="async">Async</option></select></label><label className="flex items-center gap-2"><input className="accent-accent" type="checkbox" checked={agenticRag} onChange={e => setAgenticRag(e.target.checked)} /> Adaptive retrieval</label></div>
          {err && <p className="text-sm text-danger bg-danger-dim border border-danger/20 rounded-xl px-3 py-2 mt-5">{err}</p>}
          <button disabled={busy || resume.trim().length < 20} onClick={start} className="w-full mt-6 px-5 py-3.5 rounded-xl bg-forest text-white text-sm font-bold hover:bg-forest/90 disabled:opacity-40 transition-colors">{busy ? "Preparing your room…" : "Enter interview room  →"}</button>
        </section>
      </div>
    </main>
  );

  return (
    <main className="max-w-5xl mx-auto pb-12">
      <header className="flex items-center justify-between mb-8"><a href="/" className="flex items-center gap-3"><span className="grid place-items-center w-9 h-9 rounded-xl bg-forest text-white">✦</span><span className="text-sm font-bold tracking-tight text-forest">INTERVIEW STUDIO</span></a><span className="flex items-center gap-2 text-xs text-muted"><span className={`w-2 h-2 rounded-full ${socketReady ? "bg-success" : "bg-warning"}`} />{socketReady ? "Room connected" : "Connecting"}</span></header>
      <div className="grid lg:grid-cols-[1fr_280px] gap-5 items-start">
      <section>
      <div className="flex items-end justify-between mb-5"><div><div className="text-xs uppercase tracking-[0.18em] text-accent mb-2">Live coaching room</div><h1 className="display-face text-4xl text-forest">Your interview, in motion.</h1></div><span className="text-xs text-muted">{msgs.filter(m => m.who === "agent").length} prompts</span></div>
      {msgs.map((m, i) => (
        <div key={i} className={`rounded-[22px] p-5 text-sm border mb-3 shadow-[0_10px_30px_rgba(33,76,58,0.05)] ${m.who === "agent" ? "bg-white border-border" : "bg-[#f7dfd1] border-[#efc6b4] ml-8"}`}>
          {m.meta && <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-3">{m.meta}</div>}
          <div className="text-ink whitespace-pre-wrap">{m.text}</div>
        </div>
      ))}
      {err && <p className="text-sm text-danger bg-danger-dim border border-danger/20 rounded-xl px-3 py-2 mb-3">{err}</p>}
      <section className="rounded-[22px] border border-border bg-forest p-5 space-y-4 shadow-[0_18px_45px_rgba(33,76,58,0.16)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-white font-semibold">Speak your answer</p>
            <p className="text-xs text-[#b9d7c5] mt-1">{socketReady ? "Your room is listening for a clear ending." : "Connecting to the realtime engine…"}</p>
          </div>
          <button onClick={listening ? () => stopCapture(true) : startCapture} disabled={!socketReady || busy || done} className={`px-4 py-2.5 rounded-xl text-sm text-white font-bold disabled:opacity-40 ${listening ? "bg-danger recording-pulse" : "bg-accent"}`}>
            {listening ? "Finish answer" : "Start mic"}
          </button>
        </div>
        {interim && <p className="text-sm text-[#e9f4ed] border-t border-[#47705a] pt-3">{interim}</p>}
      </section>
      {!done ? (
        <div className="flex gap-2 mt-3">
          <textarea className="flex-1 bg-white border border-border rounded-xl p-3 text-sm h-20 focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Or type your answer here…" />
          <button disabled={busy || !draft.trim()} onClick={send} className="px-5 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-40">{busy ? "…" : "Send"}</button>
        </div>
      ) : report && (
        <div className="rounded-[22px] border border-border bg-white p-5 text-sm space-y-2 mt-3">
          <div className="text-ink font-medium">Overall {report.overall_score_10 ?? "n/a"} / 10 · gaps: {report.gaps.join(", ") || "none"}</div>
          {Object.entries(report.competencies).map(([k, v]: any) => <div key={k} className="text-muted">{k}: {v.score_10 ?? "no evidence"} ({v.n_evidence} evidence)</div>)}
        </div>
      )}
      <div ref={endRef} />
      </section>
      <aside className="space-y-3 lg:sticky lg:top-6"><div className="rounded-[22px] bg-white border border-border p-5"><div className="text-xs uppercase tracking-[0.16em] text-muted mb-4">Room notes</div><div className="space-y-4 text-sm"><div><div className="text-forest font-semibold">Be specific</div><p className="text-xs text-muted mt-1 leading-5">Use a concrete moment, decision, and result.</p></div><div><div className="text-forest font-semibold">Take your time</div><p className="text-xs text-muted mt-1 leading-5">The room adapts its patience to your answer.</p></div><div><div className="text-forest font-semibold">Stay grounded</div><p className="text-xs text-muted mt-1 leading-5">Questions are drawn from your background.</p></div></div></div><div className="rounded-[22px] bg-[#f7dfd1] p-5"><div className="text-xs uppercase tracking-[0.16em] text-[#8a5341] mb-2">Signal</div><div className="display-face text-xl text-forest">Clarity over polish.</div></div></aside>
      </div>
    </main>
  );
}
