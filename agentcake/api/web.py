"""GET /api/web?range=24h|7d|30d|all: the dashboard's web analytics: how many visitors, and the
Sources, Devices and Geography tables, the way PostHog's web analytics shows them (Visitors = uniq(person_id) in
products/web_analytics/backend/hogql_queries/web_overview.py; one row per breakdown value with its visitors and views
in stats_table.py).

First the sessions with data newer than their verdict are judged (judging.catch_up, as the dashboard does), and the
range's sessions that no first page record has described yet are described from what was kept of them
(web_props.fill, at most data/web_analytics.json fill_sessions per request). Then, over the sessions that count in
the range (visits.py: a session spans its browser's tabs; web_sessions.py reads what each one's numbers are made
of: its page views in all its tabs, its visitor, source, device and place from its first tab):

    visitors   {"all", "agent", "human", "bot", "without"}: all, the distinct visitors of the range's sessions;
               agent, human and bot, those of its sessions of that verdict (a visitor with a Human and an Agent
               session is in both, so the four don't add up to all); 0 without such sessions, null when there
               are some but none has a visitor id;
               without, the sessions that have none (recorded before cake.js kept one: never counted as visitors).
               A visitor is a person as PostHog counts them (uniq(person_id), the anonymous distinct id merged into
               the person its $identify names, its earlier events included): a session counts as the identify hash
               it carried (window.cake.identify(), web_props.py), else as the hash its visitor id was first sent
               with in any session, before the range or after it, else as its visitor id (_count_as). So one
               visitor signed in on two browsers counts once, and two who signed in one after the other on one
               browser, with window.cake.reset() between them, count twice; without identify() each visitor id
               counts once, as before
    tables     {"sources" | "devices" | "geography": [{"dimension", "rows"}]}, over the Human and Agent sessions (bots
               are left out, as on the rest of the dashboard: Total = Agent + Human), the dimensions in
               web_dimensions.TABLES' order; a row is {"key", "value", "country", "agent", "human", "visitors",
               "agent_visitors", "human_visitors", "page_views", "agent_page_views", "human_page_views"}: key is what
               /api/sessions?dimension=&key= takes
               (null: the sessions without a value), value and country what the row shows (web_dimensions.label),
               agent and human its sessions, visitors, agent_visitors and human_visitors the distinct visitors of
               its sessions, of its Agent ones and of its Human ones (0 without such sessions, null when none of
               them has one), page_views its
               sessions' page views (as page_views below). Most sessions first, then most visitors, most page views,
               the value; the top rows_max by the sessions of each kind the table can show (all, Agent, Human),
               together (_tops)
    page_views {"all", "agent", "human", "bot"}: the page views of the range's sessions, of each verdict, PostHog's
               (web_time.py: each page load and each new path; all includes bots, as the dashboard's All cards do)
    active_time {"all" | "agent" | "human" | "bot": {"active_ms", "total_ms"} or null}: Microsoft Clarity's Active
               time spent, the average of the sessions' time less the time their page was hidden (web_time.active;
               over a session's tabs the union of the time each was shown, web_sessions.py), and their average time;
               all of the range's sessions, and its Agent, Human and Bot ones; null without
    time_zone  what the Trends chart's note calls the timezone its days and hours are in, AgentCake's
               (timezone.short): "PST", "UTC", "UTC+05:45"
    trends     {"interval", "every", "points"}: the Trends chart, by hour for the last 24 hours and by day for the last 7
               and 30 days, as PostHog's web analytics graphs them (frontend/src/lib/utils/dateFilters.ts dateMapping),
               and by day for All time too, which PostHog graphs by month (data/web_analytics.json trend_interval);
               points: each hour or day from the range's first (All time: the first session's) to the current one
               (periods.buckets: the last 24 hours have 25, the hour 24 hours ago and the current one among them),
               in AgentCake's timezone, {"key", "label", "agent",
               "human"}: of the Agent and of the Human sessions that began in it (bots are left out, as on the
               dashboard's charts), {"sessions", "visitors", "page_views", "active_ms", "pages_per_session"}: as the
               cards count them, visitors as above (0 without sessions, null when none has a visitor id), active_ms
               the average active time (null without a time), pages_per_session page views / sessions (null without);
               key is the hour or day ("2026-11-15 07", "2026-11-15") the page finds weekdays and months by; every
               is which points the time axis names (data/web_analytics.json trend_every: every Nth, or "month")
    agents     Top agents: the range's Agent sessions (Agent only and Human + agent; never a bot) by agent name (null:
               the ones no name fits, Unnamed; a session two agents acted in, in two tabs, counts for each), most
               sessions first, then the name (as /api/overview's agents_seen):
               {"name", "sessions", "visitors", "page_views", "active_ms", "pages_per_session"}, each counted as the
               cards and the Trends chart count it
    paths      the Path table, over the Human and Agent sessions: per path (a page view's location.pathname, PostHog's
               $pathname) {"path", "agent", "human", "visitors", "agent_visitors", "human_visitors", "page_views",
               "agent_page_views", "human_page_views"}: the sessions that viewed it, their distinct visitors and
               their page views of it, in all, Agent and Human; most sessions first, then visitors, page views, the
               path; the top rows_max of each kind, together, as the tables
    shown      how many rows a table shows before "Show all"
    place      where the country, region and city come from (places.answer: the city database on a server):
               {"source", "attribution"}. Country has a Not set row wherever there is a source of
               places (source "database", or "missing": a server whose city database is not downloaded yet, whose
               sessions are then all Not set, and which downloads it at its first monthly check); with source "none" (on this
               computer) the three show only what sessions recorded on a server brought, and the dashboard says they
               come only on a server. Region and City never count a session without a country (PostHog breaks them
               down by country): a country's sessions without a region or a city are that country's own Not set row
"""
from collections import defaultdict

