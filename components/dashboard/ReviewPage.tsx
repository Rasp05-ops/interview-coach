"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Button, ScoreBadge, ProgressBar, Spinner, IconCheck, IconArrowLeft, IconArrowRight } from "@/components/ui";
import STARBreakdown from "@/components/interview/STARBreakdown";

const TYPE_COLORS: Record<string, any> = {
  behavioral: "accent", technical: "warning", situational: "default", motivational: "success",
};

function scoreColor(s: number): "success" | "warning" | "danger" {
  return s >= 7 ? "success" : s >= 5 ? "warning" : "danger";
}

function fmt(s: number) { const m = Math.floor(s/60); return `${m}m ${Math.round(s%60)}s`; }

interface Turn {
  turn_index: number; question: string; question_type: string; answer_text: string;
  score: number; feedback: string; strengths: string[]; improvements: string[];
  star_breakdown: { situation: boolean; task: boolean; action: boolean; result: boolean; score: number };
  filler_count: number; wpm: number; answer_audio_s: number; eot_probability: number;
}

interface ReviewData {
  overallScore: number; verdict: string; strengths: string[]; gaps: string[]; studyPlan: string[];
  session: { role: string; company: string; duration_s: number };
  turns: Turn[];
}

export default function ReviewPage({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(0);

  useEffect(() => {
    fetch("/api/interview/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).then(r => r.json()).then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sessionId]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Spinner size={40} /><p className="text-muted">Generating your report…</p>
    </div>
  );
  if (!data) return <div className="text-center py-20 text-muted">Could not load results. <button onClick={() => router.push("/")} className="underline">Home</button></div>;

  const { overallScore, verdict, strengths, gaps, studyPlan, session, turns } = data;
  const totalFillers = turns.reduce((s, t) => s + (t.filler_count || 0), 0);
  const avgWPM = turns.length ? Math.round(turns.reduce((s, t) => s + (t.wpm || 0), 0) / turns.length) : 0;
  const verdictVariant: any = overallScore >= 7 ? "success" : overallScore >= 5 ? "warning" : "danger";

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-16 animate-fade-up">
      {/* Nav */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => router.push("/")} className="flex items-center gap-1.5 text-dim hover:text-muted text-sm transition-colors">
          <IconArrowLeft size={12} /> Home
        </button>
        <Button onClick={() => router.push("/setup")} size="sm">New interview</Button>
      </div>

      {/* Hero */}
      <Card className="text-center space-y-3 py-8">
        <div className="text-muted text-sm">{session.role}{session.company ? ` at ${session.company}` : ""}</div>
        <div>
          <div className={`display-face text-6xl tabular-nums ${overallScore >= 7 ? "text-success" : overallScore >= 5 ? "text-warning" : "text-danger"}`}>
            {overallScore.toFixed(1)}
          </div>
          <div className="text-dim text-sm mt-1">out of 10</div>
        </div>
        <div className="flex justify-center"><Badge variant={verdictVariant}>{verdict}</Badge></div>
        <div className="grid grid-cols-4 gap-3 pt-4 border-t border-border mt-2">
          {[
            { label: "Questions", value: turns.length },
            { label: "Duration",  value: fmt(session.duration_s) },
            { label: "Avg WPM",   value: avgWPM, color: avgWPM >= 120 && avgWPM <= 170 ? "text-success" : "text-warning" },
            { label: "Fillers",   value: totalFillers, color: totalFillers <= 5 ? "text-success" : totalFillers <= 12 ? "text-warning" : "text-danger" },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className={`text-lg font-medium ${(s as any).color || "text-ink"}`}>{s.value}</div>
              <div className="text-xs text-dim">{s.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Strengths + Gaps */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="text-xs text-success mb-3">Top strengths</div>
          <ul className="space-y-2">
            {strengths.map((s, i) => <li key={i} className="flex gap-2 text-sm text-muted"><IconCheck className="text-success flex-shrink-0 mt-1" />{s}</li>)}
          </ul>
        </Card>
        <Card>
          <div className="text-xs text-danger mb-3">Critical gaps</div>
          <ul className="space-y-2">
            {gaps.map((g, i) => <li key={i} className="flex gap-2 text-sm text-muted"><span className="text-danger flex-shrink-0">·</span>{g}</li>)}
          </ul>
        </Card>
      </div>

      {/* Q scores bar chart */}
      <Card>
        <div className="text-xs text-dim mb-4">Question scores</div>
        <div className="space-y-3">
          {turns.map((t, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-xs text-dim w-5 text-right">Q{i+1}</span>
              <div className="flex-1"><ProgressBar value={t.score||0} max={10} color={scoreColor(t.score||0)} /></div>
              <span className={`text-xs tabular-nums w-8 text-right ${t.score>=7?"text-success":t.score>=5?"text-warning":"text-danger"}`}>{(t.score||0).toFixed(1)}</span>
              <Badge variant={TYPE_COLORS[t.question_type]||"default"}>{t.question_type}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Study plan */}
      <Card>
        <div className="text-xs text-accent-soft mb-3">Study plan</div>
        <ol className="space-y-2">
          {studyPlan.map((item, i) => (
            <li key={i} className="flex gap-3 text-sm text-muted">
              <span className="display-face text-accent-soft flex-shrink-0">{i+1}</span>{item}
            </li>
          ))}
        </ol>
      </Card>

      {/* Turn accordion */}
      <div>
        <div className="text-xs text-dim mb-3">Detailed breakdown</div>
        <div className="space-y-2.5">
          {turns.map((t, i) => (
            <Card key={i} onClick={() => setExpanded(expanded === i ? null : i)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant={TYPE_COLORS[t.question_type]||"default"}>{t.question_type}</Badge>
                    <span className="text-xs text-dim">{Math.round(t.answer_audio_s||0)}s</span>
                    <span className="text-xs text-dim">{t.wpm||0} wpm</span>
                    {(t.filler_count||0) > 0 && <span className="text-xs text-warning">{t.filler_count} fillers</span>}
                  </div>
                  <p className="text-sm text-ink font-medium line-clamp-2">{t.question}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ScoreBadge score={t.score} />
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
                    className={`text-dim transition-transform duration-200 ${expanded === i ? "rotate-180" : ""}`}>
                    <path d="M3 5l4 4 4-4" strokeLinecap="round" />
                  </svg>
                </div>
              </div>

              {expanded === i && (
                <div className="mt-4 pt-4 border-t border-border space-y-4 animate-fade-in">
                  <p className="text-sm text-muted leading-relaxed">{t.feedback}</p>

                  {t.question_type === "behavioral" && t.star_breakdown && (
                    <STARBreakdown star={t.star_breakdown} />
                  )}

                  {t.strengths?.length > 0 && (
                    <ul className="space-y-1">
                      {t.strengths.map((s, j) => <li key={j} className="flex gap-2 text-xs text-muted"><IconCheck className="text-success flex-shrink-0 mt-0.5" />{s}</li>)}
                    </ul>
                  )}
                  {t.improvements?.length > 0 && (
                    <ul className="space-y-1">
                      {t.improvements.map((s, j) => <li key={j} className="flex gap-2 text-xs text-muted"><IconArrowRight size={10} className="text-warning flex-shrink-0 mt-0.5" />{s}</li>)}
                    </ul>
                  )}

                  {t.answer_text && (
                    <details>
                      <summary className="text-xs text-dim cursor-pointer">Transcript</summary>
                      <p className="mt-2 text-xs text-muted font-mono bg-black/10 rounded-lg p-3 leading-relaxed">{t.answer_text}</p>
                    </details>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}