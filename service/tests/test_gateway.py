import numpy as np

from service import app as appmod
from service.tests.test_api import make_client
from service.tests.test_turn import DONE, UNFINISHED, pcm, quiet, voiced
from .conftest import JD, RESUME


def _stream(ws, audio, chunk=1600):
    for i in range(0, len(audio), chunk):
        ws.send_bytes(pcm(audio[i:i + chunk]))


def _until(ws, kind, limit=400):
    seen = []
    for _ in range(limit):
        m = ws.receive_json()
        seen.append(m)
        if m["type"] == kind:
            return seen
    raise AssertionError(f"never received {kind}: {[m['type'] for m in seen][-8:]}")


def test_audio_in_to_next_question_out_and_patience_follows_the_agents_question():
    client, restore = make_client()
    try:
        sid = client.post("/sessions", json={"resume_text": RESUME, "jd_text": JD, "max_turns": 6}).json()["session_id"]
        with client.websocket_connect(f"/ws/{sid}") as ws:
            ready = ws.receive_json()
            assert ready["type"] == "ready" and ready["patience"]["expected_structure"] == "star_story"

            ws.send_text('{"type": "transcript", "text": "%s"}' % DONE)
            _stream(ws, np.concatenate([quiet(0.3), voiced(1.5), quiet(3.0)]))
            first = _until(ws, "action")
            ends = [m for m in first if m["type"] == "decision" and m["decision"] == "end"]
            assert ends and ends[0]["silence_s"] <= 1.6                     # finished-sounding star answer: prompt END
            assert first[-1]["action"]["kind"] == "ask" and first[-1]["action"]["turn_index"] == 1

            # the agent's SECOND question declares think_aloud -> engine now waits much longer for an unfinished clause
            assert client.get(f"/sessions/{sid}/patience").json()["level"] == "high"
            ws.send_text('{"type": "transcript", "text": "%s"}' % UNFINISHED)
            _stream(ws, np.concatenate([quiet(0.3), voiced(1.5), quiet(4.0)]))
            second = _until(ws, "action")
            holds = [m for m in second if m["type"] == "decision" and m["decision"] == "hold"]
            end2 = [m for m in second if m["type"] == "decision" and m["decision"] == "end"][0]
            assert holds and end2["silence_s"] >= 2.0 and end2["patience"] == "high"
            assert end2["silence_s"] > ends[0]["silence_s"]
    finally:
        restore(); appmod.app.dependency_overrides.clear()


def test_end_without_transcript_does_not_submit_an_answer():
    client, restore = make_client()
    try:
        sid = client.post("/sessions", json={"resume_text": RESUME, "jd_text": JD}).json()["session_id"]
        with client.websocket_connect(f"/ws/{sid}") as ws:
            ws.receive_json()
            _stream(ws, np.concatenate([quiet(0.3), voiced(1.0), quiet(12.0)]))     # hard cap ends the turn with no STT text
            _until(ws, "no_transcript")
        assert client.get(f"/sessions/{sid}/patience").json()["awaiting_answer"] is True
    finally:
        restore(); appmod.app.dependency_overrides.clear()


def test_unknown_session_websocket_is_rejected():
    import pytest
    from starlette.websockets import WebSocketDisconnect
    client = __import__("fastapi.testclient", fromlist=["TestClient"]).TestClient(appmod.app)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/nope"):
            pass
