import json

from service.agent.blackboard import Blackboard, Budget, DeliverySignals
from service.agent.interviewer import InterviewerAgent
from service.agent.llm import LLMResponse, ScriptedLLM, ToolCall, call
from service.agent.retrieval import Retriever
from .conftest import JD, RESUME

PLAN = call("update_plan", competencies=["ownership", "technical_depth", "problem_solving", "communication"])
OPENER = call("ask", question="Tell me about the Kafka pipeline you built at Acme. What did you own?",
              intent="new_topic", competency="ownership", expected_structure="star_story")

def test_vague_answer_gets_an_explicit_signal_in_the_prompt():
    agent, llm, board = make_agent([PLAN, OPENER])
    agent.start()
    llm.script = [call("wrap_up", message="Thanks for your time today, goodbye.")]
    agent.answer("Yeah, we worked on it as a team and it went pretty well overall.")
    user_msg = [m for m in llm.calls[-1] if m["role"] == "user"][0]["content"]
    assert "SIGNAL: this answer looks vague" in user_msg


def test_specific_answer_gets_no_vagueness_signal():
    agent, llm, board = make_agent([PLAN, OPENER])
    agent.start()
    llm.script = [call("wrap_up", message="Thanks for your time today, goodbye.")]
    agent.answer("I built the Redis layer myself, cutting latency by 40 percent and query time by 25 percent.")
    user_msg = [m for m in llm.calls[-1] if m["role"] == "user"][0]["content"]
    assert "SIGNAL: this answer looks vague" not in user_msg

def make_agent(script, evaluator_mode="inline", **budget):
    board = Blackboard(role="Backend Engineer", company="Acme",
                       budget=Budget(**{"max_turns": 4, "min_turns_before_wrap": 2, **budget}))
    llm = ScriptedLLM(script)
    return InterviewerAgent(llm, board, Retriever(RESUME, JD), evaluator_mode=evaluator_mode,
                            evaluator_llm=llm if evaluator_mode == "async" else None), llm, board


def test_async_prompt_never_instructs_log_evidence():
    # log_evidence isn't in the async toolset (a separate evaluator calls it) — the prompt must not tell the
    # model to call it anyway, or Groq rejects the tool call with a 400 ("not in request.tools"), as happened
    # in a live run.
    agent, llm, board = make_agent([PLAN, OPENER], evaluator_mode="async")
    agent.start()
    system_msg = llm.calls[-1][0]["content"]
    assert "ALWAYS call `log_evidence`" not in system_msg
    offered_tools = {s["function"]["name"] for s in agent.toolbox.schemas()}
    assert "log_evidence" not in offered_tools  # the bug: prompt told the model to call a tool not on offer


def test_inline_prompt_still_instructs_log_evidence():
    agent, llm, board = make_agent([PLAN, OPENER], evaluator_mode="inline")
    agent.start()
    system_msg = llm.calls[-1][0]["content"]
    assert "ALWAYS call `log_evidence`" in system_msg


def test_start_plans_retrieves_then_asks():
    agent, llm, board = make_agent([PLAN, call("search_resume", query="kafka pipeline"), OPENER])
    action = agent.start()
    assert action["kind"] == "ask" and action["intent"] == "opener"
    assert board.plan[0] == "ownership" and len(llm.calls) == 3
    assert board.patience.expected_structure == "star_story"
    # the retrieval result was actually fed back to the model
    tool_msgs = [m for m in llm.calls[-1] if m["role"] == "tool"]
    assert any("40 percent" in m["content"] for m in tool_msgs)


