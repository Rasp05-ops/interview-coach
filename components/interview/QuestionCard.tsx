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
      {/* Progress */}
      <div className="flex items-center justify-between room-muted">
        <span className="room-kicker">Question {String(turnIndex + 1).padStart(2, "0")}</span>
        <span className="text-xs">{minutes}:{seconds} remaining</span>
      </div>
      <div className="h-px w-full bg-white/10 overflow-hidden">
        <div className="h-full bg-[#d4f36a] transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>

      {/* Avatar + question */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 room-kicker"><span className={`h-2 w-2 rounded-full ${isSpeaking ? "bg-[#d4f36a] animate-pulse" : "bg-white/30"}`} />{isSpeaking ? "Interviewer speaking" : meta.label}</div>
        <div className="max-w-2xl">
          <p className="text-[clamp(1.45rem,3vw,2.35rem)] leading-[1.12] tracking-[-.02em] text-[#edf3ed] font-medium">
            {displayed}
            {displayed.length < question.length && (
              <span className="inline-block w-0.5 h-8 bg-[#d4f36a] ml-1 animate-blink align-middle" />
            )}
          </p>
        </div>
      </div>

      {/* Hint */}
      <div className="text-xs room-muted border-l border-[#d4f36a]/40 pl-3">{meta.hint}</div>
    </div>
  );
}
