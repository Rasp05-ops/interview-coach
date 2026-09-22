"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { SESSION_DURATION_SECONDS } from "@/lib/interview/config";

const TYPE_META: Record<string, { label: string; variant: any; hint: string }> = {
  behavioral:   { label: "Behavioral",    variant: "accent",   hint: "Use STAR: Situation → Task → Action → Result" },
  technical:    { label: "Technical",     variant: "warning",  hint: "Think aloud, state assumptions, give examples" },
  situational:  { label: "Situational",   variant: "default",  hint: "Describe what you WOULD do, be specific" },
  motivational: { label: "Motivation",    variant: "success",  hint: "Be genuine and specific to this company/role" },
};

interface Props {
  question: string;
  questionType: string;
  turnIndex: number;
  remainingSeconds: number;
  isSpeaking: boolean;
}

export default function QuestionCard({ question, questionType, turnIndex, remainingSeconds, isSpeaking }: Props) {
  const [displayed, setDisplayed] = useState("");
  const meta = TYPE_META[questionType] || TYPE_META.behavioral;

  useEffect(() => {
    setDisplayed("");
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setDisplayed(question.slice(0, i));
      if (i >= question.length) clearInterval(iv);
    }, 16);
    return () => clearInterval(iv);
  }, [question]);

  const pct = Math.max(0, Math.min(100, (remainingSeconds / SESSION_DURATION_SECONDS) * 100));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Question {turnIndex + 1} · {minutes}:{seconds} remaining</span>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>
      <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
        <div className="h-full bg-accent rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>

      {/* Avatar + question */}
      <div className="flex gap-3 items-start">
        <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center border transition-colors
          ${isSpeaking ? "border-accent bg-accent-dim animate-pulse" : "border-border bg-surface"}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
          </svg>
        </div>
        <div className="flex-1 pt-0.5">
          <p className="text-ink text-base leading-relaxed font-medium">
            {displayed}
            {displayed.length < question.length && (
              <span className="inline-block w-0.5 h-4 bg-accent ml-0.5 animate-blink" />
            )}
          </p>
        </div>
      </div>

      {/* Hint */}
      <div className="ml-12 text-xs text-dim italic">{meta.hint}</div>
    </div>
  );
}
