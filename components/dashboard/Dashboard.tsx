"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Button, ScoreBadge, Spinner } from "@/components/ui";
import ScoreTrendChart from "./ScoreTrendChart";

interface Session {
  id: string; created_at: string; role: string; company: string;
  status: string; total_score: number | null; duration_s: number; turn_count: number;
}

function ago(d: string) {
  const s = (Date.now() - new Date(d + "Z").getTime()) / 1000;
  if (s < 120) return "just now";
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

export default function Dashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/session/list").then(r => r.json())
      .then(d => { setSessions(d.sessions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const completed = sessions.filter(s => s.status === "completed" && s.total_score != null);
  const avg = completed.length ? completed.reduce((s, c) => s + c.total_score!, 0) / completed.length : null;

  const trendData = completed.slice().reverse().map((s, i) => ({
    label: `#${i + 1}`,
    score: s.total_score!,
    role: s.role,
  }));

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <header className="flex items-center justify-between gap-4 mb-10">
        <button onClick={() => router.push("/")} className="flex items-center gap-3 text-left">
          <span className="grid place-items-center w-10 h-10 rounded-2xl bg-forest text-white text-lg shadow-lg shadow-forest/15">✦</span>
          <span><span className="block text-sm font-bold tracking-tight text-forest">INTERVIEW</span><span className="block text-xs tracking-[0.2em] text-muted">STUDIO</span></span>
        </button>
        <Button onClick={() => router.push("/setup")}><span className="text-lg leading-none">+</span> New session</Button>
      </header>

      <section className="grid lg:grid-cols-[1.25fr_.75fr] gap-5 mb-7">
        <div className="relative overflow-hidden rounded-[28px] bg-forest px-7 py-8 sm:px-10 sm:py-11 text-white studio-grid">
          <div className="relative z-10 max-w-xl">
            <div className="text-xs uppercase tracking-[0.2em] text-[#b9d7c5] mb-4">Your practice room</div>
            <h1 className="display-face text-4xl sm:text-5xl leading-[1.02] mb-4">Make your next answer<br /><em className="text-[#f6ad8f] not-italic">impossible to forget.</em></h1>
            <p className="text-sm leading-6 text-[#d5e6db] max-w-md">A grounded mock interview that listens for clarity, structure, and the details that make your experience yours.</p>
          </div>
          <div className="absolute -right-12 -bottom-20 w-64 h-64 rounded-full border border-[#b9d7c5]/20" /><div className="absolute right-12 -bottom-8 w-36 h-36 rounded-full border border-[#f6ad8f]/30" />
        </div>
        <div className="rounded-[28px] bg-[#f7dfd1] px-7 py-8 flex flex-col justify-between min-h-[220px]">
          <div className="flex items-start justify-between"><span className="text-xs uppercase tracking-[0.18em] text-[#8a5341]">Ready when you are</span><span className="w-3 h-3 rounded-full bg-[#e05b3f] breathe" /></div>
          <div><div className="display-face text-3xl text-forest">Practice with purpose.</div><p className="text-sm text-[#765c51] mt-2">Resume-aware. Adaptive. Measured.</p></div>
        </div>
      </section>

      {/* Stats */}
      {completed.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Sessions", value: sessions.length.toString() },
            { label: "Avg Score", value: avg ? `${avg.toFixed(1)}/10` : "—", color: avg ? (avg >= 7 ? "text-success" : avg >= 5 ? "text-warning" : "text-danger") : "" },
            { label: "Completed", value: completed.length.toString() },
          ].map(s => (
            <Card key={s.label} className="text-left py-4">
              <div className={`text-xl font-bold ${(s as any).color || ""}`}>{s.value}</div>
              <div className="text-xs text-muted mt-0.5">{s.label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Score trend */}
      {completed.length >= 2 && (
        <Card>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Score Trend</div>
          <ScoreTrendChart data={trendData} />
        </Card>
      )}

      {/* Sessions */}
      <div className="mt-8">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="text-xs font-semibold text-muted uppercase tracking-[0.16em] mb-1">
          {sessions.length === 0 ? "No sessions yet" : "Sessions"}
            </div><h2 className="display-face text-2xl text-forest">Your recent practice</h2>
          </div>
          {sessions.length > 0 && <span className="text-xs text-muted">Click a session to review</span>}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size={32} /></div>
        ) : sessions.length === 0 ? (
          <Card className="text-center py-12">
            <div className="text-4xl mb-4">🎙️</div>
            <p className="text-ink font-medium mb-1">No interviews yet</p>
            <p className="text-muted text-sm mb-5">Start practising with a focused mock interview.</p>
            <Button onClick={() => router.push("/setup")}>Start Your First Interview →</Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {sessions.map(s => (
              <Card key={s.id}
                onClick={() => s.status === "completed" ? router.push(`/review/${s.id}`) : router.push(`/interview/${s.id}`)}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-semibold text-ink">{s.role}</span>
                      {s.company && <span className="text-xs text-muted">@ {s.company}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-dim flex-wrap">
                      <span>{ago(s.created_at)}</span>
                      <span>{s.turn_count} Q</span>
                      {s.duration_s > 0 && <span>{Math.floor(s.duration_s/60)}m {s.duration_s%60}s</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {s.status === "completed" && s.total_score != null
                      ? <ScoreBadge score={s.total_score} />
                      : <Badge variant="warning">In Progress</Badge>}
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-dim">
                      <path d="M5 3l4 4-4 4" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Feature card */}
      <Card className="border-accent/20 bg-accent-dim/20">
        <div className="flex gap-3">
          <span className="text-2xl">🎯</span>
          <div>
            <div className="text-sm font-semibold text-ink mb-1">What makes this different</div>
            <div className="text-xs text-muted leading-relaxed space-y-0.5">
              <p>• <span className="text-ink">Delivery analysis</span> — pace, pauses and filler words from your actual audio</p>
              <p>• <span className="text-ink">Resume + JD grounding</span> — questions draw on your uploaded background</p>
              <p>• <span className="text-ink">STAR detection</span> — automatic Situation/Task/Action/Result scoring</p>
              <p>• <span className="text-ink">Adaptive difficulty</span> — hard if you're doing well, gentler when you struggle</p>
              <p>• <span className="text-ink">AI-powered stack</span> — Groq Llama 3.3 70B + Whisper, browser TTS, SQLite</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
