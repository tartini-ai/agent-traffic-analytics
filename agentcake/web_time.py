"""A session's page views by path and its active time: the web_paths table and the session_web
columns first_t, last_t, hidden_ms, hidden_since, vis_t and vis_pv.

Page views are PostHog's ($pageview, with posthog-js's default capture_pageview 'history_change'): each page load
(cake.js's page record, with its path) and each new path within it (its path record, static/src/navigation.js; a new
query string alone is none), so going A, B, A is three. A session begun on a page after 30 minutes without activity
has no page view of its own until the next page load or path, as PostHog sends no $pageview then. A page record of an
older cake.js has no path: the path of its batch's address is taken. An older cake.js sent no path records either: a
single-page app's pages are counted from its batches, one for each page view and one each time a batch's path
differs from the one before it in the same page view; a cake 0.3.4 visit, which has no batches, is one page view of
its landing address.

Active time is Microsoft Clarity's "Active time spent": the session's time, from its first record to its last, less
the time its page was hidden (document.visibilityState: the raw visibility records, and a page that opened hidden or
prerendered), which Clarity calls inactive time: another tab or window was in front of it. The changes of visibility
are followed in the order they happened, whatever order their batches arrive in: cake.js parks an exit batch too big
for keepalive and sends it after the next batch (static/src/transport.js), so the "hidden" of a page that was left
for a while often arrives after the "visible" that ended it. Each change belongs to its page view: a page view that is
shown is the tab's from then on, and a "hidden" counts only while its page view is the tab's, since the page being
left fires its last "hidden" as it unloads, which its clock may put after the next page's first record (two
documents, two clocks), and a page shown again from the back-forward cache is the tab's again. vis_t is the time of
the latest change followed and vis_pv the page view that is the tab's after it; a batch with a change older than vis_t,
or the first one of a row kept before vis_t was, is followed again from the start with every change kept of the
session (only then are its stored records read).

    keep(con, batch)                       collect: what one accepted batch adds, in the caller's transaction
    fill(con, session_id, records, rows, url)   a session recorded before this: records, its stored (stream,
                                           record, page view) triples, oldest first; rows, batch_rows(); url, its
                                           landing address
    page_history(con, session_id, url, start) -> [(time, path)]: the timed history of a tab with counted views
    active(first_t, last_t, hidden_ms, hidden_since) -> (active_ms, total_ms) or None without a time
    session_active(con, tabs) -> (active_ms, total_ms) or None: a session's over its tabs, each tab
                                           (session_id, first_t, last_t, hidden_ms, hidden_since): the union of the
                                           time each was shown, the time the website was in front (never their sum),
                                           and the time from the first record of any to the last; one tab's active()
    visible_spans(con, session_id, first_t, last_t) -> [(from, to)]: when its page was shown, followed again from
                                           every change kept of it (their lengths add up to active()'s active time)
    union_ms(spans) -> how long the (from, to) spans of any number of tabs cover together

session_active and visible_spans only read: the database through the connection they are given, and the chunk files
under the data folder (paths.home(), CAKE_HOME), as streams.read_events reads every replay; they write nothing and open
no connection of their own (no store.db()). To count a database in another folder (agentcake session-counts --db),
point CAKE_HOME at that folder while it reads, as evaluation/store.py does.
"""
import json
from collections import Counter, namedtuple

from agentcake import addresses, streams
from agentcake.datafiles import load

SCRIPT = load("data/cakejs.json")["script"]
SIGNALS, RAW = "env", "raw"  # the streams cake.js's signal and raw input records are kept in (upload.RECORD_FIELDS)
PAGE, PATH, VISIBILITY = "page", SCRIPT["navigation"]["record"], "visibility"  # protocol: cake.js's record kinds
MARKS = {kind: f'"ty":"{kind}"' for kind in (PAGE, PATH, VISIBILITY)}  # as a record's compact JSON text says it
VISIBLE_AT_LOAD = "visible"  # protocol: document.visibilityState of a page shown when it loads (the page record's vis)
HIDDEN = 0  # protocol: a raw visibility record's vs while the page is hidden
ROOT = "/"  # protocol: the path of an address without one


def keep(con, batch):
    """Add a batch's page views, widen the session's time to its records' and follow its page's visibility."""
    times = [record.ts for records in batch.records.values() for record in records]
    if not times:
        return
    con.execute("UPDATE session_web SET first_t=MIN(COALESCE(first_t, ?), ?), last_t=MAX(COALESCE(last_t, ?), ?) "
                "WHERE session_id=?", (min(times), min(times), max(times), max(times), batch.session))
    signals = [json.loads(record.text) for record in batch.records.get(SIGNALS, ())
               if MARKS[PAGE] in record.text or MARKS[PATH] in record.text]
    _add_views(con, batch.session, Counter(_path_of(record, batch.url) for record in signals))
    changes = _changes((stream, record.text, record.page) for stream in (SIGNALS, RAW)
                       for record in batch.records.get(stream, ()))
    if changes:
        _follow_changes(con, batch.session, changes)


