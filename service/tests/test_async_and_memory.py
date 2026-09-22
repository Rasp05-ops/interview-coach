import threading

from service.agent.blackboard import Blackboard, Budget, DeliverySignals
from service.agent.evaluator import Evaluator
from service.agent.interviewer import InterviewerAgent
from service.agent.llm import LLMError, LLMResponse, ScriptedLLM, call
from service.agent.memory import JsonFileMemory, curate
from service.agent.retrieval import InMemoryMemory, Retriever
from service.agent.scoring import build_report
from .conftest import JD, RESUME

PLAN = call("update_plan", competencies=["ownership", "technical_depth", "problem_solving", "communication"])
OPENER = call("ask", question="Tell me about the Kafka pipeline you built at Acme. What did you own?",
              intent="new_topic", competency="ownership", expected_structure="star_story")
NEXT_Q = call("ask", question="How does Kafka keep ordering inside a partition, and where can it break?",
              intent="new_topic", competency="technical_depth", expected_structure="think_aloud")
ANSWER = "I wrote the consumer myself and we cut latency by 40 percent"


class GatedEvaluatorLLM:
    """Evaluator LLM that blocks until the test releases it, then returns a fixed tool-call script."""
    def __init__(self, script):
        self.gate, self.script, self.entered = threading.Event(), list(script), threading.Event()
    def chat(self, messages, tools, tool_choice=None):
        self.entered.set()
        assert self.gate.wait(timeout=5), "evaluator was never released"
        return self.script.pop(0)


def make(mode="async", eval_script=None, **kw):
    board = Blackboard(role="Backend Engineer", company="Acme", budget=Budget(max_turns=4, min_turns_before_wrap=2))
    llm = ScriptedLLM([PLAN, OPENER])
    ev = GatedEvaluatorLLM(eval_script or [])
    agent = InterviewerAgent(llm, board, Retriever(RESUME, JD), evaluator_mode=mode, evaluator_llm=ev, **kw)
    return agent, llm, ev, board


def test_async_interviewer_decides_without_waiting_for_the_evaluator():
    script = [call("log_evidence", competency="ownership", quote="I wrote the consumer myself", score=4, rationale="personal role"),
              call("add_claim", text="cut latency by 40 percent", source="candidate_answer"),
              call("finish_assessment", summary="Clear personal ownership with a number.")]
    agent, llm, ev, board = make(eval_script=script)
    agent.start()
    llm.script = [NEXT_Q]
    action = agent.answer(ANSWER, DeliverySignals(audio_seconds=20, wpm=150))
    # the interviewer already produced its next question while the evaluator is still blocked
    assert action["kind"] == "ask" and action["competency"] == "technical_depth"
    assert ev.entered.wait(timeout=5) and board.evidence == []
    assert len(board.turns) == 2                       # turn 1 is open (unanswered) while evaluating turn 0
    ev.gate.set()
    agent.join_evaluations()
    # evidence + claim are pinned to turn 0 even though the 'latest' turn has moved on
    assert [(e.turn, e.competency, e.score) for e in board.evidence] == [(0, "ownership", 4)]
    assert board.claims[0].turn == 0
    assert any(e.kind == "assessed" for e in board.events)
    agent.close()


def test_evaluator_cannot_log_quotes_from_a_different_turn():
    board = Blackboard(plan=["ownership", "technical_depth"])
    board.open_turn("Question number one please here", "new_topic", "ownership", "open"); board.record_answer("alpha bravo charlie delta echo")
    board.open_turn("Question number two please here", "new_topic", "technical_depth", "open"); board.record_answer("foxtrot golf hotel india juliet")
    ev = GatedEvaluatorLLM([call("log_evidence", competency="ownership", quote="foxtrot golf hotel india juliet", score=5),
                            call("finish_assessment", summary="Nothing verifiable was said here.")])
    ev.gate.set()
    Evaluator(ev, board, Retriever(RESUME, JD)).assess(0)
    assert board.evidence == []                        # quote exists in turn 1, but the evaluator is bound to turn 0


def test_interviewer_cannot_log_evidence_in_async_mode():
    agent, llm, ev, board = make()
    agent.start()
    r = agent.toolbox.execute("log_evidence", {"competency": "ownership", "quote": "I wrote the consumer myself", "score": 3})
    assert not r["ok"] and "unknown tool" in r["error"]
    agent.close()


def test_evaluator_failure_never_breaks_the_session():
    board = Blackboard(role="x", budget=Budget(max_turns=4, min_turns_before_wrap=2))
    class Boom:
        def chat(self, *a, **k): raise LLMError("provider down")
    llm = ScriptedLLM([PLAN, OPENER])
    agent = InterviewerAgent(llm, board, Retriever(RESUME, JD), evaluator_mode="async", evaluator_llm=Boom())
    agent.start(); llm.script = [NEXT_Q]
    assert agent.answer(ANSWER)["kind"] == "ask"
    agent.join_evaluations()
    assert any(e.kind == "failed" and "provider down" in e.payload["error"] for e in board.events)
    assert agent.report()["questions_asked"] == 2      # report still builds, just without evidence
    agent.close()