from agentcake import config, geoip, judging, store, timezone, web_props
from agentcake.api import answers, periods, places, visits, web_dimensions, web_sessions
from agentcake.api.visits import AGENT_VERDICT, VERDICT
from agentcake.datafiles import load

COUNTED = ("agent", "human")  # the verdicts the tables are made of (bots are counted on their own)
VISITOR_GROUPS = ("agent", "human", "bot")  # the verdicts visitors and page views are counted by, besides all of them
PERSON, VISITOR = "person", "visitor"  # what a session's visitor is counted as: an identify hash, or a visitor id
TIME_GROUPS = ("agent", "human", "bot")  # the verdicts active time is averaged by, besides all of them


def settings():
    return load("data/web_analytics.json")


@answers.view
def view(request):
    range_key = answers.choice(request, "range", periods.range_keys())
    judging.catch_up()
    c = config.load_cfg()
    now, zone = periods.now_ms(), timezone.chosen(c)
    start = periods.window(range_key, now, zone)[0]
    scope = visits.Scope().between(start)
    con = visits.connect()
    try:
        fill(con, scope)
        sessions = web_sessions.load(con, scope)
        _count_as(sessions, first_hashes(con))
        paths = _paths(con, scope)
    finally:
        con.close()
    place = places.answer(c)
    counted = [session for session in sessions if session["verdict"] in COUNTED]
    return answers.ok({"visitors": visitors(sessions), "page_views": page_views(sessions),
                       "active_time": active_time(sessions),
                       "trends": trends(sessions, range_key, start, now, zone), "time_zone": timezone.short(zone, now),
                       "agents": agents(sessions),
                       "paths": path_rows(paths, sessions), "tables": tables(counted, place["source"]),
                       "shown": settings()["rows_shown"], "place": place})


def fill(con, scope):
    """Describe the tab sessions of the scope's sessions that no first page record has (web_props.fill), in a
    transaction of its own."""
    ids = [session_id for (session_id,) in con.execute(
        f"SELECT ps.id FROM {visits.SESSIONS} {visits.TABS} WHERE {scope.sql()} AND pw.entry_t IS NULL "
        "ORDER BY ps.start_ms DESC LIMIT ?", scope.args + (settings()["fill_sessions"],))]
    if not ids:
        return
    with store.LOCK:
        web_props.fill(con, ids)
        con.commit()


