import numpy as np
import pytest

from service.turn.audio import HOP, SR, EnergyVAD, pcm16_to_float
from service.turn.benchmark import (GRID, ModelPolicy, TimeoutPolicy, cluster_bootstrap, loso_outcomes, outcomes, rows,
                                    run, summarize, synthesize)
from service.turn.dataset import Example, examples_from_recording, load_jsonl, pauses_from_words, save_jsonl
from service.turn.engine import EngineConfig, TurnEngine
from service.turn.features import extract_prosody
from service.turn.fusion import FEATURE_NAMES, HeuristicPrior, LogReg, build_features
from service.turn.policy import decide
from service.turn.structure import AnswerStructureTracker


def voiced(dur, f0=(180, 180), amp=(0.3, 0.3)):
    t = np.arange(int(dur * SR)) / SR
    f = np.linspace(f0[0], f0[1], len(t)); ph = 2 * np.pi * np.cumsum(f) / SR
    a = np.linspace(amp[0], amp[1], len(t))
    return (a * (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)) / 1.75).astype(np.float32)


def quiet(dur, seed=0):
    return np.random.default_rng(seed).normal(0, 0.0005, int(dur * SR)).astype(np.float32)


def pcm(x):
    return (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()


def stream(engine, audio, chunk=1600):
    evs = []
    for i in range(0, len(audio), chunk):
        evs += engine.feed(pcm(audio[i:i + chunk]))
    return evs


def patience(level="normal", hold=5.0, structure="open"):
    return lambda: {"level": level, "max_hold_s": hold, "expected_structure": structure}


def end_silence(events):
    return next((e["silence_s"] for e in events if e["type"] == "decision" and e["decision"] == "end"), None)


# ── audio / VAD ────────────────────────────────────────────────────────────────
def test_vad_finds_speech_boundaries_within_tolerance():
    audio = np.concatenate([quiet(0.5), voiced(1.0), quiet(0.7)])
    flags = [s for s, _ in EnergyVAD().process(audio)]
    on = next(i for i, s in enumerate(flags) if s) * HOP / SR
    off = (len(flags) - next(i for i, s in enumerate(reversed(flags)) if s)) * HOP / SR
    assert abs(on - 0.5) < 0.08 and abs(off - 1.5) < 0.2       # includes hangover


def test_pcm_conversion_roundtrip():
    x = np.array([0.0, 0.5, -0.5], dtype=np.float32)
    assert np.allclose(pcm16_to_float(pcm(x)), x, atol=1e-3)


# ── prosody ────────────────────────────────────────────────────────────────────
def test_prosody_slopes_have_the_right_sign_on_known_signals():
    fall = extract_prosody(voiced(1.0, (220, 150), (0.3, 0.05)))
    rise = extract_prosody(voiced(1.0, (150, 220), (0.3, 0.3)))
    assert fall["f0_slope_st_s"] < -3 and rise["f0_slope_st_s"] > 3
    assert fall["energy_slope_db_s"] < -5 and abs(rise["energy_slope_db_s"]) < 2
    assert fall["voiced_ratio_end"] > 0.8


def test_prosody_on_too_little_audio_is_safe():
    assert all(v == 0.0 for v in extract_prosody(np.zeros(100, dtype=np.float32)).values())


# ── structure ──────────────────────────────────────────────────────────────────
def test_structure_cues_and_regression_for_words_ending_in_so():
    tr = AnswerStructureTracker("star_story")
    assert tr.update("and then we").looks_incomplete
    assert not tr.update("we shipped it and cut latency by 40 percent.").looks_incomplete
    s = tr.update("I built the consumer and as a result latency dropped")
    assert s.result_seen and "action" in s.star_seen and s.star_missing == 0
    assert tr.update("I built it and um").ends_with_filler
    assert not tr.update("that was also").ends_with_filler          # "also" ends in "so" but is not a filler
    assert AnswerStructureTracker("open").update("I built it").star_missing == 0


# ── policy ─────────────────────────────────────────────────────────────────────
def test_policy_is_monotone_patience_aware_and_capped():
    assert decide(0.9, 0.2, "low", 2.5).kind == "hold"                       # too little silence
    assert decide(0.7, 1.0, "normal", 5.0).kind == "end" and decide(0.7, 1.0, "high", 10.0).kind == "hold"
    assert decide(0.1, 2.5, "low", 2.5).kind == "prompt"
    assert decide(0.1, 2.5, "low", 2.5, already_prompted=True).kind == "hold"
    assert decide(0.0, 5.0, "low", 2.5).kind == "end" and decide(0.0, 5.0, "low", 2.5).reason == "hard_cap"


def test_prior_probability_rises_with_silence_and_falls_with_unfinished_speech():
    tr = AnswerStructureTracker("open")
    done = tr.update("we shipped it.")
    m = HeuristicPrior()
    ps = [float(m.predict_proba(build_features({}, done, "open", t))[0]) for t in (0.3, 1.0, 2.0)]
    assert ps == sorted(ps)
    inc = tr.update("we shipped it and")
    assert float(m.predict_proba(build_features({}, inc, "open", 1.0))[0]) < ps[1]


# ── engine (audio in, events out) ──────────────────────────────────────────────────
DONE = "I built the consumer and we cut latency by 40 percent as a result."
UNFINISHED = "so the first thing I would do is"


def test_mid_answer_pause_is_held_then_final_pause_ends():
    eng = TurnEngine(patience("normal", 5.0, "star_story"))
    eng.set_transcript(UNFINISHED)
    evs = stream(eng, np.concatenate([quiet(0.3), voiced(1.5), quiet(0.6), voiced(1.0), quiet(4.0)]))
    types = [e["type"] for e in evs]
    assert "resumed" in types and "speech_start" in types[types.index("resumed"):]
    first_pause_decisions = [e for e in evs[: types.index("resumed")] if e["type"] == "decision"]
    assert first_pause_decisions and all(e["decision"] == "hold" for e in first_pause_decisions)
    assert end_silence(evs) is not None and eng.over


def test_agent_declared_patience_changes_how_long_the_engine_waits():
    audio = np.concatenate([quiet(0.3), voiced(1.5), quiet(4.0)])
    ends = {}
    for level, hold in (("low", 2.5), ("normal", 5.0), ("high", 10.0)):
        eng = TurnEngine(patience(level, hold, "open")); eng.set_transcript(DONE)
        ends[level] = end_silence(stream(eng, audio))
    assert ends["low"] < ends["normal"] < ends["high"]


def test_unfinished_clause_waits_longer_than_finished_one():
    audio = np.concatenate([quiet(0.3), voiced(1.5), quiet(4.0)])
    e1 = TurnEngine(patience("normal", 5.0, "open")); e1.set_transcript(DONE)
    e2 = TurnEngine(patience("normal", 5.0, "open")); e2.set_transcript(UNFINISHED)
    assert end_silence(stream(e1, audio)) < end_silence(stream(e2, audio))


def test_no_decisions_before_speech_and_prompt_after_long_silence():
    eng = TurnEngine(patience())
    evs = stream(eng, quiet(9.0))
    assert [e for e in evs if e["type"] == "decision"] == [{"type": "decision", "decision": "prompt", "reason": "no_speech", "silence_s": pytest.approx(8.0, abs=0.2)}]


def test_stats_reflect_pauses_and_first_word_delay():
    eng = TurnEngine(patience("high", 10.0, "think_aloud")); eng.set_transcript(UNFINISHED)
    stream(eng, np.concatenate([quiet(0.8), voiced(1.0), quiet(1.2), voiced(1.0), quiet(0.4)]))
    st = eng.stats()
    assert abs(st["first_word_delay_s"] - 0.8) < 0.15 and st["long_pause_count"] == 1 and 1.0 < st["longest_pause_s"] < 1.6


def test_max_turn_guard_and_reset():
    eng = TurnEngine(patience(), cfg=EngineConfig(max_turn_s=3.0))
    evs = stream(eng, voiced(4.0))
    assert any(e.get("reason") == "max_turn" for e in evs) and eng.over and eng.feed(pcm(voiced(0.1))) == []
    eng.reset_turn()
    assert not eng.over and eng.stats()["audio_seconds"] == 0


def test_smart_turn_hook_is_used_when_provided():
    calls = []
    eng = TurnEngine(patience("normal", 5.0, "open"), smart_turn=lambda a: calls.append(len(a)) or 0.95)
    eng.set_transcript(DONE)
    stream(eng, np.concatenate([quiet(0.3), voiced(1.0), quiet(1.5)]))
    assert calls and max(calls) <= 8 * SR


# ── fusion ─────────────────────────────────────────────────────────────────────
def test_logreg_learns_and_serialises():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(400, len(FEATURE_NAMES))); y = (X[:, 0] + 0.5 * X[:, 3] > 0).astype(float)
    m = LogReg().fit(X, y)
    acc = np.mean((m.predict_proba(X) > 0.5) == y)
    assert acc > 0.9
    m2 = LogReg.from_json(m.to_json())
    assert np.allclose(m.predict_proba(X[:5]), m2.predict_proba(X[:5]))
    with pytest.raises(ValueError):
        LogReg.from_json(m.to_json().replace("silence_s", "renamed"))


