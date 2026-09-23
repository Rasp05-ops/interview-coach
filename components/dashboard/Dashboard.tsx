"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Button, ScoreBadge, Spinner, IconPlus, IconArrowRight } from "@/components/ui";
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
    <div className="max-w-6xl mx-auto pb-16">
      <header className="flex items-center justify-between gap-4 mb-10 animate-fade-up">
        <button onClick={() => router.push("/")} className="flex items-baseline gap-2 text-left group">
          <span className="display-face text-lg text-ink">Interview</span>
          <span className="text-[11px] tracking-[0.24em] text-dim group-hover:text-accent transition-colors">COACH</span>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }} className="rounded-xl px-3 py-2 text-xs text-muted transition-colors hover:bg-surface hover:text-ink">Sign out</button>
          <Button onClick={() => router.push("/setup")}><IconPlus size={13} /> New session</Button>
        </div>
      </header>

      <section className="grid lg:grid-cols-[1.25fr_.75fr] gap-4 mb-8 animate-fade-up stagger-1">
        <div className="relative overflow-hidden rounded-3xl bg-forest border border-border px-7 py-9 sm:px-10 sm:py-12 grain">
          <div className="relative z-10 max-w-xl">
            <div className="text-[11px] tracking-[0.2em] text-accent-soft mb-5">Your practice room</div>
            <h1 className="display-face text-4xl sm:text-[3.25rem] leading-[1.05] mb-4 text-ink">
              Make your next answer<br /><span className="text-accent-soft">impossible to forget.</span>
            </h1>
            <p className="text-[15px] leading-7 text-muted max-w-md">
              A grounded mock interview that listens for clarity, structure, and the details that make your experience yours.
            </p>
          </div>
          <div className="absolute -right-16 -bottom-24 w-72 h-72 rounded-full border border-white/[0.06]" />
          <div className="absolute right-16 -bottom-10 w-40 h-40 rounded-full border border-accent/[0.12]" />
        </div>
        <div className="rounded-3xl bg-card border border-border px-7 py-9 flex flex-col justify-between min-h-[220px]">
          <div className="flex items-start justify-between">
            <span className="text-[11px] tracking-[0.18em] text-dim">Ready when you are</span>
            <span className="w-2 h-2 rounded-full bg-accent breathe" />
          </div>
          <div>
            <div className="display-face text-2xl text-ink leading-snug">Practice with purpose.</div>
            <p className="text-sm text-muted mt-2">Resume-aware. Adaptive. Measured.</p>
          </div>
        </div>
      </section>

      {completed.length > 0 && (
        <div className="grid grid-cols-3 gap-3 animate-fade-up stagger-2">
          {[
            { label: "Sessions", value: sessions.length.toString() },
            { label: "Avg score", value: avg ? `${avg.toFixed(1)}/10` : "—", color: avg ? (avg >= 7 ? "text-success" : avg >= 5 ? "text-warning" : "text-danger") : "" },
            { label: "Completed", value: completed.length.toString() },
          ].map(s => (
            <Card key={s.label} className="text-left py-4">
              <div className={`display-face text-xl ${(s as any).color || "text-ink"}`}>{s.value}</div>
              <div className="text-xs text-muted mt-0.5">{s.label}</div>
            </Card>
          ))}
        </div>
      )}

      {completed.length >= 2 && (
        <Card className="mt-3">
          <div className="text-[13px] text-muted mb-3">Score trend</div>
          <ScoreTrendChart data={trendData} />
        </Card>
      )}

      <div className="mt-9">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-xs text-dim mb-1">{sessions.length === 0 ? "No sessions yet" : "Sessions"}</div>
            <h2 className="display-face text-2xl text-ink">Your recent practice</h2>
          </div>
          {sessions.length > 0 && <span className="text-xs text-dim">Click a session to review</span>}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size={32} /></div>
        ) : sessions.length === 0 ? (
          <Card className="text-center py-14">
            <p className="text-ink font-medium mb-1">No interviews yet</p>
            <p className="text-muted text-sm mb-6">Start practising with a focused mock interview.</p>
            <Button onClick={() => router.push("/setup")}>Start your first interview <IconArrowRight /></Button>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {sessions.map(s => (
              <Card key={s.id}
                onClick={() => s.status === "completed" ? router.push(`/review/${s.id}`) : router.push(`/interview/${s.id}`)}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-medium text-ink">{s.role}</span>
                      {s.company && <span className="text-xs text-muted">at {s.company}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-dim flex-wrap">
                      <span>{ago(s.created_at)}</span>
                      <span>{s.turn_count} questions</span>
                      {s.duration_s > 0 && <span>{Math.floor(s.duration_s/60)}m {s.duration_s%60}s</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {s.status === "completed" && s.total_score != null
                      ? <ScoreBadge score={s.total_score} />
                      : <Badge variant="warning">In progress</Badge>}
                    <IconArrowRight size={13} className="text-dim" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="mt-8 border-accent/15 bg-accent-dim/40">
        <div className="text-sm font-medium text-ink mb-3">What makes this different</div>
        <div className="text-[13px] text-muted leading-relaxed space-y-1.5">
          <p><span className="text-ink">Delivery analysis</span> — pace, pauses and filler words from your actual audio</p>
          <p><span className="text-ink">Resume and JD grounding</span> — questions draw on your uploaded background</p>
          <p><span className="text-ink">STAR detection</span> — automatic Situation / Task / Action / Result scoring</p>
          <p><span className="text-ink">Adaptive difficulty</span> — harder if you're doing well, gentler when you struggle</p>
        </div>
      </Card>
    </div>
  );
}