def fill(con, session_id, records, rows, url=None):
    """Write a session's page views, time and hidden time from what was kept of it (see the module docstring): its time
    from every record kept, whatever its stream (_kept_span), as keep() widens it batch by batch."""
    signals = [(record["t"], record, page) for stream, record, page in records
               if stream == SIGNALS and record.get("ty") in (PAGE, PATH)]
    if _has_paths(signals):
        counted = Counter(path for _, path in _signal_views(signals, rows, url))
    else:
        counted = Counter(path for _, path in _batch_views(rows)) or Counter({_path(url): 1})
    con.execute("DELETE FROM web_paths WHERE session_id=?", (session_id,))
    _add_views(con, session_id, counted)
    changes = _in_order([(*_visibility(record), page) for stream, record, page in records if _is_change(stream, record)])
    hidden_ms, since, shown = _follow(changes, 0, None, None)
    con.execute("UPDATE session_web SET first_t=?, last_t=?, hidden_ms=?, hidden_since=?, vis_t=?, vis_pv=? "
                "WHERE session_id=?", (*_kept_span(con, session_id), hidden_ms, since,
                                       changes[-1][0] if changes else None, shown, session_id))


def batch_rows(con, session_id):
    """(page view, URL, time) in the order cake.js numbered the batches of each view."""
    return con.execute("SELECT pv, url, COALESCE(t, recv_ms) FROM batches WHERE session_id=? ORDER BY pv, seq",
                       (session_id,)).fetchall()


def page_history(con, session_id, url, start):
    """Page loads and SPA path changes, oldest first. Older batches can supply paths without a page or path signal."""
    signals = []
    for t, _, text, page in streams.read_events(con, session_id, [SIGNALS], with_page=True):
        if MARKS[PAGE] in text or MARKS[PATH] in text:
            record = json.loads(text)
            if record.get("ty") in (PAGE, PATH):
                signals.append((t, record, page))
    if _has_paths(signals):
        rows = batch_rows(con, session_id) if any(not r.get("p") for _, r, _ in signals) else []
        return _signal_views(signals, rows, url)
    opened = {page: t for t, record, page in signals if record.get("ty") == PAGE}
    return sorted(_batch_views(batch_rows(con, session_id), opened), key=lambda view: view[0]) or [(start, _path(url))]


def _has_paths(signals):
    return any(record.get("ty") == PATH or "p" in record for _, record, _ in signals)


def _signal_views(signals, rows, url):
    """A pathless page signal takes the first batch address for its page view, or the tab's landing address."""
    urls = {}
    for page, address, _ in rows:
        urls.setdefault(page, address)
    return [(t, _path_of(record, urls.get(page, url))) for t, record, page in signals]


def _kept_span(con, session_id):
    """(first, last) time of the records kept of a session in every stream, from the chunks' bounds and cake 0.3.4's
    small events, nothing decoded; (None, None) without any."""
    return con.execute("SELECT MIN(t0), MAX(t1) FROM (SELECT t_start AS t0, t_end AS t1 FROM chunks WHERE session_id=:s "
                       "UNION ALL SELECT t_start, t_end FROM open_chunks WHERE session_id=:s "
                       "UNION ALL SELECT ts, ts FROM events WHERE session_id=:s)", {"s": session_id}).fetchone()


def active(first_t, last_t, hidden_ms, hidden_since):
    """(active_ms, total_ms) of a session: its time less the time its page was hidden; None without a time."""
    if first_t is None or last_t is None:
        return None
    total = max(0, last_t - first_t)
    hidden = (hidden_ms or 0) + (max(0, last_t - hidden_since) if hidden_since is not None else 0)
    return max(0, total - hidden), total


TabTime = namedtuple("TabTime", "session_id first_t last_t hidden_ms hidden_since")  # a tab's session_web columns


def session_active(con, tabs):
    """(active_ms, total_ms) of a session over its tabs (see the module docstring); None without a time. A session of
    one tab is active() of it; tabs whose times never overlap are read no further, since the union of what they showed
    is then the sum of their active times; otherwise each tab's stretches are followed again (visible_spans)."""
    listed = [TabTime(*tab) for tab in tabs]
    if len(listed) == 1:
        one = listed[0]
        return active(one.first_t, one.last_t, one.hidden_ms, one.hidden_since)
    timed = sorted((tab for tab in listed if tab.first_t is not None and tab.last_t is not None),
                   key=lambda tab: tab.first_t)
    if not timed:
        return None
    total = max(tab.last_t for tab in timed) - timed[0].first_t
    if all(before.last_t <= after.first_t for before, after in zip(timed, timed[1:])):
        shown = sum(active(tab.first_t, tab.last_t, tab.hidden_ms, tab.hidden_since)[0] for tab in timed)
    else:
        shown = union_ms([span for tab in timed
                          for span in visible_spans(con, tab.session_id, tab.first_t, tab.last_t)])
    return max(0, shown), max(0, total)


