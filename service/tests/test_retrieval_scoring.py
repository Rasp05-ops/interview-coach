from service.agent.blackboard import Blackboard, DeliverySignals
from service.agent.retrieval import Retriever, chunk_document, get_rubric, search_bank
from service.agent.scoring import build_report, overall_score
from .conftest import JD, RESUME


def test_resume_chunks_carry_sections():
    spans = chunk_document(RESUME, "resume")
    assert {s.section for s in spans} >= {"experience", "projects", "skills"}


def test_search_finds_relevant_chunk_and_respects_section_filter():
    r = Retriever(RESUME, JD)
    hit = r.search_resume("kafka latency")[0]
    assert hit.section == "experience" and "40 percent" in hit.text
    assert r.search_resume("kafka latency", section="projects") == []
    assert r.search_resume("prosody turn-taking", section="projects")


def test_search_empty_query_and_no_match():
    r = Retriever(RESUME, JD)
    assert r.search_resume("") == [] and r.search_resume("xylophone") == []


def test_jd_search():
    assert Retriever(RESUME, JD).search_jd("streaming pipelines")


def test_bank_excludes_already_asked_and_rubric_lookup():
    first = search_bank("ownership", "easy", [])[0]["q"]
    assert first not in [b["q"] for b in search_bank("ownership", "easy", [first])]
    assert get_rubric("Technical Depth")["known"] and not get_rubric("juggling")["known"]


def _board_with_evidence():
    b = Blackboard(role="x", plan=["ownership", "technical_depth", "problem_solving", "communication"])
    for comp, scores in {"ownership": [4, 5], "technical_depth": [2], "problem_solving": []}.items():
        for s in scores:
            b.add_evidence(0, comp, "some verified quote here", s, "")
    return b


def test_scoring_is_deterministic_and_weighted():
    b = _board_with_evidence()
    # weights by plan order: ownership 3, technical_depth 3, problem_solving 3 (no evidence -> excluded)
    # mean levels: ownership 4.5, technical_depth 2.0 -> (3*4.5 + 3*2.0)/6 = 3.25 -> 6.5/10
    assert overall_score(b) == 6.5
    assert overall_score(b) == overall_score(b)


def test_report_flags_gaps_and_unscored():
    rep = build_report(_board_with_evidence())
    assert "technical_depth" in rep["gaps"] and "problem_solving" in rep["unscored"] and "communication" in rep["unscored"]
    assert "ownership" not in rep["gaps"]


def test_report_with_no_evidence_does_not_crash():
    rep = build_report(Blackboard(plan=["ownership", "technical_depth"]))
    assert rep["overall_score_10"] is None and rep["delivery"] == {}


def test_delivery_summary_aggregates():
    b = Blackboard(plan=["ownership", "technical_depth"])
    for i, (secs, wpm, fill) in enumerate([(30, 140, 3), (60, 160, 6)]):
        t = b.open_turn(f"Question number {i} here", "new_topic", "ownership", "open")
        b.record_answer("words", DeliverySignals(audio_seconds=secs, wpm=wpm, filler_count=fill, long_pause_count=1))
    d = build_report(b)["delivery"]
    assert d["answers"] == 2 and d["avg_wpm"] == 150.0 and d["fillers_per_min"] == 6.0 and d["long_pauses"] == 2
