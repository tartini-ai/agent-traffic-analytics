"""Ordered page-path counts over the local dashboard's visit cohort."""
import unittest
from unittest import mock

import visit_rows
from api_client import Client, contract_problems
from web_uploads import KEY, MINUTE_MS, T0, UA_MAC_CHROME, WebCase, upload
from agentcake import config, streams, timezone, web_time
from agentcake.api import periods

CHECKOUT, DONE = "/demo/checkout", "/demo/done"
STORE = "https://shop.example.com"
STEPS = (CHECKOUT, DONE)
TABS = tuple(f"{n:032x}" for n in range(1, 11))


class Funnel(WebCase):
    settings = {"timezone": "America/Los_Angeles"}

    def upload(self, tab, n, t, path, *, visit=None, legacy=False, seq=0):
        data = upload(seq, t, tab=tab, pv=f"{n + 201:032x}", url=STORE + path, page={} if seq == 0 else None)
        data["bs"] = visit or tab
        if legacy and seq == 0:
            data["x"] = [{"ty": "page", "t": t}]
        elif seq == 0:
            data["x"][0]["p"] = path.split("?")[0]
        return data

    def record(self, tab, paths, verdict="human", visit=None):
        for i, path in enumerate(paths):
            self.post(self.upload(tab, i, T0 + i * MINUTE_MS, path, visit=visit))
        self.verdict(tab, verdict)

    def verdict(self, tab, classification):
        self.con.execute("UPDATE sessions SET verdict_class=?, judged_ms=end_ms + 1 WHERE id=?", (classification, tab))
        visit_rows.refreshed(self.con)

    def get(self, steps=STEPS, **query):
        answer = Client().get("/api/funnel", step=steps, **query)
        self.assertEqual(answer.status, 200, answer.body)
        self.assertEqual(contract_problems(answer.body, "funnel"), [])
        self.assertEqual([row["path"] for row in answer.body["steps"]], list(steps))
        return [(row["agent"], row["human"]) for row in answer.body["steps"]]

    def test_checkout_counts_two_starts_and_one_completion(self):
        self.record(TABS[0], ["/demo", CHECKOUT, CHECKOUT, "/demo/review", DONE], "mixed")
        self.record(TABS[1], ["/demo", CHECKOUT], "unsure")
        self.record(TABS[2], [DONE])
        self.assertEqual(self.get(), [(1, 1), (1, 0)])

    def test_each_step_requires_the_chosen_order(self):
        middle = "/demo/review"
        self.record(TABS[0], [DONE, CHECKOUT])
        self.record(TABS[1], [CHECKOUT, DONE, middle])
        self.record(TABS[2], [CHECKOUT, middle, DONE])
        self.assertEqual(self.get((CHECKOUT, middle, DONE)), [(0, 3), (0, 2), (0, 1)])
        self.assertEqual(self.get((CHECKOUT, CHECKOUT)), [(0, 3), (0, 0)])

    def test_a_reload_can_satisfy_a_repeated_step(self):
        self.record(TABS[0], [CHECKOUT, CHECKOUT, DONE])
        self.assertEqual(self.get((CHECKOUT, CHECKOUT, DONE)), [(0, 1), (0, 1), (0, 1)])

    def test_spa_path_changes_across_tabs_follow_browser_time_even_if_delivered_late(self):
        visit, a, b = TABS[:3]
        first = self.upload(a, 0, T0, "/demo", visit=visit)
        first["x"].append({"ty": "path", "t": T0 + MINUTE_MS, "p": CHECKOUT})
        second = self.upload(b, 1, T0 + 2 * MINUTE_MS, DONE, visit=visit)
        self.post(second)
        self.post(first)
        self.verdict(a, "agent")
        self.verdict(b, "human")
        with mock.patch.object(streams, "read_events", wraps=streams.read_events) as read:
            self.assertEqual(self.get(), [(1, 0), (1, 0)])
        self.assertEqual(len(read.call_args_list), 2)
        self.assertTrue(all(call.args[2] == [web_time.SIGNALS] for call in read.call_args_list))

    def test_ignores_bots_excluded_tabs_self_checks_and_other_sites(self):
        self.record(TABS[0], [CHECKOUT, DONE], "bot")
        self.record(TABS[1], [CHECKOUT, DONE], "excluded")
        self.record(TABS[2], [CHECKOUT, DONE])
        self.record(TABS[3], [CHECKOUT, DONE])
        self.record(TABS[4], [CHECKOUT], visit=TABS[4])
        self.record(TABS[5], [DONE], visit=TABS[4])
        self.con.execute("UPDATE sessions SET is_test=1 WHERE id IN (?, ?)", (TABS[2], TABS[5]))
        self.con.execute("UPDATE sessions SET origin='other' WHERE id=?", (TABS[3],))
        visit_rows.refreshed(self.con)
        self.assertEqual(self.get(), [(0, 1), (0, 0)])

    def test_respects_range_cutoff_in_the_configured_timezone(self):
        self.record(TABS[0], [CHECKOUT, DONE])
        self.record(TABS[1], [CHECKOUT], "agent")
        zone = timezone.chosen(config.load_cfg())
        start = periods.window("7d", T0, zone)[0]
        self.con.execute("UPDATE sessions SET start_ms=? WHERE id=?", (start - 1, TABS[0]))
        self.con.execute("UPDATE sessions SET start_ms=? WHERE id=?", (start, TABS[1]))
        visit_rows.refreshed(self.con)
        with mock.patch.object(periods, "now_ms", return_value=T0):
            self.assertEqual(self.get(range="7d"), [(1, 0), (0, 0)])
            self.assertEqual(self.get(range="all"), [(1, 1), (0, 1)])

    def test_old_batches_use_path_changes_and_old_landing_can_count_one_view(self):
        self.post(self.upload(TABS[0], 0, T0 + 2 * MINUTE_MS, DONE, seq=2))
        self.post(self.upload(TABS[0], 0, T0, CHECKOUT, legacy=True))
        self.post(self.upload(TABS[0], 0, T0 + MINUTE_MS, CHECKOUT + "?step=1", seq=1))
        self.verdict(TABS[0], "human")
        self.post({"k": KEY, "s": TABS[1], "u": STORE + CHECKOUT + "?step=1", "ua": UA_MAC_CHROME, "wd": False,
                   "e": [{"type": 3, "timestamp": T0, "data": {}}]})
        self.verdict(TABS[1], "unsure")
        self.assertEqual(self.get(), [(0, 2), (0, 1)])
        self.assertEqual(self.get((CHECKOUT, CHECKOUT)), [(0, 2), (0, 0)])

    def test_mixed_legacy_and_current_page_signals_use_the_same_paths_as_the_backfill(self):
        self.post(self.upload(TABS[0], 0, T0, CHECKOUT + "?item=123", legacy=True))
        self.post(self.upload(TABS[0], 1, T0 + MINUTE_MS, DONE))
        self.verdict(TABS[0], "human")
        self.con.execute("UPDATE session_web SET entry_t=NULL WHERE session_id=?", (TABS[0],))
        self.con.commit()
        self.assertEqual(self.get(), [(0, 1), (0, 1)])
        self.assertEqual(dict(self.rows("SELECT path, views FROM web_paths WHERE session_id=?", TABS[0])),
                         {CHECKOUT: 1, DONE: 1})

    def test_report_reads_history_only_for_visits_that_can_start_the_funnel(self):
        self.record(TABS[0], [CHECKOUT, DONE])
        others = [f"{i + 1000:032x}" for i in range(50)]
        self.con.executemany("INSERT INTO sessions(id, start_ms, end_ms, verdict_class, judged_ms) "
                             "VALUES(?, ?, ?, 'human', ?)", [(tab, T0, T0, T0 + 1) for tab in others])
        self.con.executemany("INSERT INTO session_web(session_id, tab_id, entry_t) VALUES(?, ?, ?)",
                             [(tab, tab, T0) for tab in others])
        self.con.executemany("INSERT INTO web_paths(session_id, path, views) VALUES(?, ?, 1)",
                             [(tab, DONE) for tab in others])
        visit_rows.alone(self.con)
        with mock.patch.object(web_time, "page_history", wraps=web_time.page_history) as read:
            self.assertEqual(self.get(), [(0, 1), (0, 1)])
        self.assertEqual([call.args[1] for call in read.call_args_list], [TABS[0]])

    def test_empty_data_and_invalid_step_queries(self):
        self.assertEqual(self.get(), [(0, 0), (0, 0)])
        for steps in ((), (CHECKOUT,), (CHECKOUT, ""), (CHECKOUT, "https://shop.example.com/"), (CHECKOUT, "/?a=1")):
            with self.subTest(steps=steps):
                self.assertEqual(Client().get("/api/funnel", step=steps).status, 400)
        self.assertEqual(Client("other.example.com").get("/api/funnel", step=STEPS).status, 403)


if __name__ == "__main__":
    unittest.main()
