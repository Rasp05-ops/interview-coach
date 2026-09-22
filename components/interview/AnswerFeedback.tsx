"use client";

import { useState } from "react";
import { ScoreBadge, IconCheck, IconArrowRight } from "@/components/ui";
import STARBreakdown from "./STARBreakdown";

interface Props {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  transcript: string;
  fillerCount: number;
  fillerWords: string[];
  wpm: number;
  audioSeconds: number;
  eotProbability: number;
  questionType: string;
  star: { situation: boolean; task: boolean; action: boolean; result: boolean; score: number };
}

export default function AnswerFeedback(p: Props) {
  const [showTranscript, setShowTranscript] = useState(false);

  const wpmColor = p.wpm >= 120 && p.wpm <= 170 ? "text-success" : "text-warning";
  const fillerColor = p.fillerCount === 0 ? "text-success" : p.fillerCount <= 4 ? "text-warning" : "text-danger";

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Score row */}
      <div className="flex items-center gap-5 bg-black/20 border border-border rounded-xl p-4">
        <div className="text-center min-w-[56px]">
          <div className="text-xs text-dim mb-0.5">Score</div>
          <ScoreBadge score={p.score} />
        </div>
        <div className="flex-1 grid grid-cols-4 gap-2 text-center text-xs">
          <div>
            <div className="text-dim">Duration</div>
            <div className="font-medium mt-0.5 text-ink">{p.audioSeconds.toFixed(0)}s</div>
          </div>
          <div>
            <div className="text-dim">Pace</div>
            <div className={`font-medium mt-0.5 ${wpmColor}`}>{p.wpm} wpm</div>
          </div>
          <div>
            <div className="text-dim">Fillers</div>
            <div className={`font-medium mt-0.5 ${fillerColor}`}>{p.fillerCount}</div>
          </div>
          <div>
            <div className="text-dim">Sounds complete</div>
            <div className="font-medium mt-0.5 text-accent-soft">{(p.eotProbability * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>

      {/* AI feedback */}
      <div className="text-sm text-ink/90 leading-relaxed bg-black/10 border border-border rounded-xl p-4">
        {p.feedback}
      </div>

      {/* STAR (behavioral only) */}
      {p.questionType === "behavioral" && (
        <STARBreakdown star={p.star} />
      )}

      {/* Strengths */}
      {p.strengths.length > 0 && (
        <div>
          <div className="text-xs text-success mb-2">What worked</div>
          <ul className="space-y-1.5">
            {p.strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted">
                <IconCheck className="text-success flex-shrink-0 mt-1" />{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Improvements */}
      {p.improvements.length > 0 && (
        <div>
          <div className="text-xs text-warning mb-2">Improve next time</div>
          <ul className="space-y-1.5">
            {p.improvements.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted">
                <IconArrowRight size={11} className="text-warning flex-shrink-0 mt-1" />{s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filler words detail */}
      {p.fillerCount > 0 && (
        <div className="text-xs text-muted bg-black/10 border border-border rounded-lg p-3">
          <span className="text-warning font-medium">Filler words detected: </span>
          {[...new Set(p.fillerWords)].map((f, i) => (
            <span key={i} className="inline-block bg-warning-dim border border-warning/20 rounded px-1.5 py-0.5 mr-1 mb-1 text-warning">{f}</span>
          ))}
        </div>
      )}

      {/* Transcript toggle */}
      {p.transcript && (
        <button onClick={() => setShowTranscript(!showTranscript)} className="text-xs text-dim hover:text-muted flex items-center gap-1 transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`transition-transform ${showTranscript ? "rotate-90" : ""}`}>
            <path d="M3 2l4 3-4 3V2z" />
          </svg>
          {showTranscript ? "Hide transcript" : "View transcript"}
        </button>
      )}
      {showTranscript && p.transcript && (
        <div className="text-xs text-muted font-mono bg-black/10 border border-border rounded-xl p-3 leading-relaxed max-h-40 overflow-y-auto animate-fade-in">
          {p.transcript}
        </div>
      )}
    </div>
  );
}