def first_hashes(con):
    """{visitor id: the identify hash it was first sent with}, over every session whenever it began, as PostHog merges
    an anonymous distinct id into the person of its first $identify (a later identify() over another hash, without
    reset(), merges nothing: posthog-js sends $identify only while the distinct id is anonymous)."""
    found = {}
    for visitor, person in con.execute("SELECT w.visitor, w.person FROM session_web w JOIN sessions s "
                                       "ON s.id = w.session_id WHERE w.person IS NOT NULL AND w.visitor IS NOT NULL "
                                       "ORDER BY s.start_ms, s.id"):
        found.setdefault(visitor, person)
    return found


def _count_as(sessions, hashes):
    """Give each session the visitor it is counted as (the module docstring): (PERSON, its own identify hash), else
    (PERSON, the first hash its visitor id was sent with), else (VISITOR, its visitor id), else None."""
    for session in sessions:
        person = session["person"] or hashes.get(session["visitor"])
        session["counted_as"] = ((PERSON, person) if person else
                                 (VISITOR, session["visitor"]) if session["visitor"] else None)


def _distinct(sessions, verdicts=None):
    """How many visitors the sessions (of these verdicts) are counted as: 0 without such sessions, None when there
    are some but none has a visitor id (recorded before cake.js kept one)."""
    chosen = [s for s in sessions if verdicts is None or s["verdict"] in verdicts]
    found = {s["counted_as"] for s in chosen if s["counted_as"]}
    return len(found) if found or not chosen else None


def visitors(sessions):
    by_verdict = {group: _distinct(sessions, (group,)) for group in VISITOR_GROUPS}
    return {"all": _distinct(sessions), **by_verdict, "without": sum(1 for s in sessions if not s["counted_as"])}


def page_views(sessions):
    return {"all": sum(s["page_views"] for s in sessions),
            **{group: sum(s["page_views"] for s in sessions if s["verdict"] == group) for group in VISITOR_GROUPS}}


def _average_time(sessions):
    """{"active_ms", "total_ms"}: the sessions' average active time and time, whole ms; None without a time."""
    times = [s["time"] for s in sessions if s["time"]]
    if not times:
        return None
    return {"active_ms": round(sum(a for a, _ in times) / len(times)),
            "total_ms": round(sum(t for _, t in times) / len(times))}


def active_time(sessions):
    return {"all": _average_time(sessions),
            **{group: _average_time([s for s in sessions if s["verdict"] == group]) for group in TIME_GROUPS}}


def trends(sessions, range_key, start, now, zone):
    interval = settings()["trend_interval"][range_key or periods.ALL_TIME]
    if start is None:
        start = min((s["start_ms"] for s in sessions), default=now)
    by_key = defaultdict(list)
    for session in sessions:
        by_key[periods.interval_key(interval, session["start_ms"], zone)].append(session)
    return {"interval": interval, "every": settings()["trend_every"][range_key or periods.ALL_TIME],
            "points": [{"key": key, "label": label,
                        **{group: _trend_numbers([s for s in by_key[key] if s["verdict"] == group]) for group in COUNTED}}
                       for key, label in periods.buckets(interval, start, now, zone)]}


def _trend_numbers(sessions):
    views, times = sum(s["page_views"] for s in sessions), _average_time(sessions)
    return {"sessions": len(sessions), "visitors": _distinct(sessions), "page_views": views,
            "active_ms": times["active_ms"] if times else None,
            "pages_per_session": views / len(sessions) if sessions else None}


def agents(sessions):
    """Top agents (see the module docstring): the Agent sessions grouped by their agents' names, a session two agents
    acted in (in two tabs) in each one's group."""
    by_name = defaultdict(list)
    for session in sessions:
        if session["verdict"] == AGENT_VERDICT:
            for name in session["agents"]:
                by_name[name].append(session)
    found = [{"name": name, **_trend_numbers(group)} for name, group in by_name.items()]
    return sorted(found, key=lambda agent: (-agent["sessions"], agent["name"] or ""))