def test_model_can_recover_from_rejected_evidence():
    agent, llm, board = make_agent([PLAN, OPENER])
    agent.start()
    llm.script = [
        call("log_evidence", competency="ownership", quote="I led twelve engineers across three teams", score=5),   # invented
        call("log_evidence", competency="ownership", quote="I wrote the consumer myself", score=3, rationale="personal role, no numbers"),
        call("add_claim", text="cut latency by 90 percent", source="candidate_answer"),
        call("check_consistency", claim_id="c1"),
        call("ask", question="Your resume says 40 percent. Where does 90 come from?", intent="challenge",
             competency="ownership", expected_structure="short_answer"),
    ]
    action = agent.answer("I wrote the consumer myself and cut latency by 90 percent",
                          DeliverySignals(audio_seconds=20, wpm=150, filler_count=1))
    assert action["intent"] == "challenge"
    assert len(board.evidence) == 1 and board.evidence[0].score == 3       # invented quote never stored
    msgs = llm.calls[3]              # calls[0:2] belong to start(); calls[2] is answer() step 0, calls[3] is step 1
    assert any("quote not found" in m.get("content", "") for m in msgs if m["role"] == "tool")
    assert board.patience.level == "low"                                    # short_answer -> impatient turn-taking


def test_only_one_speaking_action_per_decision():
    both = LLMResponse(tool_calls=[ToolCall("update_plan", {"competencies": ["ownership", "technical_depth"]}, "1"),
                                   ToolCall("ask", OPENER.tool_calls[0].arguments, "2"),
                                   ToolCall("wrap_up", {"message": "Thanks, we are done here."}, "3")])
    agent, _, board = make_agent([both])
    agent.start()
    assert not board.done and len(board.turns) == 1


def test_model_that_never_uses_tools_gets_deterministic_fallback():
    agent, llm, board = make_agent(lambda m, t: LLMResponse(content="Sure! Great question."))
    action = agent.start()
    assert action["kind"] == "ask" and action["intent"] in ("opener", "new_topic")
    assert len(llm.calls) == board.budget.max_llm_steps_per_decision          # bounded, no infinite loop
    assert any(e.kind == "fallback" for e in board.events)


def test_persistently_invalid_calls_hit_step_cap_then_fallback():
    agent, llm, board = make_agent([PLAN, OPENER])
    agent.start()
    llm.script = lambda m, t: call("ask", question="Tell me about the Kafka pipeline you built at Acme?",
                                    intent="probe", competency="ownership", expected_structure="open")
    action = agent.answer("I built it")          # model keeps asking a near-duplicate; guardrails keep refusing
    assert len(llm.calls) <= 1 + board.budget.max_llm_steps_per_decision + 1
    assert action["kind"] in ("ask", "wrap_up")
    assert action["text"] != OPENER.tool_calls[0].arguments["question"] or action.get("fallback")


def test_exhausted_budget_forces_wrap_up_via_fallback():
    agent, llm, board = make_agent([PLAN, OPENER], max_turns=1, min_turns_before_wrap=1)
    agent.start()
    llm.script = lambda m, t: LLMResponse(content="hmm")
    action = agent.answer("I built the whole thing")
    assert action["kind"] == "wrap_up" and board.done


def test_prompt_state_is_compact_not_full_transcript():
    agent, llm, board = make_agent([PLAN, OPENER])
    agent.start()
    long_answer = "word " * 300
    llm.script = [call("wrap_up", message="Thanks for your time today, goodbye.")]
    agent.answer(long_answer)
    user_msg = [m for m in llm.calls[-1] if m["role"] == "user"][0]["content"]
    assert user_msg.count("Candidate answer") == 1
    assert '"recent"' in user_msg and len(user_msg) < len(long_answer) + 1500


from service.eval.policies import baseline_policy as _policy_impl


def _policy(board):
    return _policy_impl(board, wrap_after=5)


def test_full_interview_runs_to_completion_within_bounds():
    board = Blackboard(role="Backend Engineer", budget=Budget(max_turns=6, min_turns_before_wrap=3))
    llm = ScriptedLLM(_policy(board))
    agent = InterviewerAgent(llm, board, Retriever(RESUME, JD))
    action = agent.start()
    guard = 0
    while action["kind"] != "wrap_up":
        action = agent.answer(f"answer number {guard} about my work", DeliverySignals(audio_seconds=30, wpm=140))
        guard += 1
        assert guard < 12
    assert board.done and 3 <= board.answered_count() <= 6
    rep = agent.report()
    assert rep["questions_asked"] == len(board.turns) and rep["delivery"]["answers"] == board.answered_count()
    # every LLM decision is bounded
    assert len(llm.calls) <= (guard + 1) * board.budget.max_llm_steps_per_decision