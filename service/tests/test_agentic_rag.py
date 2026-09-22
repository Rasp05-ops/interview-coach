import pytest

from service.agent.agentic_rag import AgenticRAG, StaticRAG
from service.agent.llm import LLMError, ScriptedLLM, call
from service.agent.retrieval import Retriever
from service.eval.rag_bench import ITEMS, JD, RESUME, evaluate

PARAPHRASE = "I decreased paging noise by a quarter"
PLAN = lambda *q, source="resume": call("plan_queries", queries=list(q), source=source)


@pytest.fixture
def retr():
    return Retriever(RESUME, JD)


def _gold_id(retr, needle):
    return next(s.id for s in retr.resume.spans if needle in s.text)


def test_static_misses_a_paraphrase_that_the_agentic_loop_recovers(retr):
    static = StaticRAG(retr).retrieve(PARAPHRASE, "verify_claim")
    assert not static.sufficient and static.spans == []
    gid = _gold_id(retr, "pager alerts")
    llm = ScriptedLLM([PLAN("pager alerts 25 percent"),
                       call("grade_evidence", sufficient=True, relevant_ids=[gid], conflicts=[], missing="")])
    pack = AgenticRAG(llm, retr, fast_path_coverage=None).retrieve(PARAPHRASE, "verify_claim")
    assert pack.sufficient and "pager alerts" in pack.spans[0]["text"]
    assert pack.rounds == 1 and pack.llm_calls == 2 and pack.mode == "agentic"
    assert llm.tool_choices == ["plan_queries", "grade_evidence"]     # structured steps are forced, not left to chance


def test_retry_uses_grader_feedback_and_is_bounded(retr):
    gid = _gold_id(retr, "pager alerts")
    llm = ScriptedLLM([PLAN("noise"), call("grade_evidence", sufficient=False, relevant_ids=[], missing="alerts and numbers"),
                       PLAN("pager alerts 25 percent"), call("grade_evidence", sufficient=True, relevant_ids=[gid])])
    pack = AgenticRAG(llm, retr, fast_path_coverage=None).retrieve(PARAPHRASE, "verify_claim")
    assert pack.sufficient and pack.rounds == 2 and pack.llm_calls == 4
    assert "alerts and numbers" in llm.calls[2][1]["content"]           # feedback reached the planner


def test_gives_up_after_max_rounds_and_says_insufficient(retr):
    llm = ScriptedLLM(lambda m, t: PLAN("zzz") if len(llm.calls) % 2 == 1
                      else call("grade_evidence", sufficient=False, relevant_ids=[], missing="nothing"))
    pack = AgenticRAG(llm, retr, max_rounds=2, fast_path_coverage=None).retrieve("I won a national hackathon", "verify_claim")
    assert not pack.sufficient and pack.llm_calls == 6 and len(llm.calls) == 6   # 3 rounds x 2 calls, never more
    assert "insufficient" in pack.to_dict()["note"].lower()


def test_hallucinated_span_ids_and_uncited_sufficiency_are_overruled(retr):
    llm = ScriptedLLM(lambda m, t: PLAN("kafka") if len(llm.calls) % 2 == 1
                      else call("grade_evidence", sufficient=True, relevant_ids=["resume:99"]))
    pack = AgenticRAG(llm, retr, max_rounds=1, fast_path_coverage=None).retrieve("I built a Kafka pipeline", "verify_claim")
    assert not pack.sufficient            # grader said sufficient but cited an id that was never retrieved


def test_llm_failure_degrades_to_static_result_without_raising(retr):
    class Broken:
        def chat(self, *a, **k):
            raise LLMError("429")
    pack = AgenticRAG(Broken(), retr, fast_path_coverage=None).retrieve("I built a Kafka ingestion pipeline", "verify_claim")
    assert pack.mode == "agentic_fallback" and pack.spans        # still returns the BM25 hits


def test_missing_structured_output_degrades_gracefully(retr):
    llm = ScriptedLLM(lambda m, t: call("some_other_tool"))
    pack = AgenticRAG(llm, retr, fast_path_coverage=None).retrieve("I built a Kafka ingestion pipeline", "verify_claim")
    assert pack.mode == "agentic_fallback"


def test_fast_path_spends_zero_llm_calls_but_never_for_claim_verification(retr):
    llm = ScriptedLLM([])
    pack = AgenticRAG(llm, retr).retrieve("Kafka ingestion pipeline latency", "ground_question")
    assert pack.mode == "agentic_fastpath" and llm.calls == []
    llm2 = ScriptedLLM([PLAN("kafka"), call("grade_evidence", sufficient=False, relevant_ids=[])])
    AgenticRAG(llm2, retr, max_rounds=0).retrieve("Kafka ingestion pipeline latency", "verify_claim")
    assert llm2.calls                     # claims are always graded (conflict detection), never fast-pathed


def test_conflicts_are_surfaced(retr):
    gid = _gold_id(retr, "Kafka ingestion")
    llm = ScriptedLLM([PLAN("kafka latency"), call("grade_evidence", sufficient=True, relevant_ids=[gid],
                                                   conflicts=["claim says 90 percent, resume says 40 percent"])])
    pack = AgenticRAG(llm, retr, fast_path_coverage=None).retrieve("I cut Kafka latency by 90 percent", "verify_claim")
    assert pack.conflicts == ["claim says 90 percent, resume says 40 percent"]


def test_static_baseline_numbers_are_reproducible_and_show_the_paraphrase_gap(retr):
    res = evaluate(StaticRAG(retr))
    assert res["recall@3_lexical"] == 1.0
    assert res["recall@3_paraphrase"] < res["recall@3_lexical"]
    assert res["avg_llm_calls_per_claim"] == 0 and res == evaluate(StaticRAG(retr))
    assert res["n"] == len(ITEMS)


def test_retrieve_evidence_tool_returns_pack_and_logs_to_trace(box):
    r = box.execute("retrieve_evidence", {"need": "latency numbers for the Kafka work", "purpose": "verify_claim"})
    assert r["ok"] and "sufficient" in r and r["spans"]
    assert any(e.actor == "rag" for e in box.board.events)
    miss = box.execute("retrieve_evidence", {"need": "xylophone recital", "purpose": "verify_claim"})
    assert miss["sufficient"] is False and "ask the candidate" in miss["note"]
