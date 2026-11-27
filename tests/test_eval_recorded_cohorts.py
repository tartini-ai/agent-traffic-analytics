"""Reference cohort counts on fabricated verdict rows with known answers."""
import os
import sys
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:
    sys.path.insert(0, REPO)

from agentcake import datafiles  # noqa: E402
from agentcake.evaluation import recorded_cohorts, scoring  # noqa: E402

COHORTS = datafiles.load("data/eval.json")["recorded"]["mode_cohorts"]
LIMIT_S = 3
ANTIGRAVITY = "antigravity-browser"
GROK_BOT = recorded_cohorts.GROK_BOT


def row(id_, label, truth, mode, verdict, name=None):
    return {"id": id_, "group": label, "truth": {"class": truth, "mode": mode}, "class": verdict, "name": name}


class RecordedCohorts(unittest.TestCase):
    def test_browser_success_needs_the_joint_verdict_and_name(self):
        outcomes = [("agent", ANTIGRAVITY), ("mixed", ANTIGRAVITY), ("agent", "other-agent"),
                    ("human", ANTIGRAVITY), ("too_little_data", ANTIGRAVITY)]
        rows = [row(i, "agy-browser", "agent", "in-app", verdict, name)
                for i, (verdict, name) in enumerate(outcomes)]
        cells = recorded_cohorts.build(rows, {}, COHORTS, LIMIT_S)
        self.assertEqual(cells, [{"label": "agy-browser", "mode": "in-app", "truth": "agent", "sessions": 5,
                                  "classes": {"agent": 2, "mixed": 1, "human": 1, "too_little_data": 1},
                                  "expected_name": ANTIGRAVITY, "named_agent_or_mixed": 2}])
        self.assertIn("| agy-browser | in-app | agent | 5 | 2 | 1 | 1 | 2/5 (`antigravity-browser`) | — |",
                      recorded_cohorts.markdown(cells, LIMIT_S))

    def test_computer_use_separates_surfaces_and_keeps_unknown_modes_visible(self):
        rows = [row(i, "agy-cu", "agent", mode, "agent")
                for i, mode in enumerate(("in-app", "own-chrome", None, "external-devtools"))]
        rows += [row("legacy", "agy", "agent", "in-app", "agent", ANTIGRAVITY),
                 row("manual", "agy-human", "human", "in-app", "mixed", ANTIGRAVITY)]
        cells = recorded_cohorts.build(rows, {}, COHORTS, LIMIT_S)
        self.assertEqual([(c["label"], c["mode"], c["sessions"]) for c in cells],
                         [("agy-cu", None, 2), ("agy-cu", "in-app", 1), ("agy-cu", "own-chrome", 1),
                          ("agy-human", "in-app", 1)])
        lines = recorded_cohorts.markdown(cells, LIMIT_S)
        self.assertIn("| agy-cu | unverified | agent | 2 | 2 | 0 | 0 | — | — |", lines)
        self.assertIn("| agy-human | in-app | human | 1 | 0 | 1 | 0 | — | — |", lines)

    def test_handoffs_count_misses_including_unscored_sessions(self):
        rows = [row(i, "agy-browser", "mixed", "in-app", verdict)
                for i, verdict in enumerate(("mixed", "mixed", "agent", "too_little_data"))]
        handoffs = {0: {"true_handoffs": 1, "verdict": {"handoff_errors_s": [2.0]}},
                    1: {"true_handoffs": 1, "verdict": {"handoff_errors_s": [5.0]}},
                    2: {"true_handoffs": 1, "verdict": {"handoff_errors_s": [None]}},
                    3: {"true_handoffs": 1, "verdict": None},
                    "legacy": {"true_handoffs": 1, "verdict": {"handoff_errors_s": [0.0]}}}
        cells = recorded_cohorts.build(rows, handoffs, COHORTS, LIMIT_S)
        result, = cells
        self.assertEqual(result["handoffs"], {"true": 4, "found": 2, "within_limit": 1})
        self.assertIn("| agy-browser | in-app | mixed | 4 | 1 | 2 | 1 | — | 2/4 (1) |",
                      recorded_cohorts.markdown(cells, LIMIT_S))


def grok_row(id_, truth, case, verdict, name=None):
    visit = row(id_, GROK_BOT, truth, None, verdict, name)
    visit["truth"]["case"] = case
    return visit


class GrokBotCohorts(unittest.TestCase):
    def test_agent_only_keeps_wrong_names_false_mixed_and_thin_visits(self):
        visits = [grok_row(0, "agent", "T3", "agent", GROK_BOT),
                  grok_row(1, "agent", "T3", "mixed", GROK_BOT),
                  grok_row(2, "agent", "T3", "agent", "other-agent"),
                  grok_row(3, "agent", "T3", "too_little_data"),
                  grok_row(4, "agent", "T5", "agent", GROK_BOT),
                  row(5, "different-group", "agent", None, "agent")]
        cells = recorded_cohorts.grok_bot(visits, {}, LIMIT_S)
        self.assertEqual(cells, [{"truth": "agent", "sessions": 4,
                                  "classes": {"agent": 2, "mixed": 1, "too_little_data": 1},
                                  "names": {GROK_BOT: 2, "other-agent": 1}, "named_agent_or_mixed": 2}])
        self.assertIn("| Agent only | 4 | 2 | 1 | 1 | 3/4 | 2/4 | `other-agent` (1) |",
                      recorded_cohorts.grok_bot_markdown(cells, LIMIT_S))

    def test_handoff_coverage_and_a5_have_their_own_denominators(self):
        classes = ("mixed", "mixed", "mixed", "agent", "too_little_data", "agent")
        visits = [grok_row(i, "mixed", "T5", verdict, GROK_BOT) for i, verdict in enumerate(classes)]
        actions = scoring.action_scores(["agent", "human"], ["agent", "human"])
        scores = [{**actions, "handoff_errors_s": [error], "handoffs_extra": 0}
                  for error in (1.5, 5.0, None, None)]
        marked = {i: {"class": classes[i], "true_handoffs": 1, "verdict": score}
                  for i, score in enumerate([*scores, None])}
        cells = recorded_cohorts.grok_bot(visits, marked, LIMIT_S)
        self.assertEqual(cells[0]["handoffs"], {"true": 5, "found": 2, "within_limit": 1, "without_truth": 1,
                                                "without_timeline": 1, "a5_samples": 3, "a5_median_s": 5.0})
        self.assertIn("| 2/5 | 1 | 1 | 1 | 5 s (3) |", recorded_cohorts.grok_bot_markdown(cells, LIMIT_S))

        del marked[1]  # The remaining A5 samples are one measured handoff and one missed handoff.
        cells = recorded_cohorts.grok_bot(visits, marked, LIMIT_S)
        self.assertIsNone(cells[0]["handoffs"]["a5_median_s"])
        self.assertIn("| 1/4 | 1 | 2 | 1 | over the limit (2) |",
                      recorded_cohorts.grok_bot_markdown(cells, LIMIT_S))

    def test_no_recordings_produces_no_measurements(self):
        self.assertEqual(recorded_cohorts.grok_bot([], {}, LIMIT_S), [])
        self.assertEqual(recorded_cohorts.grok_bot_markdown([], LIMIT_S), [])


if __name__ == "__main__":
    unittest.main()