def visible_spans(con, session_id, first_t, last_t):
    """[(from, to)] of first_t … last_t while the session's page was shown: every change kept of it followed from the
    start, as _follow_changes() follows them, the stretches it was hidden left out (a page still hidden at the end is
    hidden until last_t). Their lengths add up to active()'s active time of the same session."""
    if first_t is None or last_t is None:
        return []
    kept = _changes((stream, text, page) for _, stream, text, page in
                    streams.read_events(con, session_id, [SIGNALS, RAW], with_page=True))
    hidden, since, _ = _hidden(kept, None, None)
    if since is not None:
        hidden.append((since, last_t))
    spans, at = [], first_t
    for start, end in hidden:
        start, end = min(start, last_t), min(max(start, end), last_t)  # one that closed before it opened hides nothing
        if start > at:
            spans.append((at, start))
        at = max(at, end)
    if at < last_t:
        spans.append((at, last_t))
    return [(start, end) for start, end in spans if end > start]


def union_ms(spans):
    """How long the (from, to) spans cover together: a moment two tabs were both shown counts once."""
    covered, until = 0, None
    for start, end in sorted(spans):
        if until is None or start > until:
            covered, until = covered + (end - start), end
        elif end > until:
            covered, until = covered + (end - until), end
    return covered


def _add_views(con, session_id, counted):
    con.executemany("INSERT INTO web_paths(session_id, path, views) VALUES(?,?,?) ON CONFLICT(session_id, path) DO "
                    "UPDATE SET views=views+excluded.views", [(session_id, path, n) for path, n in counted.items()])


def _path_of(record, url):
    """The path of a page view: its record's own (a path record's, a page record's), else its address's."""
    path = record.get("p")
    return path if isinstance(path, str) and path else _path(url)


def _path(url):
    """The path of an address; the root for none, or for one that cannot be read (an upload's u is any text)."""
    return addresses.path(url) or ROOT


def _is_change(stream, record):
    """Whether a record says how the page is shown: a raw visibility record, or a page record."""
    return record.get("ty") == (VISIBILITY if stream == RAW else PAGE)


def _changes(items):
    """The (time, hidden, page view) changes of (stream, record text, page view) items, oldest first; only those
    records are parsed."""
    found = []
    for stream, text, page in items:
        if MARKS[VISIBILITY] in text or MARKS[PAGE] in text:
            record = json.loads(text)
            if _is_change(stream, record):
                found.append((*_visibility(record), page))
    return _in_order(found)


def _in_order(changes):
    """Oldest first; at the same moment a page view shown before one hidden (the one that is left counts no longer)."""
    return sorted(changes, key=lambda change: (change[0], change[1]))


def _follow_changes(con, session_id, changes):
    """Follow a batch's changes (oldest first) on from the session's row, or, for a batch with a change older than the
    latest one followed (vis_t) or a row without vis_t, from the start with every change kept of the session as well
    (see the module docstring). The batch's own records are not stored yet: it is kept before them."""
    hidden_ms, since, followed, shown = con.execute(
        "SELECT hidden_ms, hidden_since, vis_t, vis_pv FROM session_web WHERE session_id=?", (session_id,)).fetchone()
    if followed is None or changes[0][0] < followed:
        kept = _changes((stream, text, page) for _, stream, text, page in
                        streams.read_events(con, session_id, [SIGNALS, RAW], with_page=True))
        changes, hidden_ms, since, shown = _in_order(kept + changes), 0, None, None
    hidden_ms, since, shown = _follow(changes, hidden_ms, since, shown)
    con.execute("UPDATE session_web SET hidden_ms=?, hidden_since=?, vis_t=?, vis_pv=? WHERE session_id=?",
                (hidden_ms, since, changes[-1][0], shown, session_id))


def _visibility(record):
    """(time, hidden): a raw visibility record, or a page record (hidden when the page did not open visible)."""
    if record.get("ty") == PAGE:
        return record["t"], record.get("vis", VISIBLE_AT_LOAD) != VISIBLE_AT_LOAD
    return record["t"], record.get("vs") == HIDDEN


def _follow(changes, hidden_ms, since, shown):
    """The hidden time, since when the tab is hidden, and the page view that is the tab's, after these (time, hidden,
    page view) changes, oldest first (see the module docstring)."""
    closed, since, shown = _hidden(changes, since, shown)
    for start, end in closed:
        hidden_ms += max(0, end - start)
    return hidden_ms, since, shown


def _hidden(changes, since, shown):
    """The (from, to) stretches the tab was hidden that these (time, hidden, page view) changes close, oldest first,
    then since when it is still hidden and the page view that is the tab's after them (see the module docstring)."""
    closed = []
    for t, hidden, page in changes:
        if not hidden:
            shown = page
            if since is not None:
                closed.append((since, t))
                since = None
        elif since is None and shown in (None, page):
            since, shown = t, page
    return closed, since, shown


def _batch_views(rows, opened=None):
    """An older cake.js's page views: each view's first path and each change of path between its batches."""
    opened, last = opened or {}, {}
    for page_view, url, t in rows:
        path = _path(url)
        if last.get(page_view) != path:
            yield (t if page_view in last else opened.get(page_view, t), path)
            last[page_view] = path