# ── dataset ────────────────────────────────────────────────────────────────────
WORDS = [{"word": "we", "start": 0.0, "end": 0.3}, {"word": "built", "start": 0.35, "end": 0.8},
         {"word": "it", "start": 1.6, "end": 1.9}, {"word": "quickly", "start": 1.95, "end": 2.4}]


def test_pauses_are_labelled_automatically_from_word_timings():
    assert pauses_from_words(WORDS, 5.0) == [(0.8, 1.6, "hold"), (2.4, 5.0, "end")]
    assert [x[2] for x in pauses_from_words(WORDS, 2.5)] == ["hold"]   # too little trailing silence: no END example


def test_examples_from_recording_use_only_audio_before_each_pause(tmp_path):
    audio = np.concatenate([voiced(0.8, (200, 150)), quiet(0.8), voiced(0.8), quiet(2.6)])
    ex = examples_from_recording(audio, WORDS, "spk1", "star_story")
    assert [e.label for e in ex] == ["hold", "end"] and ex[0].text_so_far == "we built"
    assert ex[0].prosody["f0_slope_st_s"] < 0                # computed from the falling glide before the first pause
    p = tmp_path / "d.jsonl"; save_jsonl(ex, str(p))
    assert [e.label for e in load_jsonl(str(p))] == ["hold", "end"]


