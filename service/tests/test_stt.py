import io
import wave

import httpx

from service.stt import GroqStreamingSTT, pcm16_wav


def test_pcm16_wav_has_expected_mono_16khz_header():
    payload = pcm16_wav(b"\x00\x01" * 160)
    with wave.open(io.BytesIO(payload), "rb") as wav:
        assert wav.getnchannels() == 1
        assert wav.getframerate() == 16_000
        assert wav.getsampwidth() == 2
        assert wav.getnframes() == 160


def test_groq_stt_posts_wav_and_returns_text(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return httpx.Response(200, json={"text": "  hello there  "})

    monkeypatch.setattr("service.stt.httpx.post", fake_post)
    result = GroqStreamingSTT("test-key").transcribe(b"\x00\x00")

    assert result == "hello there"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["files"]["file"][2] == "audio/wav"
    assert captured["data"]["model"] == "whisper-large-v3-turbo"