from service.agent.heuristics import vagueness_signal


def test_flags_the_actual_vague_answer_from_a_live_run():
    flagged, reasons = vagueness_signal(
        "Yeah, we had some disagreements on the team sometimes and I usually just talked it "
        "through with people and it worked out fine overall.")
    assert flagged and reasons


def test_does_not_flag_a_specific_answer_with_numbers():
    flagged, _ = vagueness_signal(
        "I built the Redis caching layer myself, which cut latency by 40 percent and reduced "
        "query time by 25 percent in production.")
    assert not flagged


def test_flags_very_short_answers_even_without_filler_phrases():
    assert vagueness_signal("It went fine.")[0]


def test_a_long_specific_answer_with_no_numbers_is_not_flagged_by_length_alone():
    # long enough and no generic filler -> should not trip the heuristic just for lacking a number
    text = ("I owned the migration end to end, worked with the infrastructure team to plan the "
            "rollout window, wrote the runbook myself, and handled the on-call rotation during launch week.")
    flagged, reasons = vagueness_signal(text)
    assert not flagged