def test_smart_turn_probability_is_recorded_per_pause_from_audio_before_it():
    seen = []
    audio = np.concatenate([voiced(0.8), quiet(0.8), voiced(0.8), quiet(2.6)])
    ex = examples_from_recording(audio, WORDS, "s", "open", smart_turn=lambda a: seen.append(len(a)) or 0.25)
    assert [e.smart_turn for e in ex] == [0.25, 0.25] and seen[0] == int(0.8 * SR)   # only audio before the first pause


# ── benchmark plumbing ───────────────────────────────────────────────────────────
def _toy():
    return [Example("a", "open", "hold", 0.7), Example("a", "open", "hold", 1.5),
            Example("b", "open", "hold", 0.4), Example("b", "open", "end", 3.0), Example("a", "open", "end", 3.0)]


def test_timeout_policy_outcomes_match_hand_computation():
    # tau=0.6 -> first grid time >= 0.6 is 0.8. Holds of 0.7 s and 0.4 s end before then (survive); only the 1.5 s hold is cut.
    s = summarize(outcomes(_toy(), TimeoutPolicy(0.6)))
    assert s["false_cutoff_rate"] == 0.333 and s["n_hold"] == 3 and s["n_end"] == 2
    assert s["median_end_latency_s"] == 0.8 and s["missed_end_rate"] == 0.0
    # a 300 ms timeout cuts every hold longer than 0.3 s (first grid time is 0.3)
    assert summarize(outcomes(_toy(), TimeoutPolicy(0.3)))["false_cutoff_rate"] == 1.0


def test_model_policy_respects_patience_toggle():
    ex = Example("a", "think_aloud", "end", 6.0, {}, {"words": 20, "looks_incomplete": False, "ends_with_filler": False,
                                                      "star_seen": [], "star_missing": 0, "result_seen": True})
    fixed = ModelPolicy(HeuristicPrior(), agent_patience=False).end_time(ex)
    agent = ModelPolicy(HeuristicPrior(), agent_patience=True).end_time(ex)
    assert agent > fixed                       # think_aloud -> high patience -> waits longer than the fixed "normal"


def test_bootstrap_is_deterministic_and_resamples_speakers():
    outs = outcomes(synthesize(6, 30, seed=1), TimeoutPolicy(0.6))
    assert cluster_bootstrap(outs, "false_cutoff_rate", seed=3) == cluster_bootstrap(outs, "false_cutoff_rate", seed=3)
    lo, hi = cluster_bootstrap(outs, "false_cutoff_rate")
    assert lo <= summarize(outs)["false_cutoff_rate"] <= hi
    assert cluster_bootstrap(outcomes(_toy()[:3], TimeoutPolicy(0.6)), "false_cutoff_rate")[0] is not None
    assert cluster_bootstrap(outcomes([Example("only", "open", "hold", 1.0)], TimeoutPolicy(0.6)), "false_cutoff_rate") == (None, None)


def test_leave_speakers_out_never_trains_on_the_test_speaker():
    _, audit = loso_outcomes(synthesize(5, 20, seed=2), True, "t")
    assert len(audit) == 5 and all(not (tr & te) and len(te) == 1 for tr, te in audit)


def test_rows_stop_at_the_end_of_each_pause():
    X, y = rows([Example("a", "open", "hold", 0.7), Example("a", "open", "end", 1.2)])
    assert len(X) == 2 + 4 and y.tolist() == [0, 0, 1, 1, 1, 1]      # hold: t=0.3,0.55 ; end: 0.3,0.55,0.8,1.05


def test_full_run_produces_every_row_and_flags_synthetic_data_as_plumbing_only(capsys):
    from service.turn.benchmark import main
    res = run(synthesize(5, 20, seed=0))
    assert {"vad_timeout_300ms", "vad_timeout_600ms", "vad_timeout_1000ms", "heuristic_prior+agent_patience",
            "logreg_loso+agent_patience", "logreg_loso+fixed_patience"} <= set(res)
    assert main(["--synthetic"]) == 0 and "SYNTHETIC" in capsys.readouterr().out
