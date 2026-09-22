"use client";

import { useEffect, useState } from "react";
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
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[10px] font-medium tracking-[0.16em] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${isSpeaking ? "bg-accent shadow-[0_0_14px_rgba(201,162,75,0.7)] animate-pulse" : "bg-white/25"}`} />
          QUESTION {String(turnIndex + 1).padStart(2, "0")}
        </div>
        <span className="text-xs text-muted">{minutes}:{seconds} remaining</span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-soft transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.06] px-2.5 py-1 text-[10px] font-medium tracking-[0.14em] text-accent-soft">
          {isSpeaking ? "Interviewer speaking" : meta.label}
        </div>

        <div className="max-w-2xl">
          <p className="display-face text-[clamp(1.5rem,2.6vw,2.35rem)] leading-[1.14] text-ink font-normal">
            {displayed}
            {displayed.length < question.length && (
              <span className="ml-1 inline-block h-7 w-[2px] animate-pulse rounded-full bg-accent align-middle" />
            )}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-xs text-dim">
        {meta.hint}
      </div>
    </div>
  );
}