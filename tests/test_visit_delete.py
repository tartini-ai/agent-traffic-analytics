"""A visit is deleted whole: by one of its tab sessions' ids, by its own id, and by retention (agentcake/delete.py,
agentcake/store.py prune).

    python3 -I -m unittest discover -s tests -p test_visit_delete.py -v

Deleting the id of one tab session deletes every tab session of its visit and the visit's row, in the database, in
the backups and in the log; so does the visit's own id (a browser session id names no tab session); another visit
stays as it was. Retention deletes a visit once its last tab session is older than the retention, never part of one.
"""
import json
import os
import shutil
import sqlite3
import sys
import unittest
from contextlib import closing

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_client import Client  # noqa: E402
from test_api_tabs import replay_events  # noqa: E402
from test_visit_join import BS, MINUTE_MS, OTHER_VISITOR, T0, JoinCase, tab  # noqa: E402
from agentcake import delete, paths, store, streams  # noqa: E402
from agentcake.storage_config import SETTINGS, ms_from_days  # noqa: E402
from agentcake.units import MS_PER_DAY  # noqa: E402


class Delete(JoinCase):
    def setUp(self):
        super().setUp()
        self.send(tab(1), T0)  # tabs 1 and 2: one visit the collector joined
        self.send(tab(2), T0 + MINUTE_MS)
        self.send(tab(3), T0, bs=BS)  # tabs 3 and 4: one visit named by its browser session id
        self.send(tab(4), T0 + MINUTE_MS, bs=BS)
        self.send(tab(5), T0, visitor=OTHER_VISITOR)  # another visitor's visit
        self.assertEqual(self.grouping(), [[tab(1), tab(2)], [tab(3), tab(4)], [tab(5)]])
        self.con.commit()

    def deleted(self, ids):
        self.con.close()
        result = delete.delete_sessions(ids)
        self.con = store.db()
        self.addCleanup(self.con.close)
        return result

    def left(self):
        return sorted(session for (session,) in self.rows("SELECT id FROM sessions"))

    def test_one_tab_sessions_id_deletes_its_whole_visit(self):
        result = self.deleted([tab(2)])
        self.assertEqual(sorted(item["id"] for item in result["sessions"]), [tab(1), tab(2)])
        self.assertEqual(self.left(), [tab(3), tab(4), tab(5)])
        self.assertEqual(sorted(self.visits()), sorted([BS, tab(5)]))
        for (table,) in self.con.execute(store.SESSION_TABLES).fetchall():
            self.assertEqual(self.rows(f"SELECT session_id FROM {table} WHERE session_id IN (?, ?)", tab(1), tab(2)),
                             [], table)

    def test_a_visits_own_id_deletes_it(self):
        self.deleted([BS])
        self.assertEqual(self.left(), [tab(1), tab(2), tab(5)])
        self.assertNotIn(BS, self.visits())

    def test_the_replay_pages_delete_request_removes_one_whole_visit_from_reports(self):
        for sid, start in ((tab(3), T0), (tab(4), T0 + MINUTE_MS)):
            events = [(event["timestamp"], json.dumps(event)) for event in replay_events(start)]
            streams.append(self.con, sid, "rrweb", events, start)
            streams.seal(self.con, start, force=True, session_id=sid)
        self.con.commit()
        api = Client()
        canonical = f"/api/session/{BS}"
        older_url = f"/api/session/{tab(4)}"
        detail = api.get(older_url).body
        self.assertEqual((detail["session"]["id"], detail["named_tab"]), (BS, tab(4)))
        self.assertEqual(api.get(canonical + "/replay", chunk="0", tab=tab(3)).status, 200)
        self.assertEqual(api.get(older_url + "/replay", chunk="0").status, 200)
        self.assertEqual(api.get("/api/sessions", range="all").body["total"], 3)
        before = api.get("/api/overview", range="all").body

        removed = api.post("/api/delete", {"sessions": [detail["session"]["id"]]})
        self.assertEqual(removed.status, 200, removed.body)
        self.assertEqual({item["id"] for item in removed.body["sessions"] if item["found"]}, {tab(3), tab(4)})
        for url in (canonical, older_url, f"/api/session/{tab(3)}"):
            self.assertEqual(api.get(url).status, 404)
            self.assertEqual(api.get(url + "/replay", chunk="0").status, 404)
        for sid in (tab(1), tab(5)):
            self.assertEqual(api.get(f"/api/session/{sid}").status, 200)
        self.assertEqual(api.get("/api/sessions", range="all").body["total"], 2)
        after = api.get("/api/overview", range="all").body
        self.assertEqual((before["counts"]["all"], after["counts"]["all"]), (3, 2))
        self.assertEqual(before["page_views"]["all"] - after["page_views"]["all"], 2)

    def test_a_visits_own_id_lists_its_tab_sessions_not_itself_as_nothing_recorded(self):
        """A browser session id names a visit and no tab session: `agentcake delete` and its --dry-run printed
        "nothing recorded under" it above the tab sessions they deleted."""
        self.assertEqual([(item["id"], item["found"]) for item in self.deleted([BS])["sessions"]],
                         [(tab(3), True), (tab(4), True)])

    def test_an_id_that_names_nothing_is_still_reported_as_such(self):
        unknown = "f" * len(BS)
        self.assertEqual([(item["id"], item["found"]) for item in self.deleted([unknown])["sessions"]],
                         [(unknown, False)])

    def test_the_preview_names_the_whole_visit_and_changes_nothing(self):
        self.con.close()
        found = delete.preview([tab(3)])
        self.con = store.db()
        self.addCleanup(self.con.close)
        self.assertEqual(sorted(item["id"] for item in found["sessions"]), [tab(3), tab(4)])
        self.assertEqual(self.left(), [tab(1), tab(2), tab(3), tab(4), tab(5)])

    def backup_path(self):
        folder = os.path.join(paths.home(), SETTINGS["backup_dir"])
        os.makedirs(folder, exist_ok=True)
        return os.path.join(folder, "cake-backup.db")

    def backup_copy(self):
        backup = self.backup_path()
        self.con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        shutil.copyfile(paths.db_file(), backup)
        return backup

    def test_the_backups_lose_the_visits_rows_too(self):
        backup = self.backup_copy()
        # The backup has a tab the live collector has since moved to another visit.
        with closing(sqlite3.connect(backup)) as old:
            old.execute("UPDATE session_web SET visit_id=? WHERE session_id=?", (BS, tab(5)))
            old.commit()
        result = self.deleted([BS])
        self.assertGreater(result["backups"][0]["rows"], 0)
        copy = sqlite3.connect(backup)
        try:
            self.assertEqual(copy.execute("SELECT COUNT(*) FROM visits WHERE id=?", (BS,)).fetchone()[0], 0)
            self.assertEqual(copy.execute("SELECT COUNT(*) FROM sessions WHERE id IN (?, ?)", (tab(3), tab(4)))
                             .fetchone()[0], 0)
            self.assertEqual(copy.execute("SELECT id FROM sessions WHERE id=?", (tab(5),)).fetchone(), (tab(5),))
            self.assertEqual(copy.execute("SELECT COUNT(*) FROM visits").fetchone()[0], 2, "the others stay")
        finally:
            copy.close()

    def test_retry_cleans_the_backed_up_visit_and_its_tab_log_lines_after_an_interrupted_delete(self):
        backup = self.backup_copy()
        original_log = f"visit {BS}\nfirst tab {tab(3)}\nsecond tab {tab(4)}\nother tab {tab(5)}\n"
        with open(paths.log_file(), "w") as log:
            log.write(original_log)
        with closing(sqlite3.connect(backup)) as copy:
            copy.execute("CREATE TRIGGER refuse_delete BEFORE DELETE ON sessions "
                         "BEGIN SELECT RAISE(ABORT, 'backup deletion failed'); END")
        api = Client()
        payload = {"sessions": [BS]}
        first = api.post("/api/delete", payload)
        self.assertEqual(first.status, 500, first.body)
        self.assertIn("backup deletion failed", first.body["error"])
        self.assertEqual(api.get(f"/api/session/{BS}").status, 404)
        self.assertEqual(self.left(), [tab(1), tab(2), tab(5)])
        with closing(sqlite3.connect(backup)) as copy:
            self.assertEqual(copy.execute("SELECT session_id FROM session_web WHERE visit_id=? ORDER BY session_id",
                                          (BS,)).fetchall(), [(tab(3),), (tab(4),)])
            copy.execute("DROP TRIGGER refuse_delete")
        preview = delete.preview([BS])
        self.assertGreater(preview["backups"][0]["rows"], 1, "the backup still contains the tab sessions")
        self.assertEqual(preview["log_lines"], 3)
        with open(paths.log_file()) as log:
            self.assertEqual(log.read(), original_log)
        second = api.post("/api/delete", payload)
        self.assertEqual(second.status, 200, second.body)
        self.assertEqual(second.body["backups"][0]["rows"], preview["backups"][0]["rows"])
        self.assertEqual(second.body["log_lines"], preview["log_lines"])
        with closing(sqlite3.connect(backup)) as copy:
            for (table,) in copy.execute(store.SESSION_TABLES).fetchall():
                self.assertEqual(copy.execute(f"SELECT session_id FROM {table} WHERE session_id IN (?, ?)",
                                              (tab(3), tab(4))).fetchall(), [], table)
            self.assertEqual(copy.execute("SELECT id FROM sessions ORDER BY id").fetchall(),
                             [(tab(1),), (tab(2),), (tab(5),)])
            self.assertEqual(copy.execute("SELECT id FROM visits ORDER BY id").fetchall(), [(tab(1),), (tab(5),)])
        with open(paths.log_file()) as log:
            self.assertEqual(log.read(), f"other tab {tab(5)}\n")

    def test_an_older_backup_without_visit_columns_still_deletes_a_matching_id(self):
        self.deleted([BS])
        backup = self.backup_path()
        with closing(sqlite3.connect(backup)) as copy:
            copy.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY)")
            copy.execute("CREATE TABLE session_web (session_id TEXT PRIMARY KEY)")
            copy.executemany("INSERT INTO sessions VALUES (?)", [(BS,), (tab(5),)])
            copy.executemany("INSERT INTO session_web VALUES (?)", [(BS,), (tab(5),)])
            copy.commit()
        self.assertEqual(delete.preview([BS])["backups"][0]["rows"], 2)
        self.assertEqual(self.deleted([BS])["backups"][0]["rows"], 2)
        with closing(sqlite3.connect(backup)) as copy:
            self.assertEqual(copy.execute("SELECT id FROM sessions").fetchall(), [(tab(5),)])
            self.assertEqual(copy.execute("SELECT session_id FROM session_web").fetchall(), [(tab(5),)])

    def test_the_log_loses_the_lines_naming_the_visit(self):
        with open(paths.log_file(), "w") as log:
            log.write(f"error in {BS}\nanother line\nerror in {tab(4)}\n")
        result = self.deleted([tab(3)])
        self.assertEqual(result["log_lines"], 2)
        with open(paths.log_file()) as log:
            self.assertEqual(log.read(), "another line\n")


