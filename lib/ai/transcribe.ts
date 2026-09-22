import { getGroq, MODELS } from "@/lib/ai/client";

// Disfluencies that are almost never legitimate content words.
const DISFLUENCIES = ["um", "umm", "uh", "uhh", "er", "erm", "hmm", "you know", "i mean", "so yeah"];
// "like" is only a filler when used parenthetically (", like,") or doubled ("like like").
const LIKE_FILLER = /(?:^|[,.;]\s+)like\s*,|\blike\s+like\b/gi;
// Hedges are reported separately: "kind of" / "sort of" / "basically" are often legitimate.
const HEDGES = ["kind of", "sort of", "basically", "literally", "actually"];

function countPhrase(lower: string, phrase: string): number {
  const re = new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi");
  return (lower.match(re) || []).length;
}

export type WordTiming = { word: string; start: number; end: number };

export function pauseStats(words: WordTiming[] | undefined, longPauseS = 0.7) {
  if (!words || words.length < 2) {
    return { pauseCount: 0, longPauseCount: 0, longestPauseS: 0, speechSeconds: 0, articulationWpm: 0, firstWordDelayS: 0 };
  }
  let pauseCount = 0, longPauseCount = 0, longest = 0, silence = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > 0.25) { pauseCount++; silence += gap; }
    if (gap >= longPauseS) longPauseCount++;
    if (gap > longest) longest = gap;
  }
  const span = words[words.length - 1].end - words[0].start;
  const speech = Math.max(0.001, span - silence);
  return {
    pauseCount, longPauseCount,
    longestPauseS: Math.round(longest * 100) / 100,
    speechSeconds: Math.round(speech * 10) / 10,
    articulationWpm: Math.round((words.length / speech) * 60),
    firstWordDelayS: Math.round(words[0].start * 100) / 100,
  };
}

export function analyzeDelivery(text: string, audioSeconds: number, words?: WordTiming[]) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const f of DISFLUENCIES) {
    const n = countPhrase(lower, f);
    for (let i = 0; i < n; i++) found.push(f);
  }
  const likeMatches = lower.match(LIKE_FILLER) || [];
  for (let i = 0; i < likeMatches.length; i++) found.push("like");
  let hedgeCount = 0;
  for (const h of HEDGES) hedgeCount += countPhrase(lower, h);

  const wpm = audioSeconds > 0 ? Math.round((tokens.length / audioSeconds) * 60) : 0;
  return {
    fillerCount: found.length, fillerWords: found, hedgeCount,
    wpm, wordCount: tokens.length,
    ...pauseStats(words),
  };
}

// Whisper tends to drop "um/uh" from transcripts unless the prompt itself contains disfluent speech.
const DISFLUENT_PROMPT = "Umm, let me think, like, hmm... Okay, so, uh, here's what I'm, you know, thinking.";

export type Transcript = { text: string; words?: WordTiming[] };

export function isMicrophoneCheck(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:am i audible(?: first of all)?|can you hear me|can you hear this|is my mic working|is this working|testing(?: the)? mic|mic test|can you repeat(?: the question)?|could you repeat(?: the question)?|what was the question)$/.test(normalized);
}

export function looksLikeConversationalQuestion(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = normalized ? normalized.split(" ") : [];
  return words.length <= 24 && (/[?]$/.test(text.trim()) || /^(why|what|how|when|where|who|which|could|can|would|should|do you|does that|did you|i want to know|i meant)/.test(normalized));
}

export async function transcribeBuffer(buffer: Buffer, filename: string): Promise<Transcript> {
  const uint = new Uint8Array(buffer);
  const blob = new Blob([uint], { type: "audio/webm" });
  const file = new File([blob], filename, { type: "audio/webm" });
  const groq = getGroq();

  // Preferred: word timestamps (enables real pause metrics). Falls back to plain text on any error.
  try {
    const resp: any = await groq.audio.transcriptions.create({
      file: file as unknown as File,
      model: MODELS.stt,
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: "en",
      prompt: DISFLUENT_PROMPT,
    } as any);
    const text = String(resp?.text ?? "").trim();
    const words: WordTiming[] | undefined = Array.isArray(resp?.words)
      ? resp.words.map((w: any) => ({ word: String(w.word), start: Number(w.start), end: Number(w.end) }))
      : undefined;
    if (text) return { text, words };
  } catch (e) {
    console.warn("verbose_json transcription failed, falling back to text:", (e as Error).message);
  }

  const resp = await groq.audio.transcriptions.create({
    file: file as unknown as File,
    model: MODELS.stt,
    response_format: "text",
    language: "en",
  });
  return { text: (resp as unknown as string).trim() };
}
