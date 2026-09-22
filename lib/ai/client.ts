import Groq from "groq-sdk";

let _groq: Groq | null = null;

export function getGroq(): Groq {
  if (!_groq) {
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

export const MODELS = {
  chat: "openai/gpt-oss-120b",
  fast: "openai/gpt-oss-20b",
  stt:  "whisper-large-v3-turbo",
} as const;
