from fastapi.testclient import TestClient

from service import app as appmod
from service.agent.blackboard import Blackboard
from service.agent.llm import ScriptedLLM, call
from .conftest import JD, RESUME
from .test_interviewer import _policy


class PolicyLLM:
    """Per-session scripted policy that inspects the session's own blackboard."""
    def __init__(self):
        self.inner = None
    def chat(self, messages, tools):
        return self.inner.chat(messages, tools)


def make_client():
    holder = PolicyLLM()
    real_create = appmod.InterviewerAgent

    def factory(llm, board, retriever, memory=None, **kw):
        holder.inner = ScriptedLLM(_policy(board))
        return real_create(holder, board, retriever, memory, **kw)

    appmod.InterviewerAgent = factory
    appmod.app.dependency_overrides[appmod.get_llm] = lambda: holder
    return TestClient(appmod.app), lambda: setattr(appmod, "InterviewerAgent", real_create)


def test_session_lifecycle_and_patience_interface():
    client, restore = make_client()
    try:
        r = client.post("/sessions", json={"role": "Backend Engineer", "resume_text": RESUME, "jd_text": JD, "max_turns": 6})
        assert r.status_code == 200
        sid, action = r.json()["session_id"], r.json()["action"]
        assert action["kind"] == "ask"

        p = client.get(f"/sessions/{sid}/patience").json()
        assert p["awaiting_answer"] is True and p["level"] in ("low", "normal", "high") and p["max_hold_s"] > 0

        done, n = False, 0
        while not done:
            resp = client.post(f"/sessions/{sid}/answer", json={"answer": f"my answer {n}", "delivery": {"audio_seconds": 25, "wpm": 150}})
            assert resp.status_code == 200
            done = resp.json()["done"]; n += 1
            assert n < 12

        assert client.post(f"/sessions/{sid}/answer", json={"answer": "late"}).status_code == 409
        rep = client.get(f"/sessions/{sid}/report").json()
        assert rep["questions_asked"] >= 3
        tr = client.get(f"/sessions/{sid}/trace").json()["events"]
        assert any(e["kind"] == "wrap_up" for e in tr) and any(e["actor"] == "tool" for e in tr)
        assert client.get(f"/sessions/{sid}/blackboard").json()["turns_used"] == rep["questions_asked"]
    finally:
        restore(); appmod.app.dependency_overrides.clear()


def test_unknown_session_and_validation():
    client = TestClient(appmod.app)
    assert client.get("/sessions/nope/report").status_code == 404
    assert client.post("/sessions/nope/answer", json={"answer": "x"}).status_code == 404
    assert client.post("/sessions", json={"resume_text": "short"}).status_code == 422
    assert client.get("/health").json()["ok"] is True


def test_llm_failure_becomes_502_not_a_crash():
    from service.agent.llm import LLMError
    class Broken:
        def chat(self, messages, tools):
            raise LLMError("rate limited after retries")
    appmod.app.dependency_overrides[appmod.get_llm] = lambda: Broken()
    try:
        r = TestClient(appmod.app).post("/sessions", json={"resume_text": RESUME, "jd_text": JD})
        assert r.status_code == 502 and "rate limited" in r.json()["error"]
    finally:
        appmod.app.dependency_overrides.clear()


def test_session_store_is_bounded(monkeypatch):
    monkeypatch.setattr(appmod, "MAX_SESSIONS", 2)
    client, restore = make_client()
    try:
        ids = [client.post("/sessions", json={"resume_text": RESUME, "jd_text": JD}).json()["session_id"] for _ in range(4)]
        assert client.get(f"/sessions/{ids[0]}/report").status_code == 404
        assert client.get(f"/sessions/{ids[3]}/patience").status_code == 200
    finally:
        restore(); appmod.app.dependency_overrides.clear()


def test_async_mode_agentic_rag_and_memory_are_reachable_through_the_api(tmp_path, monkeypatch):
    monkeypatch.setattr(appmod, "MEMORY_DIR", str(tmp_path))
    client, restore = make_client()
    try:
        body = {"resume_text": RESUME, "jd_text": JD, "max_turns": 4, "evaluator_mode": "async",
                "agentic_rag": True, "candidate_id": "cand-1"}
        r = client.post("/sessions", json=body)
        assert r.status_code == 200
        sid = r.json()["session_id"]
        agent = appmod.SESSIONS[sid].agent
        assert agent.mode == "async" and type(agent.rag).__name__ == "AgenticRAG"
        done, n = False, 0
        while not done:
            done = client.post(f"/sessions/{sid}/answer", json={"answer": f"my answer {n}"}).json()["done"]; n += 1
            assert n < 12
        rep = client.get(f"/sessions/{sid}/report").json()             # finish(): joins evaluator, writes memory
        assert rep["questions_asked"] >= 3
        assert (tmp_path / "cand-1.json").exists()
        appmod.SESSIONS[sid].agent.close()
    finally:
        restore(); appmod.app.dependency_overrides.clear()


def test_candidate_id_cannot_escape_the_memory_directory():
    client = TestClient(appmod.app)
    for bad in ["../evil", "a/b", "x" * 65, "sp ace", ""]:
        r = client.post("/sessions", json={"resume_text": RESUME, "jd_text": JD, "candidate_id": bad})
        assert r.status_code == 422, bad


def test_report_before_the_interview_ends_does_not_write_memory(tmp_path, monkeypatch):
    monkeypatch.setattr(appmod, "MEMORY_DIR", str(tmp_path))
    client, restore = make_client()
    try:
        sid = client.post("/sessions", json={"resume_text": RESUME, "jd_text": JD, "candidate_id": "c2"}).json()["session_id"]
        client.post(f"/sessions/{sid}/answer", json={"answer": "an answer"})
        assert client.get(f"/sessions/{sid}/report").status_code == 200
        assert not (tmp_path / "c2.json").exists()
    finally:
        restore(); appmod.app.dependency_overrides.clear()
