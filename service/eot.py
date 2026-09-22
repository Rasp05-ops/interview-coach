"""Standalone Smart Turn WebSocket for the main browser interview recorder."""
from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

from .turn.engine import TurnEngine
from .turn.smart_turn import SmartTurnONNX


_smart_turn: Optional[SmartTurnONNX] = None
_smart_turn_attempted = False


def get_smart_turn() -> Optional[SmartTurnONNX]:
    global _smart_turn, _smart_turn_attempted
    if _smart_turn_attempted:
        return _smart_turn
    _smart_turn_attempted = True
    try:
        _smart_turn = SmartTurnONNX()
    except Exception:
        _smart_turn = None
    return _smart_turn


async def run_eot(ws: WebSocket) -> None:
    await ws.accept()
    smart_turn = get_smart_turn()
    engine = TurnEngine(
        lambda: {"level": "normal", "max_hold_s": 2.5, "expected_structure": "open"},
        smart_turn=smart_turn,
    )
    await ws.send_json({"type": "ready", "model": "smart-turn-v3" if smart_turn else "energy-fallback"})
    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("bytes") is not None:
                for event in engine.feed(message["bytes"]):
                    await ws.send_json(event)
                    if event.get("type") == "decision" and event.get("decision") == "end":
                        await ws.close()
                        return
            elif message.get("text") is not None:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "reset":
                    engine.reset_turn()
                elif data.get("type") == "end":
                    await ws.send_json({"type": "decision", "decision": "end", "reason": "client_end"})
                    await ws.close()
                    return
    except WebSocketDisconnect:
        return
    except asyncio.CancelledError:
        return
