"use client";

import { useCallback, useRef } from "react";

export function useBrowserTTS() {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1.0;
    u.volume = 1.0;

    // Prefer a neutral English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang.startsWith("en") && v.name.toLowerCase().includes("google"))
      || voices.find(v => v.lang.startsWith("en"))
      || voices[0];
    if (preferred) u.voice = preferred;

    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();

    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
  }, []);

  return { speak, stop };
}
