"""The ordered page-path report on the dashboard.

A visit advances through the chosen paths in time order, even when its views are in different tabs. Each step
counts the visit once, using the same eligible tabs and merged verdict as the dashboard's Paths table.
"""
from heapq import merge
from http import HTTPStatus
from itertools import groupby
from operator import itemgetter

from agentcake import config, judging, timezone, web_time
from agentcake.api import answers, periods, visits, web

MIN_STEPS = 2  # protocol: the report compares at least two steps


@answers.view
def view(request):
    range_key = answers.choice(request, "range", periods.range_keys())
    steps = request.query.get("step", [])
    if len(steps) < MIN_STEPS or any(not step.startswith("/") or "?" in step or "#" in step for step in steps):
        return answers.error(HTTPStatus.BAD_REQUEST, "bad_funnel_steps")
    judging.catch_up()
    start = periods.window(range_key, periods.now_ms(), timezone.chosen(config.load_cfg()))[0]
    scope = visits.Scope().between(start)
    con = visits.connect()
    try:
        web.fill(con, scope)
        with visits.snapshot(con):
            return answers.ok({"steps": report(con, scope, steps)})
    finally:
        con.close()


def report(con, scope, steps):
    """Counts by step and verdict; a view can advance the visit by at most one step."""
    counts = [{"path": path, **dict.fromkeys(web.COUNTED, 0)} for path in steps]
    candidates = web.visiting(scope, steps[0])
    for (_, verdict), tabs in groupby(_tabs(con, candidates), key=itemgetter(0, 1)):
        histories = [web_time.page_history(con, tab, url, start) for _, _, tab, url, start in tabs]
        step = 0
        for _, path in merge(*histories, key=itemgetter(0)):
            if path == steps[step]:
                counts[step][verdict] += 1
                step += 1
                if step == len(steps):
                    break
    return counts


def _tabs(con, candidates):
    """Only read history for visits with a view of the first step, and tabs that have any counted page views.

    Page views at the same time follow the tabs' start times and IDs.
    """
    return con.execute(
        f"WITH candidates AS (SELECT v.id, v.alone, {visits.VERDICT} AS verdict "
        f"FROM {visits.SESSIONS} WHERE {candidates.sql()}) "
        f"SELECT v.id, v.verdict, ps.id, ps.url, ps.start_ms FROM candidates v {visits.TABS} "
        "WHERE EXISTS (SELECT 1 FROM web_paths p WHERE p.session_id = ps.id) ORDER BY v.id, ps.start_ms, ps.id",
        candidates.args)