def test_incomplete_evaluator_is_recorded_not_fatal():
    ev = GatedEvaluatorLLM([LLMResponse(content="no tools")] * 10)
    ev.gate.set()
    board = Blackboard(plan=["ownership", "technical_depth"])
    board.open_turn("Question number one please here", "new_topic", "ownership", "open"); board.record_answer("some words here")
    assert Evaluator(ev, board, Retriever(RESUME, JD), max_steps=3).assess(0) is None
    assert any(e.kind == "incomplete" for e in board.events)


def test_next_answer_waits_for_previous_evaluation_so_ledger_is_complete():
    script = [call("log_evidence", competency="ownership", quote="I wrote the consumer myself", score=4),
              call("finish_assessment", summary="Good ownership evidence here.")]
    agent, llm, ev, board = make(eval_script=script)
    agent.start(); llm.script = [NEXT_Q, call("wrap_up", message="Thanks a lot for your time today.")]
    agent.answer(ANSWER)
    threading.Timer(0.2, ev.gate.set).start()          # release the evaluator shortly after
    agent.answer("Kafka guarantees ordering per partition only")   # must join evaluation of turn 0 first
    assert len(board.evidence) == 1
    snapshot_in_prompt = [m for m in llm.calls[-1] if m["role"] == "user"][0]["content"]
    assert '"avg_rubric": 4.0' in snapshot_in_prompt   # the second decision saw the first answer's evidence
    agent.close()


# ── memory ─────────────────────────────────────────────────────────────────────
def _report_with_gaps():
    b = Blackboard(plan=["ownership", "technical_depth", "problem_solving"])
    b.open_turn("Question number one please here", "new_topic", "ownership", "open"); b.record_answer("I did it", DeliverySignals(audio_seconds=30, wpm=200, filler_count=8))
    b.add_evidence(0, "ownership", "I did it all", 2, ""); b.add_evidence(0, "technical_depth", "some words", 5, "")
    c = b.add_claim("Led ten engineers", "candidate_answer", 0); c.status = "unsupported"
    return build_report(b)


def test_curator_turns_report_into_notes_deterministically():
    notes = curate(_report_with_gaps())
    kinds = {(n["kind"], n["topic"]) for n in notes}
    assert ("weak_spot", "ownership") in kinds and ("claim_issue", "claims") in kinds
    assert ("weak_spot", "filler words") in kinds and ("weak_spot", "speaking pace") in kinds
    assert not any(n["topic"] == "technical_depth" and n["kind"] == "weak_spot" for n in notes)
    assert curate(_report_with_gaps()) == notes


def test_memory_persists_ranks_weak_spots_and_survives_corruption(tmp_path):
    path = str(tmp_path / "cand.json")
    m = JsonFileMemory(path)
    m.add("ownership", "ownership: level 2.0", "weak_spot", ts=1); m.add("ownership", "ownership: level 2.5", "weak_spot", ts=2)
    m.add("communication", "communication: level 2.0", "weak_spot", ts=3)
    m2 = JsonFileMemory(path)                                    # new process, same file
    top = m2.weak_spots()
    assert top[0]["topic"] == "ownership" and top[0]["count"] == 2 and top[1]["topic"] == "communication"
    assert m2.recall("ownership")
    (tmp_path / "bad.json").write_text("{not json")
    assert JsonFileMemory(str(tmp_path / "bad.json")).notes == []


def test_finish_writes_memory_once_and_next_session_prioritises_weak_spots(tmp_path):
    mem = JsonFileMemory(str(tmp_path / "cand.json"))
    board = Blackboard(role="x", budget=Budget(max_turns=4, min_turns_before_wrap=1))
    llm = ScriptedLLM([PLAN, OPENER, call("log_evidence", competency="ownership", quote="I did it all", score=2),
                       call("wrap_up", message="Thanks a lot for your time today.")])
    agent = InterviewerAgent(llm, board, Retriever(RESUME, JD), memory=mem)
    agent.start(); agent.answer("I did it all"); agent.finish(); agent.finish()
    assert [n["topic"] for n in mem.notes if n["kind"] == "weak_spot"].count("ownership") == 1   # idempotent
    llm2 = ScriptedLLM([PLAN, OPENER])
    b2 = Blackboard(role="x")
    InterviewerAgent(llm2, b2, Retriever(RESUME, JD), memory=JsonFileMemory(str(tmp_path / "cand.json"))).start()
    first_user_msg = [m for m in llm2.calls[0] if m["role"] == "user"][0]["content"]
    assert "weak spots" in first_user_msg and "ownership" in first_user_msg
