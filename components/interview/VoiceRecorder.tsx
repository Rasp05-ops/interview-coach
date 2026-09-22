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
  const eotSocketRef = useRef<WebSocket | null>(null);
  const eotContextRef = useRef<AudioContext | null>(null);
  const eotNodeRef = useRef<AudioWorkletNode | null>(null);

  async function connectEOT(stream: MediaStream) {
    const configured = process.env.NEXT_PUBLIC_EOT_WS_URL || process.env.NEXT_PUBLIC_AGENT_WS_URL;
    const base = configured || `ws://${window.location.hostname}:8001`;
    const eotUrl = configured?.includes("/ws/") ? configured : `${base.replace(/\/$/, "")}/ws/eot`;
    try {
      const socket = new WebSocket(eotUrl);
      eotSocketRef.current = socket;
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("EOT unavailable"));
      });
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "decision" && message.decision === "end" && mrRef.current?.state === "recording") {
            if (timerRef.current) clearInterval(timerRef.current);
            setElapsed(0);
            mrRef.current.stop();
          }
        } catch { /* Keep manual stop available if the service sends an invalid event. */ }
      };
      const context = new AudioContext();
      await context.audioWorklet.addModule("/audio-stream-processor.js");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "audio-stream-processor");
      const silent = context.createGain();
      silent.gain.value = 0;
      node.port.onmessage = event => {
        if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
      };
      source.connect(node);
      node.connect(silent);
      silent.connect(context.destination);
      eotContextRef.current = context;
      eotNodeRef.current = node;
    } catch {
      eotSocketRef.current?.close();
      eotSocketRef.current = null;
    }
  }

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
        eotSocketRef.current?.close();
        eotSocketRef.current = null;
        eotNodeRef.current?.disconnect();
        eotNodeRef.current = null;
        void eotContextRef.current?.close();
        eotContextRef.current = null;
        stopViz();
        setRecording(false);
        onComplete(blob, dur);
      };

      mr.start(100);
      mrRef.current = mr;
      void connectEOT(stream);
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
    eotSocketRef.current?.close();
    eotNodeRef.current?.disconnect();
    void eotContextRef.current?.close();
  }, []);

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {/* Volume bars */}
      <div className="flex h-12 items-center justify-center gap-[4px]" aria-label={recording ? "Voice activity" : "Microphone ready"}>
        {bars.map((h, i) => (
          <div
            key={i}
            className={`w-1 rounded-full transition-all duration-75 ${recording ? "bg-[#f07050]" : "bg-white/20"} ${recording ? "animate-wave" : ""}`}
            style={{ height: `${Math.min(56, h)}px` }}
          />
        ))}
      </div>

      {/* Big mic button */}
      <button
        onClick={recording ? stop : start}
        disabled={disabled || isProcessing}
        className={`room-button h-16 w-16 !p-0 text-white
          ${recording ? "recording recording-pulse" : "bg-white/15 hover:bg-white/25"}
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
            <p className="text-[#f07050] text-sm font-medium">Recording · {elapsed}s</p>
            <p className="room-muted mt-1 text-xs">Click stop when you finish speaking</p>
          </>
        ) : (
          <>
            <p className="text-[#edf3ed] text-sm">Your microphone is ready</p>
            <p className="room-muted mt-1 text-xs">Start when you are ready to answer</p>
          </>
        )}
      </div>
    </div>
  );
}
