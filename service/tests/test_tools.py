from service.agent.blackboard import Blackboard, Budget
from service.agent.tools import quote_in_text
from .conftest import answer, ask


def test_ask_requires_plan(board, retriever):
    from service.agent.tools import ToolBox
    tb = ToolBox(board, retriever)
    r = ask(tb, "Tell me about a project you own end to end.")
    assert not r["ok"] and "update_plan" in r["error"]


def test_expected_structure_sets_patience_for_turn_taking(box):
    r = ask(box, "Estimate how many requests per second we would need to handle.", comp="problem_solving", structure="think_aloud")
    assert r["ok"]
    assert box.board.patience.level == "high" and box.board.patience.max_hold_s > 5
    answer(box, "So, let me think about this, assuming a million users")
    r = ask(box, "What is your favourite programming language and why?", comp="communication", structure="short_answer")
    assert box.board.patience.level == "low" and box.board.patience.max_hold_s < 5


def test_followups_need_a_prior_answer(box):
    ask(box, "Tell me about a project you own end to end.")
    r = ask(box, "Can you quantify that improvement for me please?", intent="probe")
    assert not r["ok"]  # unanswered question pending


def test_probe_depth_limit_enforced_in_code(box):
    assert ask(box, "Tell me about a project you own end to end.")["ok"]
    answer(box, "We built a pipeline")
    assert ask(box, "What exactly did you personally build there?", intent="probe")["ok"]
    answer(box, "I wrote the consumer")
    assert ask(box, "How did you measure the latency improvement?", intent="probe")["ok"]
    answer(box, "With dashboards")
    r = ask(box, "Which dashboards, and who looked at them?", intent="probe")
    assert not r["ok"] and "follow-up limit" in r["error"]
    # moving to a new topic is allowed and resets the streak
    assert ask(box, "Estimate the throughput a service needs for a million daily users.", comp="problem_solving", structure="think_aloud")["ok"]


def test_duplicate_questions_rejected(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "the pipeline")
    r = ask(box, "Tell me about a project you own end to end?", comp="technical_depth")
    assert not r["ok"] and "repeat" in r["error"]


def test_question_budget_then_wrap_up(box):
    for i, q in enumerate(["Tell me about a project you own end to end.",
                           "How does Kafka guarantee ordering within a partition?",
                           "Estimate throughput for a million daily users.",
                           "Explain one project to a non-technical friend."]):
        assert ask(box, q, comp=["ownership", "technical_depth", "problem_solving", "communication"][i])["ok"]
        answer(box, "answer " + str(i))
    r = ask(box, "One more question about something new please.", comp="ownership")
    assert not r["ok"] and "wrap_up" in r["error"]
    assert box.execute("wrap_up", {"message": "Thanks, that's everything for today."})["ok"]
    assert box.board.done


def test_wrap_up_too_early_rejected(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "the pipeline")
    r = box.execute("wrap_up", {"message": "Thanks, that is all from me today."})
    assert not r["ok"] and "too early" in r["error"]


def test_time_budget_forces_wrap_up(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "the pipeline")
    box.board.started_at -= box.board.budget.max_session_seconds + 5
    assert not ask(box, "Tell me about a hard bug you fixed recently.", comp="problem_solving")["ok"]
    assert box.execute("wrap_up", {"message": "We are out of time, thanks so much."})["ok"]


def test_cannot_ask_while_previous_unanswered(box):
    ask(box, "Tell me about a project you own end to end.")
    r = ask(box, "How does Kafka guarantee ordering exactly?", comp="technical_depth")
    assert not r["ok"] and "not been answered" in r["error"]


# ── evidence integrity ─────────────────────────────────────────────────────────
def test_log_evidence_rejects_invented_quotes(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "I built the Kafka consumer myself and we cut latency by 40 percent")
    bad = box.execute("log_evidence", {"competency": "ownership", "quote": "I led a team of twelve engineers", "score": 5})
    assert not bad["ok"] and "not found" in bad["error"]
    assert box.board.evidence == []


def test_log_evidence_accepts_verbatim_quote_and_scores_it(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "I built the Kafka consumer myself and we cut latency by 40 percent")
    ok = box.execute("log_evidence", {"competency": "Ownership", "quote": "I built the Kafka consumer myself", "score": 4})
    assert ok["ok"] and len(box.board.evidence) == 1 and box.board.evidence[0].competency == "ownership"


def test_log_evidence_rejects_unknown_competency_and_bad_score(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "I built the Kafka consumer myself")
    assert not box.execute("log_evidence", {"competency": "juggling", "quote": "I built the Kafka consumer", "score": 3})["ok"]
    r = box.execute("log_evidence", {"competency": "ownership", "quote": "I built the Kafka consumer", "score": 9})
    assert not r["ok"] and "invalid arguments" in r["error"]


def test_quote_matching_supports_ellipsis_and_rejects_paraphrase():
    text = "we built a pipeline in Kafka and then our latency dropped a lot"
    assert quote_in_text("built a pipeline ... latency dropped", text)[0]
    assert not quote_in_text("we reduced delays significantly", text)[0]


# ── claims / retrieval tools ───────────────────────────────────────────────────
def test_check_consistency_flags_numbers_not_on_resume(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "I cut Kafka latency by 90 percent")
    cid = box.execute("add_claim", {"text": "Cut Kafka latency by 90 percent", "source": "candidate_answer"})["id"]
    r = box.execute("check_consistency", {"claim_id": cid})
    assert r["ok"] and r["numeric_mismatch"] is True and r["spans"]
    assert box.execute("resolve_claim", {"id": cid, "status": "contradicted", "note": "resume says 40"})["ok"]
    assert box.board.get_claim(cid).status == "contradicted"


def test_check_consistency_passes_matching_numbers(box):
    ask(box, "Tell me about a project you own end to end.")
    answer(box, "cut latency by 40 percent")
    cid = box.execute("add_claim", {"text": "Kafka pipeline cut latency by 40 percent", "source": "candidate_answer"})["id"]
    assert box.execute("check_consistency", {"claim_id": cid})["numeric_mismatch"] is False


def test_unknown_tool_and_bad_args_never_raise(box):
    assert not box.execute("rm_rf", {})["ok"]
    assert not box.execute("search_resume", {})["ok"]  # missing required arg


def test_interject_requires_open_question(box):
    assert not box.execute("interject", {"message": "Let me stop you there for a moment."})["ok"]
    ask(box, "Tell me about a project you own end to end.")
    assert box.execute("interject", {"message": "Let me stop you there for a moment."})["ok"]


def test_search_resume_says_when_nothing_found(box):
    r = box.execute("search_resume", {"query": "zzzz qqqq"})
    assert r["ok"] and r["spans"] == [] and "invent" in r["note"].lower()


def test_tool_schemas_are_valid_function_definitions(box):
    for s in box.schemas():
        assert s["type"] == "function" and s["function"]["name"] and s["function"]["parameters"]["type"] == "object"
        assert "$defs" not in s["function"]["parameters"]  # keep schemas flat for provider compatibility