class Retention(JoinCase):
    def prune_at(self, now_ms, days=30):
        return store.prune(self.con, days, now_ms)

    def test_a_visit_goes_once_its_last_tab_session_is_older_than_the_retention(self):
        self.received = T0 - 40 * MS_PER_DAY  # tab 1 began 40 days ago, tab 2 joined it a minute later
        self.send(tab(1), T0)
        self.received = T0 - 29 * MS_PER_DAY  # tab 2's latest upload came 29 days ago
        self.send(tab(2), T0 + MINUTE_MS)
        self.assertEqual(self.grouping(), [[tab(1), tab(2)]])
        self.assertEqual(self.prune_at(T0), 0, "kept whole: its last tab session ended 29 days ago")
        self.assertEqual(sorted(s for (s,) in self.rows("SELECT id FROM sessions")), [tab(1), tab(2)])
        self.assertEqual(self.prune_at(T0 + 2 * MS_PER_DAY), 2, "31 days after: whole")
        self.assertEqual((self.rows("SELECT id FROM sessions"), self.rows("SELECT id FROM visits")), ([], []))

    def test_a_tab_session_in_no_visit_yet_goes_by_its_own_end(self):
        old = T0 - ms_from_days(31)
        self.con.execute("INSERT INTO sessions(id, start_ms, end_ms) VALUES(?,?,?)", (tab(9), old, old))
        self.assertEqual(self.prune_at(T0), 1)
        self.assertEqual(self.rows("SELECT id FROM sessions"), [])


if __name__ == "__main__":
    unittest.main()
