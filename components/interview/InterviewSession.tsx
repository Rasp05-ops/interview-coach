"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import VoiceRecorder from "./VoiceRecorder";
import QuestionCard from "./QuestionCard";
import AnswerFeedback from "./AnswerFeedback";
import { useBrowserTTS } from "./useBrowserTTS";
import { Button, Spinner } from "@/components/ui";
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
    (async () => {
      try {
        const r = await fetch("/api/interview/start", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        const q: QState = { turnId: d.turnId, question: d.question, questionType: d.questionType, turnIndex: 0, remainingSeconds: d.remainingSeconds ?? SESSION_DURATION_SECONDS };
        setCurrent(q);
        setPhase("speaking");
        speak(d.question, () => setPhase("recording"));
      } catch (e: any) { setError(e.message); }
    })();
  }, [sessionId]);

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
    <div className="max-w-xl mx-auto mt-20 text-center space-y-4">
      <p className="text-danger">Something went wrong</p>
      <div className="text-sm text-muted bg-danger-dim border border-danger/30 rounded-xl p-4">{error}</div>
      <Button onClick={() => { setError(""); setPhase("recording"); }} variant="ghost">Retry</Button>
    </div>
  );

  const notice = conversationNotice && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="conversation-notice-title">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-[0_24px_80px_rgba(33,76,58,0.2)] animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-accent-dim text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 id="conversation-notice-title" className="text-base font-semibold text-forest">Let&apos;s continue</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{conversationNotice}</p>
          </div>
        </div>
        <Button onClick={() => setConversationNotice("")} className="mt-5 w-full">Continue answering</Button>
      </div>
    </div>
  );

  if (phase === "loading") return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Spinner size={40} /><p className="text-muted">Preparing your interview…</p>
      {notice}
    </div>
  );

  const stageClass = phase === "speaking" ? "ai-speaking" : phase === "recording" ? "user-speaking" : "";
  const stageLabel = phase === "speaking" ? "Interviewer speaking" : phase === "recording" ? "Your turn" : phase === "processing" ? "Reading your answer" : "Interview room";

  return (
    <>
    <div className="interview-room mx-auto max-w-6xl rounded-[28px] px-5 py-5 sm:px-8 sm:py-7">
      <div className="relative z-10 flex items-center justify-between border-b border-white/10 pb-5">
        <button onClick={() => router.push("/")} className="room-muted text-xs transition-colors hover:text-white">← Exit room</button>
        <div className="flex items-center gap-3"><span className="room-kicker hidden sm:block">Live interview</span><span className="h-2 w-2 rounded-full bg-[#d4f36a] animate-pulse" /><Button onClick={endEarly} variant="ghost" size="sm" disabled={phase === "finishing"}>End session</Button></div>
      </div>

      <div className="relative z-10 grid gap-6 py-7 lg:grid-cols-[1.1fr_.9fr]">
        <section className="space-y-6">
          {current && <div className="room-panel rounded-[24px] p-5 sm:p-7"><QuestionCard question={current.question} questionType={current.questionType} turnIndex={current.turnIndex} remainingSeconds={current.remainingSeconds} isSpeaking={phase === "speaking"} /></div>}
          <div className={`voice-stage room-panel rounded-[24px] ${stageClass}`}>
            <div className="voice-orbit" />
            <div className="voice-core" aria-hidden="true">
              {phase === "recording" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10a7 7 0 0 1-14 0M12 17v5m-3 0h6" strokeLinecap="round"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 12h2m3-4v8m4-11v14m4-11v8m3-4h-2" strokeLinecap="round"/></svg>}
            </div>
            <div className="voice-state">{stageLabel}</div>
          </div>
        </section>

        <aside className="flex flex-col gap-6">
          <div className="room-panel rounded-[24px] p-5 sm:p-7">
            <div className="room-kicker mb-4">Response console</div>
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
            <p className="text-muted text-sm">Transcribing · detecting STAR · evaluating…</p>
          </div>
        )}

        {phase === "finishing" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Spinner size={36} />
            <p className="text-muted text-sm">Generating your session report…</p>
          </div>
        )}

        {phase === "feedback" && feedback && (
          <div className="space-y-4 text-[#edf3ed]">
            <AnswerFeedback {...feedback} />
            <div className="border-t border-white/10 pt-4">
              <button onClick={handleNext} className="room-button w-full" disabled={phase !== "feedback"}>
                {nextRef.current ? "Next question →" : "Finish & see results →"}
              </button>
            </div>
          </div>
        )}
          </div>
          <div className="room-muted hidden rounded-[24px] border border-white/10 p-5 text-xs leading-6 lg:block">The room listens for a complete thought. Take a breath, be specific, and let the answer land before stopping.</div>
        </aside>
      </div>
    </div>
    {notice}
    </>
  );
}
