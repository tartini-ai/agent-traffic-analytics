"""Evaluate synthetic Grok Bot truth labels against a server-mode store through the CLI."""
from contextlib import redirect_stdout
import http.client
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agentcake import cli, collect, config  # noqa: E402
from agentcake.responses import Request  # noqa: E402
from test_eval_site import KEY, S, T0, short, visit  # noqa: E402
from verdict_cases import CHROME_LINUX  # noqa: E402

GROK = "grok-bot"


class GrokRecordings(unittest.TestCase):
    def test_store_cohorts_are_reported_beside_the_existing_gate(self):
        named, thin, handoff, control = (digit * 32 for digit in "1234")
        takeover = T0 + 120 * S
        stretches = [[takeover + S, takeover + S, "agent"], [takeover + 5 * S, takeover + 5 * S, "human"]]
        lines = [{"h": short(named), "case": "T3", "group": GROK, "class": "agent"},
                 {"h": short(thin), "case": "T3", "group": GROK, "class": "agent"},
                 {"h": short(handoff), "case": "T5", "group": GROK, "class": "mixed", "stretches": stretches},
                 {"h": short(control), "case": "T3", "group": "claude-agent", "class": "agent"}]

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home, truth, output = root / "home", root / "truth.jsonl", root / "output"
            sources, missing = root / "sources.json", root / "missing"
            sources.write_text("{}", encoding="utf-8")
            truth.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
            with mock.patch.dict(os.environ, {"CAKE_HOME": str(home)}):
                config.save_user(site_key=KEY, public_listen="127.0.0.1:9", disk_min_free_mb=0)
                self.record(visit(named, T0), grok_rule=True)
                self.record(visit(thin, T0 + 60 * S))
                body = visit(handoff, takeover)
                body["r"].extend({"t": start, "ty": "click", "cx": 10, "cy": 20, "tr": 1, "vs": 1}
                                 for start, _, _ in stretches)
                self.record(body, grok_rule=True)
                self.record(visit(control, T0 + 180 * S), ua=CHROME_LINUX + " Claude-Agent/1.0")

            args = ["eval", "--cake-home", home, "--truth-goal", truth, "--out", output, "--sources", sources,
                    "--lab", missing, "--lab-signals", missing, "--uploads", missing, "--no-logistic"]
            with redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main([str(arg) for arg in args]), 0)
            data = json.loads((output / "eval.json").read_text(encoding="utf-8"))
            markdown = (output / "eval.md").read_text(encoding="utf-8")

        self.assertEqual([cell["truth"] for cell in data["grok_bot_cohorts"]], ["agent", "mixed"])
        agent, mixed = data["grok_bot_cohorts"]
        self.assertEqual((agent["sessions"], agent["classes"], agent["names"], agent["named_agent_or_mixed"]),
                         (2, {"agent": 1, "too_little_data": 1}, {GROK: 1}, 1))
        self.assertEqual((mixed["sessions"], mixed["classes"], mixed["names"]), (1, {"agent": 1}, {GROK: 1}))
        self.assertEqual(mixed["handoffs"], {"true": 1, "found": 0, "within_limit": 0, "without_truth": 0,
                                             "without_timeline": 1, "a5_samples": 0, "a5_median_s": None})
        self.assertIn("## Grok Bot recording cohorts", markdown)
        self.assertIn("| Agent only | 2 | 1 | 0 | 1 | 1/2 | 1/2 |", markdown)
        self.assertIn("| 0/1 | 0 | 0 | 1 |", markdown)

        a2 = next(entry for entry in data["gate"] if entry["id"] == "A2")
        gated = {row["source"]: row for row in a2["gated"]}
        reference = next(row for row in a2["reference"] if row["source"] == f"store/{GROK}")
        self.assertNotIn(f"store/{GROK}", gated)
        self.assertEqual((gated["store"]["count"], gated["store"]["n"], gated["store"]["details"]["not_judged"]),
                         (2, 2, 1))
        self.assertEqual((reference["count"], reference["n"], reference["details"]["not_judged"]), (1, 1, 1))
        self.assertEqual(len(data["takeovers"]["store"]), 1)
        self.assertEqual(data["takeovers"]["store"][0]["true_handoffs"], 1)

    def record(self, body, ua=CHROME_LINUX, grok_rule=False):
        body["pv"] = "a" + body["s"][1:]
        body["ua"] = ua
        body["x"][1]["env"].update(userAgent=ua, platform="Linux x86_64")
        if grok_rule:
            body["x"].append({"t": body["t"] + 5, "ty": "botscent", "why": "start", "type": "agent",
                              "agent": GROK, "reasons": ["grok.cloud-computer.environment"], "ver": "1.2.0"})
        headers = http.client.HTTPMessage()
        headers["User-Agent"], headers["Accept-Language"] = ua, "en-US"
        now = max(record["t"] for record in body["r"])
        with mock.patch.object(collect, "clock_ms", return_value=now):
            response = collect.from_public(Request("/collect", {}, headers, json.dumps(body).encode()))
        self.assertEqual(response.status, 204, response.body)
