import pytest

from service.agent.blackboard import Blackboard, Budget
from service.agent.retrieval import Retriever
from service.agent.tools import ToolBox

RESUME = """EXPERIENCE
Backend intern at Acme Corp. Built a Kafka ingestion pipeline that cut end-to-end latency by 40 percent.
Owned the on-call runbook for the payments service.

PROJECTS
EOT detection: logistic regression on prosody features (energy, pitch, filler detection) for voice agent turn-taking.
Codebase onboarding assistant using LangGraph, FastAPI and pgvector.

SKILLS
Python, C++, PyTorch, SQL
"""
JD = "We are hiring a backend engineer. You will build streaming data pipelines with Kafka and Python and own services in production."


@pytest.fixture
def board():
    return Blackboard(role="Backend Engineer", company="Acme", budget=Budget(max_turns=4, min_turns_before_wrap=2))


@pytest.fixture
def retriever():
    return Retriever(RESUME, JD)


@pytest.fixture
def box(board, retriever):
    tb = ToolBox(board, retriever)
    tb.execute("update_plan", {"competencies": ["ownership", "technical_depth", "problem_solving", "communication"]})
    return tb


def ask(box, q, intent="new_topic", comp="ownership", structure="star_story"):
    return box.execute("ask", {"question": q, "intent": intent, "competency": comp, "expected_structure": structure})


def answer(box, text):
    box.board.record_answer(text)
