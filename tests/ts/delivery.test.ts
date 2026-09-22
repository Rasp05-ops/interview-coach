import { describe, it, expect, vi } from "vitest";

// transcribe.ts imports the Groq client at module load; stub it so tests stay offline.
vi.mock("@/lib/ai/client", () => ({ getGroq: () => ({}), MODELS: { stt: "x" } }));

import { analyzeDelivery, isMicrophoneCheck, looksLikeConversationalQuestion, pauseStats } from "@/lib/ai/transcribe";
import { resolveDuration } from "@/lib/audio/eot";

describe("filler detection", () => {
  it("counts real disfluencies", () => {
    const r = analyzeDelivery("Um, so I, uh, built a service. You know, it was fast.", 10);
    expect(r.fillerWords).toEqual(expect.arrayContaining(["um", "uh", "you know"]));
    expect(r.fillerCount).toBe(3);
  });

  it("does not count legitimate uses of 'like', 'right', 'actually'", () => {
    const r = analyzeDelivery("I like Python. The answer was right. Actually the design worked like a queue.", 10);
    expect(r.fillerCount).toBe(0);
  });

  it("counts parenthetical 'like' as a filler", () => {
    const r = analyzeDelivery("We, like, shipped it and, like, it worked.", 10);
    expect(r.fillerWords.filter(w => w === "like").length).toBe(2);
  });

  it("reports hedges separately from fillers", () => {
    const r = analyzeDelivery("It was kind of hard and actually basically fine.", 10);
    expect(r.fillerCount).toBe(0);
    expect(r.hedgeCount).toBe(3);
  });
});

describe("pace and pauses", () => {
  it("computes wpm from duration and 0 when duration unknown", () => {
    expect(analyzeDelivery("one two three four five six", 6).wpm).toBe(60);
    expect(analyzeDelivery("one two three", 0).wpm).toBe(0);
  });

  it("finds long pauses and excludes silence from articulation rate", () => {
    const words = [
      { word: "a", start: 0.0, end: 0.3 },
      { word: "b", start: 0.4, end: 0.7 },
      { word: "c", start: 2.0, end: 2.3 }, // 1.3s pause
    ];
    const s = pauseStats(words);
    expect(s.longPauseCount).toBe(1);
    expect(s.longestPauseS).toBe(1.3);
    expect(s.articulationWpm).toBeGreaterThan(analyzeDelivery("a b c", 2.3).wpm);
  });

  it("returns zeros when no word timings are available", () => {
    expect(pauseStats(undefined).pauseCount).toBe(0);
  });
});

describe("duration fallback", () => {
  it("trusts the Python bridge when it worked", () => {
    expect(resolveDuration({ is_complete: true, probability: 0.5, duration_s: 42, ok: true }, 40)).toBe(42);
  });
  it("falls back to client-measured duration when the bridge failed (was silently 0 before)", () => {
    expect(resolveDuration({ is_complete: true, probability: 0.5, duration_s: 0, ok: false }, 55)).toBe(55);
  });
  it("returns 0 only when nothing is known", () => {
    expect(resolveDuration({ is_complete: true, probability: 0.5, duration_s: 0, ok: false }, 0)).toBe(0);
  });
});

describe("microphone checks", () => {
  it("recognizes an audible check without treating it as an interview answer", () => {
    expect(isMicrophoneCheck("Am I audible?")).toBe(true);
    expect(isMicrophoneCheck("Am I audible, first of all?")).toBe(true);
    expect(isMicrophoneCheck("Can you hear me!")).toBe(true);
    expect(isMicrophoneCheck("Could you repeat the question?")).toBe(true);
    expect(isMicrophoneCheck("I built an API and reduced latency by 30 percent.")).toBe(false);
    expect(looksLikeConversationalQuestion("What do you mean by low-level systems?")).toBe(true);
    expect(looksLikeConversationalQuestion("I built an API and reduced latency by 30 percent.")).toBe(false);
  });
});