def _paths(con, scope):
    """{path: {session id: page views}} of the scope's Human and Agent sessions, in all their tabs."""
    found = defaultdict(dict)
    for session_id, path, views in con.execute(
            f"SELECT v.id, p.path, SUM(p.views) FROM {visits.SESSIONS} {visits.TABS} JOIN web_paths p ON "
            f"p.session_id = ps.id WHERE {scope.sql()} AND {VERDICT} IN (?, ?) GROUP BY v.id, p.path",
            scope.args + COUNTED):
        found[path][session_id] = views
    return found


def visiting(scope, path):
    """The Paths table's sessions for a stored pathname, once per visit regardless of its views or tabs."""
    member = (f"EXISTS (SELECT 1 FROM sessions ps JOIN web_paths p ON p.session_id = ps.id "
              f"WHERE ps.id IN {visits.TAB_IDS} AND {visits.tab_counts('ps')} AND p.path = ?)")
    return scope.where(f"{VERDICT} IN (?, ?)", *COUNTED).where(member, path)


def path_rows(paths, sessions):
    """The Path table: per path its sessions, visitors and page views, each in all, Agent and Human; most sessions
    first, then visitors, page views, the path; the top rows_max of each kind, together (_tops)."""
    by_id = {s["id"]: s for s in sessions}
    out = []
    for path, viewed in paths.items():
        group = [by_id[session_id] for session_id in viewed if session_id in by_id]
        out.append({"path": path, **_counted(group, lambda session, viewed=viewed: viewed[session["id"]])})
    out.sort(key=lambda row: (*_rank(row), row["path"]))
    return _tops(out)


def tables(sessions, source):
    return {table: [{"dimension": dimension, "rows": rows(sessions, dimension, source)}
                    for dimension in dimensions]
            for table, dimensions in web_dimensions.TABLES.items()}


def rows(sessions, dimension, source=geoip.DATABASE):
    """The rows of one dimension (see the module docstring); source: geoip.source's, where the places come from."""
    groups = defaultdict(list)
    for session in sessions:
        groups[session[dimension]].append(session)
    found = [{"key": key, **web_dimensions.label(dimension, key), **_counted(group, lambda session: session["page_views"])}
             for key, group in groups.items() if _shown(dimension, key, source)]
    found.sort(key=lambda row: (*_rank(row), row["value"] is None, row["value"] or ""))
    return _tops(found)


def _shown(dimension, key, source):
    """Whether a row of sessions without a value (key None) is shown: Not set, except for a place where it cannot be
    known (no source of places) and for a region or a city without a country, which neither table counts."""
    if key is not None or dimension not in web_dimensions.PLACE:
        return True
    return dimension not in web_dimensions.PER_COUNTRY and source != geoip.NONE


def _counted(group, views):
    """A table row's numbers (the module docstring): its Agent and Human sessions, their distinct visitors (all, Agent,
    Human) and their page views (all, Agent, Human); views(session) is a session's page views the row counts (all of
    them, or those of the row's path)."""
    of = {verdict: [s for s in group if s["verdict"] == verdict] for verdict in COUNTED}
    page_views = {verdict: sum(views(s) for s in found) for verdict, found in of.items()}
    return {**{verdict: len(found) for verdict, found in of.items()},
            "visitors": _distinct(group), **{f"{verdict}_visitors": _distinct(group, (verdict,)) for verdict in COUNTED},
            "page_views": sum(page_views.values()), **{f"{verdict}_page_views": n for verdict, n in page_views.items()}}


def _rank(row):
    """Most sessions first, then most visitors, then most page views."""
    return -(row["agent"] + row["human"]), -(row["visitors"] or 0), -row["page_views"]


def _tops(rows):
    """rows (most sessions first) cut to the top rows_max by all sessions, by Agent sessions and by Human sessions,
    together and in their order: the table shows the top rows of whichever kind is chosen, by its own sessions (ties
    in this order)."""
    limit, keep = settings()["rows_max"], set()
    for count in (lambda row: row["agent"] + row["human"], lambda row: row["agent"], lambda row: row["human"]):
        ranked = sorted(range(len(rows)), key=lambda i: -count(rows[i]))
        keep.update(i for i in ranked[:limit] if count(rows[i]))
    return [row for i, row in enumerate(rows) if i in keep]
