"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import VoiceRecorder from "./VoiceRecorder";
import QuestionCard from "./QuestionCard";
import AnswerFeedback from "./AnswerFeedback";
import { useBrowserTTS } from "./useBrowserTTS";
import { Button, Spinner, IconArrowLeft, IconArrowRight } from "@/components/ui";
import { SESSION_DURATION_SECONDS } from "@/lib/interview/config";

type Phase = "loading" | "speaking" | "recording" | "processing" | "feedback" | "finishing";

interface QState { turnId: string; question: string; questionType: string; turnIndex: number; remainingSeconds: number; }
interface FState {
  score: number; feedback: string; strengths: string[]; improvements: string[];
  transcript: string; fillerCount: number; fillerWords: string[]; wpm: number;
  audioSeconds: number; eotProbability: number; questionType: string;
  star: { situation: boolean; task: boolean; action: boolean; result: boolean; score: number };
}

export default function InterviewSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { speak, stop: stopTTS } = useBrowserTTS();
  const [phase, setPhase] = useState<Phase>("loading");
  const [current, setCurrent] = useState<QState | null>(null);
  const [feedback, setFeedback] = useState<FState | null>(null);
  const [error, setError] = useState("");
  const [conversationNotice, setConversationNotice] = useState("");
  const nextRef = useRef<QState | null>(null);

  const startInterview = useCallback(async () => {
    setError("");
    setConversationNotice("");
    setFeedback(null);
    setCurrent(null);
    try {
      const r = await fetch("/api/interview/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Unable to start the interview");
      const q: QState = {
        turnId: d.turnId,
        question: d.question,
        questionType: d.questionType,
        turnIndex: d.turnIndex,
        remainingSeconds: d.remainingSeconds ?? SESSION_DURATION_SECONDS,
      };
      setCurrent(q);
      setPhase("speaking");
      speak(d.question, () => setPhase("recording"));
    } catch (e: any) {
      setError(e.message || "Unable to start the interview");
      setPhase("loading");
    }
  }, [sessionId, speak]);

  useEffect(() => {
    if (!current || phase === "finishing") return;
    const timer = setInterval(() => {
      setCurrent(previous => {
        if (!previous || previous.remainingSeconds <= 1) return previous ? { ...previous, remainingSeconds: 0 } : previous;
        return { ...previous, remainingSeconds: previous.remainingSeconds - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [current?.turnId, phase]);

  useEffect(() => {
    if (!current || current.remainingSeconds > 0 || phase === "finishing" || phase === "loading") return;
    setPhase("finishing");
    stopTTS();
    void fetch("/api/interview/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).finally(() => router.push(`/review/${sessionId}`));
  }, [current, phase, router, sessionId, stopTTS]);

  // Boot: get first question
  useEffect(() => {
    void startInterview();
  }, [startInterview]);

  const handleRecorded = useCallback(async (blob: Blob, secs: number) => {
    if (!current) return;
    setPhase("processing");
    setFeedback(null);
    try {
      const form = new FormData();
      form.append("audio", blob, "answer.webm");
      form.append("sessionId", sessionId);
      form.append("turnId", current.turnId);
      form.append("clientSeconds", String(secs));
      const r = await fetch("/api/interview/answer", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) {
        if (d.code === "MIC_CHECK" || d.code === "CONVERSATIONAL_TURN") {
          setConversationNotice(d.error || "Please answer the interview question when you are ready.");
          setPhase("recording");
          return;
        }
        throw new Error(d.error);
      }

      setFeedback({
        score: d.score, feedback: d.feedback, strengths: d.strengths, improvements: d.improvements,
        transcript: d.transcript, fillerCount: d.fillerCount, fillerWords: d.fillerWords || [],
        wpm: d.wpm, audioSeconds: d.audioSeconds || secs, eotProbability: d.eotProbability || 0.5,
        questionType: current.questionType, star: d.star || { situation: false, task: false, action: false, result: false, score: 0 },
      });

      nextRef.current = d.isComplete ? null : (d.nextTurnId ? {
        turnId: d.nextTurnId, question: d.nextQuestion,
        questionType: d.nextQType, turnIndex: d.nextTurnIndex, remainingSeconds: d.remainingSeconds ?? 0,
      } : null);

      setPhase("feedback");
    } catch (e: any) {
      setError(e.message);
      setPhase("recording");
    }
  }, [current, sessionId]);

  const handleNext = useCallback(async () => {
    if (!nextRef.current) {
      // finish
      setPhase("finishing");
      try {
        await fetch("/api/interview/feedback", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        router.push(`/review/${sessionId}`);
      } catch (e: any) { setError(e.message); setPhase("feedback"); }
      return;
    }
    const next = nextRef.current;
    nextRef.current = null;
    setCurrent(next);
    setFeedback(null);
    setPhase("speaking");
    speak(next.question, () => setPhase("recording"));
  }, [sessionId, router, speak]);

  async function endEarly() {
    if (!confirm("End interview and go to results?")) return;
    setPhase("finishing");
    stopTTS();
    await fetch("/api/interview/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {});
    router.push(`/review/${sessionId}`);
  }

  if (error) return (
    <div className="mx-auto mt-12 max-w-xl rounded-3xl border border-danger/20 bg-danger-dim/60 p-8 text-center animate-fade-up">
      <p className="text-xs font-medium tracking-[0.16em] text-danger">Something went wrong</p>
      <div className="mt-4 rounded-2xl border border-danger/15 bg-black/20 p-4 text-sm leading-6 text-ink">{error}</div>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Button onClick={() => void startInterview()} variant="ghost">Retry</Button>
        <Button onClick={() => router.push("/setup")}>Back to setup</Button>
      </div>
    </div>
  );

  const notice = conversationNotice && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="conversation-notice-title">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)] animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-accent-dim text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 id="conversation-notice-title" className="text-base font-medium text-ink">Let&apos;s continue</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{conversationNotice}</p>
          </div>
        </div>
        <Button onClick={() => setConversationNotice("")} className="mt-5 w-full">Continue answering</Button>
      </div>
    </div>
  );

  if (phase === "loading") return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 animate-fade-up">
      <div className="rounded-full border border-border bg-card p-4">
        <Spinner size={40} />
      </div>
      <p className="text-sm text-muted">Preparing your interview…</p>
      {notice}
    </div>
  );

  const stageClass = phase === "speaking" ? "ai-speaking" : phase === "recording" ? "user-speaking" : "";
  const stageLabel = phase === "speaking" ? "Interviewer speaking" : phase === "recording" ? "Your turn" : phase === "processing" ? "Reading your answer" : "Interview room";

  return (
    <>
    <div className="interview-room mx-auto max-w-6xl rounded-[32px] px-5 py-5 shadow-[0_30px_100px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.03] sm:px-8 sm:py-7">
      <div className="relative z-10 flex items-center justify-between border-b border-white/[0.06] pb-5">
        <button onClick={() => router.push("/")} className="flex items-center gap-1.5 text-xs font-medium text-dim transition-colors hover:text-ink">
          <IconArrowLeft size={12} /> Exit room
        </button>
        <div className="flex items-center gap-3">
          <span className="hidden text-[10px] font-medium tracking-[0.2em] text-dim sm:block">Live interview</span>
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
          <Button onClick={endEarly} variant="ghost" size="sm" disabled={phase === "finishing"}>End session</Button>
        </div>
      </div>

      <div className="relative z-10 grid gap-6 py-7 lg:grid-cols-[1.15fr_.85fr]">
        <section className="space-y-6">
          {current && (
            <div className="room-panel rounded-[26px] p-5 sm:p-7 animate-fade-up">
              <QuestionCard question={current.question} questionType={current.questionType} turnIndex={current.turnIndex} remainingSeconds={current.remainingSeconds} isSpeaking={phase === "speaking"} />
            </div>
          )}

          <div className={`voice-stage room-panel rounded-[26px] ${stageClass}`}>
            <div className="voice-orbit" />
            <div className="voice-core float-soft" aria-hidden="true">
              {phase === "recording" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10a7 7 0 0 1-14 0M12 17v5m-3 0h6" strokeLinecap="round"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 12h2m3-4v8m4-11v14m4-11v8m3-4h-2" strokeLinecap="round"/></svg>}
            </div>
            <div className="voice-state">{stageLabel}</div>
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <div className="room-panel rounded-[26px] p-5 sm:p-7">
            <div className="room-kicker mb-4">RESPONSE CONSOLE</div>
            {(phase === "speaking" || phase === "recording") && (
              <VoiceRecorder
                onComplete={handleRecorded}
                disabled={phase === "speaking"}
                isProcessing={false}
              />
            )}

            {phase === "processing" && (
              <div className="flex flex-col items-center gap-3 py-10">
                <Spinner size={36} />
                <p className="text-sm text-muted">Transcribing, detecting STAR, evaluating…</p>
              </div>
            )}

            {phase === "finishing" && (
              <div className="flex flex-col items-center gap-3 py-10">
                <Spinner size={36} />
                <p className="text-sm text-muted">Generating your session report…</p>
              </div>
            )}

            {phase === "feedback" && feedback && (
              <div className="space-y-4 text-ink animate-fade-up">
                <AnswerFeedback {...feedback} />
                <div className="border-t border-white/[0.06] pt-4">
                  <button onClick={handleNext} className="room-button w-full" disabled={phase !== "feedback"}>
                    {nextRef.current ? "Next question" : "Finish and see results"} <IconArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="hidden rounded-[26px] border border-white/[0.06] bg-white/[0.02] p-5 text-xs leading-6 text-dim lg:block">
            The room listens for a complete thought. Take a breath, be specific, and let the answer land before stopping.
          </div>
        </aside>
      </div>
    </div>
    {notice}
    </>
  );
}