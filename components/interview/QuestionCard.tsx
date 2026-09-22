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
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b3c3b8]">
          <span className={`h-2 w-2 rounded-full ${isSpeaking ? "bg-[#d4f36a] shadow-[0_0_16px_rgba(212,243,106,0.8)] animate-pulse" : "bg-white/35"}`} />
          Question {String(turnIndex + 1).padStart(2, "0")}
        </div>
        <span className="text-xs text-[#dfece3]">{minutes}:{seconds} remaining</span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-gradient-to-r from-[#d4f36a] via-[#8fe0b8] to-[#f6ad8f] transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#d4f36a]/20 bg-[#d4f36a]/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[#dfece3]">
          {isSpeaking ? "Interviewer speaking" : meta.label}
        </div>

        <div className="max-w-2xl">
          <p className="text-[clamp(1.5rem,2.6vw,2.5rem)] leading-[1.08] tracking-[-0.045em] text-[#edf3ed] font-medium drop-shadow-[0_18px_50px_rgba(16,24,19,0.35)]">
            {displayed}
            {displayed.length < question.length && (
              <span className="ml-1 inline-block h-8 w-[2px] animate-pulse rounded-full bg-[#d4f36a] align-middle" />
            )}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#becfc2]">
        {meta.hint}
      </div>
    </div>
  );
}
