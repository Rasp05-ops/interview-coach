"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface Props {
  onComplete: (blob: Blob, seconds: number) => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

export default function VoiceRecorder({ onComplete, disabled, isProcessing }: Props) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(16).fill(8));
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const t0Ref = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopViz() {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    setBars(Array(16).fill(8));
  }

  async function start() {
    if (disabled || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Volume analyser
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
        setBars(prev => prev.map(() => Math.max(6, avg * (0.5 + Math.random()) * 0.7)));
        animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);

      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const dur = (Date.now() - t0Ref.current) / 1000;
        stream.getTracks().forEach(t => t.stop());
        stopViz();
        setRecording(false);
        onComplete(blob, dur);
      };

      mr.start(100);
      mrRef.current = mr;
      t0Ref.current = Date.now();
      setRecording(true);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0Ref.current) / 1000)), 200);
    } catch (e: any) {
      alert("Microphone error: " + e.message);
    }
  }

  function stop() {
    if (!recording) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    mrRef.current?.stop();
  }

  useEffect(() => () => {
    stopViz();
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      {/* Volume bars */}
      <div className="flex items-center justify-center gap-[3px] h-14">
        {bars.map((h, i) => (
          <div
            key={i}
            className={`w-1.5 rounded-full transition-all duration-75 ${recording ? "bg-accent" : "bg-border"}`}
            style={{ height: `${Math.min(56, h)}px` }}
          />
        ))}
      </div>

      {/* Big mic button */}
      <button
        onClick={recording ? stop : start}
        disabled={disabled || isProcessing}
        className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 text-white
          ${recording ? "bg-danger recording-pulse" : "bg-accent hover:bg-accent/85"}
          disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {recording ? (
          /* stop square */
          <svg width="26" height="26" fill="currentColor" viewBox="0 0 24 24">
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </svg>
        ) : (
          /* mic */
          <svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z" strokeLinecap="round" />
            <path d="M19 10a7 7 0 0 1-14 0H3a9 9 0 0 0 18 0h-2z" strokeLinecap="round" />
            <line x1="12" y1="19" x2="12" y2="23" strokeLinecap="round" />
            <line x1="8" y1="23" x2="16" y2="23" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {/* Status */}
      <div className="text-center min-h-10">
        {isProcessing ? (
          <p className="text-muted text-sm animate-pulse">Analysing your answer…</p>
        ) : recording ? (
          <>
            <p className="text-danger text-sm font-medium">● Recording — {elapsed}s</p>
            <p className="text-dim text-xs mt-0.5">Click stop when you finish speaking</p>
          </>
        ) : (
          <>
            <p className="text-muted text-sm">Click to start recording</p>
            <p className="text-dim text-xs mt-0.5">Click again when you've finished your answer</p>
          </>
        )}
      </div>
    </div>
  );
}
