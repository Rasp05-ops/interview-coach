"""Realtime gateway: binds the streaming TurnEngine to an interview session over a WebSocket.

Client -> server: binary frames = 16 kHz mono PCM16 audio; text frames = JSON
    {"type": "transcript", "text": "<cumulative transcript of the current answer>"}  (optional client STT)
    {"type": "end"}  (submit the current answer immediately)
    {"type": "reset"}
Server -> client: JSON events: ready, speech_start, pause_start, resumed, decision{hold|prompt|end}, no_transcript,
    transcript, stt_error, action{...}, done.

On an END decision the accumulated transcript is submitted to the interviewer; its next action is sent back and
the engine is reset with the NEW question's patience. Server-side Whisper receives cumulative audio periodically so
the client does not need to ship a separate speech-to-text implementation."""
from __future__ import annotations

import asyncio
import json
import re
from typing import Callable

from fastapi import WebSocket, WebSocketDisconnect

from .agent.blackboard import DeliverySignals
from .stt import GroqStreamingSTT, StreamingSTT
from .turn.engine import TurnEngine

_FILLERS = re.compile(r"\b(um+|uh+|er+m?|hmm+|you know|i mean)\b", re.I)


def count_fillers(text: str) -> int:
    return len(_FILLERS.findall(text))


def delivery_from(engine: TurnEngine, text: str) -> DeliverySignals:
    st = engine.stats()
    words = len(text.split())
    return DeliverySignals(audio_seconds=st["audio_seconds"], wpm=round(words / max(st["speech_seconds"], 0.5) * 60),
                           filler_count=count_fillers(text), long_pause_count=st["long_pause_count"],
                           longest_pause_s=st["longest_pause_s"], first_word_delay_s=st["first_word_delay_s"],
                           eot_probability=st["eot_probability"])


async def run_gateway(ws: WebSocket, sess, engine_factory: Callable[..., TurnEngine] = TurnEngine,
                      stt_factory: Callable[[], StreamingSTT | None] = GroqStreamingSTT.from_env) -> None:
    await ws.accept()
    board = sess.agent.board
    engine = engine_factory(lambda: board.patience.model_dump())
    transcript = ""
    audio = bytearray()
    stt = stt_factory()
    stt_task: asyncio.Task[str] | None = None
    stt_interval_bytes = 16_000 * 2  # one second of 16 kHz mono PCM16
    pending = board.pending_turn()
    await ws.send_json({"type": "ready", "question": pending.question if pending else None,
                        "patience": board.patience.model_dump(), "done": board.done})
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                return
            events: list[dict] = []
            force_end = False
            if msg.get("bytes") is not None:
                chunk = msg["bytes"]
                audio.extend(chunk)
                events = engine.feed(chunk)
                if stt is not None and len(audio) >= stt_interval_bytes and stt_task is None:
                    stt_task = asyncio.create_task(asyncio.to_thread(stt.transcribe, bytes(audio)))
            elif msg.get("text") is not None:
                try:
                    data = json.loads(msg["text"])
                except ValueError:
                    continue
                if data.get("type") == "transcript":
                    transcript = str(data.get("text", ""))
                    engine.set_transcript(transcript)
                elif data.get("type") == "reset":
                    transcript = ""
                    audio.clear()
                    if stt_task is not None:
                        stt_task.cancel()
                        stt_task = None
                    engine.reset_turn()
                elif data.get("type") == "end":
                    force_end = True
            if stt_task is not None and stt_task.done():
                try:
                    interim = stt_task.result()
                    if interim:
                        transcript = interim
                        engine.set_transcript(transcript)
                        await ws.send_json({"type": "transcript", "text": transcript, "final": False})
                except asyncio.CancelledError:
                    pass
                except Exception as exc:
                    await ws.send_json({"type": "stt_error", "error": str(exc)})
                    stt = None
                stt_task = None
            if force_end:
                events.append({"type": "decision", "decision": "end", "reason": "client_end",
                               "silence_s": 0.0, "p_end": engine.stats()["eot_probability"],
                               "patience": board.patience.level})
            for ev in events:
                await ws.send_json(ev)
                if ev.get("type") == "decision" and ev.get("decision") == "end":
                    if stt is not None:
                        if stt_task is not None:
                            try:
                                interim = await stt_task
                                if interim:
                                    transcript = interim
                            except Exception as exc:
                                await ws.send_json({"type": "stt_error", "error": str(exc)})
                        try:
                            final_text = await asyncio.to_thread(stt.transcribe, bytes(audio))
                            if final_text:
                                transcript = final_text
                            await ws.send_json({"type": "transcript", "text": transcript, "final": True})
                        except Exception as exc:
                            await ws.send_json({"type": "stt_error", "error": str(exc)})
                    text = transcript.strip()
                    if not text:
                        await ws.send_json({"type": "no_transcript"})
                        engine.reset_turn()
                        break
                    delivery = delivery_from(engine, text)

                    def _answer():
                        with sess.lock:
                            return sess.agent.answer(text, delivery)
                    action = await asyncio.to_thread(_answer)
                    await ws.send_json({"type": "action", "action": action, "done": board.done})
                    if board.done:
                        await ws.send_json({"type": "done"})
                        await ws.close()
                        return
                    transcript = ""
                    audio.clear()
                    stt_task = None
                    engine.reset_turn()
                    break
    except WebSocketDisconnect:
        return
