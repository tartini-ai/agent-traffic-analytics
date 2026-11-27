"""The Paths table's replay list, including old records, visit grouping and other session filters."""
import json
from unittest import mock

import visit_rows
from api_client import Client
from web_uploads import KEY, MINUTE_MS, T0, UA_MAC_CHROME, WebCase, upload
from agentcake import space
from agentcake.api import answers, periods

CHECKOUT = "/demo/checkout"
DONE = "/demo/done"
SHOP = "https://shop.example.com"
NOW = T0 + 10 * MINUTE_MS
DAY_MS = 24 * 60 * MINUTE_MS


class VisitedPaths(WebCase):
    def get(self, endpoint, **query):
        # The client's get() names its endpoint argument "path".
        with mock.patch.object(periods, "now_ms", return_value=NOW):
            answer = Client().send("GET", endpoint, b"", {}, query)
        self.assertEqual(answer.status, 200, answer.body)
        return answer.body

    def sessions(self, path, **query):
        return self.get("/api/sessions", path=path, **query)

    def record(self, number, *pages, verdict="human", name=None, start=None, **flags):
        tab = f"{number:032x}"
        for n, page in enumerate(pages):
            at = T0 + n * MINUTE_MS
            body = upload(0, at, tab=tab, pv=f"{n:032x}", page={}, url=SHOP + page)
            self.post(dict(body, bs=tab))
        self.judged(tab, start or T0 + number * 1000, verdict, name, **flags)
        return tab

    def judged(self, tab, start, verdict, name=None, origin="site", is_test=0):
        detail = json.dumps({"display_name": name}) if name else None
        self.con.execute(
            "UPDATE sessions SET start_ms=?, verdict_class=?, judged_ms=end_ms + 1, verdict_detail=?, "
            "origin=?, is_test=? WHERE id=?", (start, verdict, detail, origin, is_test, tab))
        visit_rows.refreshed(self.con)

    def session_ids(self, page):
        return [row["id"] for row in page["results"]]

    def test_paths_link_matches_dashboard_counts_and_finds_later_pages(self):
        complete = self.record(1, "/demo", CHECKOUT + "?step=2", DONE, verdict="mixed")
        left = self.record(2, "/demo", CHECKOUT, CHECKOUT, verdict="not_sure")
        direct = self.record(3, DONE)
        self.record(4, CHECKOUT, verdict="bot")
        self.record(5, CHECKOUT, start=T0 - 2 * DAY_MS)
        self.record(6, CHECKOUT, is_test=1)
        self.record(7, CHECKOUT, origin="other")
        self.record(8, CHECKOUT, verdict="excluded")
        rows = {row["path"]: row for row in self.get("/api/web", range="24h")["paths"]}
        for path, expected in ((CHECKOUT, [left, complete]), (DONE, [direct, complete])):
            with self.subTest(path=path):
                row = rows[path]
                page = self.sessions(path, range="24h")
                self.assertEqual(self.session_ids(page), expected)
                self.assertEqual(page["total"], row["agent"] + row["human"])
                self.assertEqual({key: page["counts"][key] for key in ("agent", "human")},
                                 {key: row[key] for key in ("agent", "human")})
                self.assertEqual(page["counts"]["bot"], 0)
        self.assertEqual(self.sessions(CHECKOUT + "?step=2")["total"], 0)
        self.assertEqual(self.session_ids(self.sessions(CHECKOUT, verdict="agent", range="24h")), [complete])
        self.assertEqual(self.session_ids(self.sessions(CHECKOUT, verdict="human", range="24h")), [left])

    def test_matching_counted_tabs_deduplicate_the_visit(self):
        first = self.record(1, "/demo", CHECKOUT, verdict="agent")
        second = self.record(2, CHECKOUT, verdict="agent")
        outside = self.record(3, "/demo")
        excluded = self.record(4, CHECKOUT, verdict="excluded")
        visit_rows.joined(self.con, first, [(first, None), (second, None)])
        visit_rows.joined(self.con, outside, [(outside, None), (excluded, None)])
        page = self.sessions(CHECKOUT)
        self.assertEqual(self.session_ids(page), [first])
        self.assertEqual(page["total"], 1)
        row = next(row for row in self.get("/api/web")["paths"] if row["path"] == CHECKOUT)
        self.assertEqual((row["agent"], row["page_views"]), (1, 2))

    def test_a_direct_filter_backfills_older_batches_and_landing_addresses(self):
        encoded = "/demo/order%2Fdetails"
        old = self.record(1, "/demo", encoded + "?from=cart")
        legacy = f"{2:032x}"
        self.post({"k": KEY, "s": legacy, "u": SHOP + encoded, "ua": UA_MAC_CHROME, "wd": False,
                   "e": [{"type": 3, "timestamp": T0, "data": {}}]})
        self.judged(legacy, T0, "human")
        self.con.execute("UPDATE session_web SET entry_t=NULL")
        self.con.execute("DELETE FROM web_paths")
        self.con.commit()
        self.assertEqual(set(self.session_ids(self.sessions(encoded))), {old, legacy})
        self.assertEqual(self.sessions("/demo/order/details")["total"], 0)

    def test_path_counts_and_pages_keep_agent_and_verdict_filters(self):
        older = self.record(1, "/demo", CHECKOUT, verdict="agent", name="Muse")
        newer = self.record(2, CHECKOUT, verdict="mixed", name="Muse")
        self.record(3, DONE, verdict="agent", name="Muse")
        self.record(4, CHECKOUT, verdict="agent", name="Comet")
        space._remove_replay(self.con, older, NOW)
        self.con.commit()
        query = {"agent": "Muse", "verdict": "agent"}
        with mock.patch.object(answers, "numbers", return_value={**answers.numbers(), "page_size": 1}):
            first = self.sessions(CHECKOUT, **query)
            self.assertIsNotNone(first["next"])
            second = self.sessions(CHECKOUT, cursor=first["next"], **query)
        self.assertEqual((self.session_ids(first), self.session_ids(second)), ([newer], [older]))
        self.assertIsNone(second["next"])
        self.assertEqual(first["total"], 2)
        self.assertEqual(first["counts"], {"all": 2, "human": 0, "agent": 2, "bot": 0,
                                          "agent_only": 1, "human_agent": 1, "thin": 0})
        self.assertEqual(second["counts"], first["counts"])
        self.assertEqual(set(first["agent_names"]), {"Muse", "Comet"})
