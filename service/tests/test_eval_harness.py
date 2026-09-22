from service.agent.llm import ScriptedLLM
from service.eval.checks import behaviours, invariants
from service.eval.personas import PERSONAS
from service.eval.policies import baseline_policy, probing_policy
from service.eval.simulate import main, run_session


def test_harness_invariants_hold_for_every_persona_offline():
    for name, persona in PERSONAS.items():
        r = run_session(lambda b: ScriptedLLM(baseline_policy(b)), persona)
        assert all(r["invariants"].values()), (name, r["invariants"])
        assert r["fallbacks"] == 0


def test_checks_can_tell_a_probing_interviewer_from_a_non_probing_one():
    passive = run_session(lambda b: ScriptedLLM(baseline_policy(b)), PERSONAS["vague"])
    active = run_session(lambda b: ScriptedLLM(probing_policy(b)), PERSONAS["vague"])
    assert passive["behaviours"]["probed_right_after_vague_answer"] is False
    assert active["behaviours"]["probed_right_after_vague_answer"] is True
    assert all(active["invariants"].values())     # probing stays within the guardrail


def test_strong_answers_do_not_trigger_probing_policy():
    r = run_session(lambda b: ScriptedLLM(probing_policy(b)), PERSONAS["strong"])
    assert r["behaviours"]["probed_at_least_once"] is False


def test_invariant_checker_catches_fabricated_evidence():
    r = run_session(lambda b: ScriptedLLM(baseline_policy(b)), PERSONAS["strong"])
    board = r["board"]
    board.add_evidence(0, "ownership", "I founded a unicorn startup in college", 5, "")   # bypasses the tool guard
    assert invariants(board)["all_evidence_quotes_verifiable"] is False


def test_cli_dry_run_and_refuses_live_without_key(monkeypatch, capsys):
    assert main(["--dry-run", "--persona", "strong"]) == 0
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert main(["--persona", "strong"]) == 2
