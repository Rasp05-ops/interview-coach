"""HTTP surface for the agent core (text mode). The Next.js client and, later, the realtime
audio gateway both talk to this. `GET /sessions/{id}/patience` is the agent -> turn-taking
interface: the EOT engine reads it to know how long to tolerate silence for the current question."""
from __future__ import annotations

import os
import re
import threading
import uuid
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .agent.blackboard import Blackboard, Budget, DeliverySignals
from .agent.interviewer import InterviewerAgent
from .agent.llm import LLM, GroqChat, LLMError, ScriptedLLM
from .agent.memory import JsonFileMemory
from .agent.retrieval import Retriever
from .gateway import run_gateway
from .eot import run_eot

app = FastAPI(title="Interview agent service", version="0.1.0")


class Session:
    def __init__(self, agent: InterviewerAgent):
        self.agent = agent
        self.lock = threading.Lock()


SESSIONS: dict[str, Session] = {}
MAX_SESSIONS = 200   # in-memory store; evict oldest so a long-running process cannot grow without bound


@app.exception_handler(LLMError)
async def llm_error_handler(_: Request, exc: LLMError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"error": f"LLM provider error: {exc}"})


# AGENT_DRY_RUN=1 swaps the model for a scripted (non-LLM) interviewer so the UI/gateway can be exercised offline.
DRY_RUN = os.getenv("AGENT_DRY_RUN") == "1"
MEMORY_DIR = os.getenv("AGENT_MEMORY_DIR", ".data/memory")
_CANDIDATE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def get_llm() -> LLM:
    return GroqChat()


class StartReq(BaseModel):
    role: str = "Software Engineer"
    company: str = ""
    company_context: str = ""
    resume_text: str = Field(min_length=20)
    jd_text: str = ""
    max_turns: int = Field(8, ge=3, le=15)
    evaluator_mode: Literal["inline", "async"] = "inline"
    agentic_rag: bool = False
    candidate_id: Optional[str] = Field(None, description="Enables cross-session memory (weak spots) for this candidate.")


class AnswerReq(BaseModel):
    answer: str = Field(min_length=1)
    delivery: Optional[DeliverySignals] = None


def _session(session_id: str) -> Session:
    s = SESSIONS.get(session_id)
    if s is None:
        raise HTTPException(404, "session not found")
    return s


@app.get("/health")
def health() -> dict:
    return {"ok": True, "sessions": len(SESSIONS)}


@app.post("/sessions")
def create_session(req: StartReq, llm: LLM = Depends(get_llm)) -> dict:
    if req.candidate_id is not None and not _CANDIDATE_ID.match(req.candidate_id):
        raise HTTPException(422, "candidate_id must be 1-64 chars of letters, digits, '_' or '-'")
    board = Blackboard(role=req.role, company=req.company, company_context=req.company_context, budget=Budget(max_turns=req.max_turns))
    memory = JsonFileMemory(os.path.join(MEMORY_DIR, f"{req.candidate_id}.json")) if req.candidate_id else None
    if DRY_RUN:
        from .eval.policies import probing_policy
        llm = ScriptedLLM(probing_policy(board))
    agent = InterviewerAgent(llm, board, Retriever(req.resume_text, req.jd_text), memory,
                             evaluator_mode=req.evaluator_mode, agentic_rag=req.agentic_rag)
    sid = uuid.uuid4().hex
    sess = Session(agent)
    with sess.lock:
        action = agent.start()
    SESSIONS[sid] = sess
    while len(SESSIONS) > MAX_SESSIONS:
        SESSIONS.pop(next(iter(SESSIONS)))
    return {"session_id": sid, "action": action, "done": board.done}


@app.post("/sessions/{session_id}/answer")
def answer(session_id: str, req: AnswerReq) -> dict:
    sess = _session(session_id)
    with sess.lock:
        board = sess.agent.board
        if board.done:
            raise HTTPException(409, "interview already finished")
        if board.pending_turn() is None:
            raise HTTPException(409, "no open question to answer")
        action = sess.agent.answer(req.answer, req.delivery)
        return {"action": action, "done": board.done}


@app.get("/sessions/{session_id}/patience")
def patience(session_id: str) -> dict:
    board = _session(session_id).agent.board
    pending = board.pending_turn()
    return {**board.patience.model_dump(), "awaiting_answer": pending is not None,
            "turn_index": pending.index if pending else None}


@app.get("/sessions/{session_id}/report")
def report(session_id: str) -> dict:
    sess = _session(session_id)
    with sess.lock:
        # finish() also writes curated notes to memory (once); only do that when the interview is actually over
        return sess.agent.finish() if sess.agent.board.done else sess.agent.report()


@app.get("/sessions/{session_id}/blackboard")
def blackboard(session_id: str) -> dict:
    return _session(session_id).agent.board.snapshot()


@app.get("/sessions/{session_id}/trace")
def trace(session_id: str) -> dict:
    return {"events": [e.model_dump() for e in _session(session_id).agent.board.events]}


@app.websocket("/ws/{session_id}")
async def ws_endpoint(ws: WebSocket, session_id: str) -> None:
    sess = SESSIONS.get(session_id)
    if sess is None:
        await ws.close(code=4404)
        return
    await run_gateway(ws, sess)


@app.websocket("/ws/eot")
async def eot_endpoint(ws: WebSocket) -> None:
    await run_eot(ws)
