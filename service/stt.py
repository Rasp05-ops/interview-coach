"""Server-side speech-to-text for the realtime gateway.

The gateway sends cumulative PCM16 audio so Whisper can revise an interim
transcript as the answer grows. The final request is made at turn end.
"""
from __future__ import annotations

import io
import os
import wave
from typing import Protocol

import httpx


class STTError(RuntimeError):
    pass


class StreamingSTT(Protocol):
    def transcribe(self, pcm16: bytes) -> str: ...


def pcm16_wav(pcm16: bytes, sample_rate: int = 16_000) -> bytes:
    """Wrap mono PCM16 samples in a WAV container accepted by Whisper."""
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm16)
    return output.getvalue()


class GroqStreamingSTT:
    URL = "https://api.groq.com/openai/v1/audio/transcriptions"

    def __init__(self, api_key: str, model: str = "whisper-large-v3-turbo", timeout: float = 30.0):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "GroqStreamingSTT | None":
        api_key = os.getenv("GROQ_API_KEY", "").strip()
        return cls(api_key, os.getenv("AGENT_STT_MODEL", "whisper-large-v3-turbo")) if api_key else None

    def transcribe(self, pcm16: bytes) -> str:
        if not pcm16:
            return ""
        response = httpx.post(
            self.URL,
            headers={"Authorization": f"Bearer {self.api_key}"},
            files={"file": ("answer.wav", pcm16_wav(pcm16), "audio/wav")},
            data={"model": self.model, "response_format": "json", "language": "en"},
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise STTError(f"{response.status_code}: {response.text[:300]}")
        try:
            return str(response.json().get("text", "")).strip()
        except (ValueError, AttributeError) as exc:
            raise STTError("speech-to-text returned invalid JSON") from exc