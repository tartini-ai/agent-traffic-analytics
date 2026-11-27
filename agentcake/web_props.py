"""What the web analytics tables group a session by: one session_web row per session.

PostHog's web analytics groups sessions by their entry properties and the browser they ran in; these are the same,
from what cake.js records (static/src/source.js, visitor.js) and what the collector already keeps:
    visitor            the visitor id of the session's uploads (the header's vid)
    person             the identify hash of the session's uploads (the header's idh), once the site called
                       window.cake.identify(): who the visitor is across browsers and devices, as a hash only; the
                       first one a session sent stays, as for the visitor id (api/web.py counts visitors by it)
    entry source       from the session's first page record or session record (cake.js's): the referring domain ('' for
                       none), the campaign parameters, the ad-click parameters that were there (names only), and the
                       channel PostHog's default rules give them (web_channel.py); entry_t: when that record was made
    browser, os, device_type   web_device.describe() of the User-Agent, with the environment record once it arrives;
                               a session cake.js began on an open page takes those of the page's session before it
    country, subdivision, city the city database's for the visitor's address, on a server with trust_lb (netfacts.py,
                               geoip.py); none on this computer
    language, tz_offset        the page record's (or the environment record's) navigator.language and time zone offset

    page views and active time  web_time.py
    keep(con, batch, visit)    collect: what one accepted batch says, in the caller's transaction (store.LOCK held)
    fill(con, session_ids)     the rows of sessions recorded before cake.js sent these fields (or whose first page
                               record was never read), from what was kept of them: the User-Agent, the network facts,
                               the page, environment and visibility records, the batches, the landing address, the
                               time span of every record kept. The
                               referrer of such a page record was sent whole; only its domain is taken. A session
                               without a page record gets the campaign parameters of its own address. A visitor id
                               cannot be made up afterwards: those sessions have none.
"""
import json
from collections import namedtuple
from urllib.parse import parse_qs

from agentcake import addresses, streams, web_channel, web_device, web_time
from agentcake.datafiles import load

SCRIPT = load("data/cakejs.json")["script"]
SOURCE = SCRIPT["source"]
SIGNALS, RAW = "env", "raw"  # the streams cake.js's signal and raw input records are kept in (upload.RECORD_FIELDS)
VISIBILITY_MARK = web_time.MARKS[web_time.VISIBILITY]
PAGE, SESSION, ENVIRONMENT = "page", SCRIPT["session"]["record"], "env"  # protocol: cake.js's record kinds
MARKS = {kind: f'"ty":"{kind}"' for kind in (PAGE, SESSION, ENVIRONMENT)}  # as a record's compact JSON text says it
AD_SOURCE = "gad_source"  # protocol: the campaign parameter PostHog's channel rules read besides the UTM ones
GCLID, FBCLID = "gclid", "fbclid"  # protocol: the click ids PostHog's channel rules read
CLICK_SEPARATOR = " "
GEO = ("country", "subdivision", "city")  # the place kept with the session (netfacts.net_facts)
Entry = namedtuple("Entry", "t referring_domain utm_source utm_medium utm_campaign utm_content utm_term gad_source "
                            "click_ids has_gclid has_fbclid language tz_offset")


def keep(con, batch, visit):
    """Write what one batch says of its session (see the module docstring)."""
    session = batch.session
    con.execute("INSERT OR IGNORE INTO session_web(session_id, tab_id) VALUES(?,?)", (session, session))
    if batch.visitor:
        con.execute("UPDATE session_web SET visitor=COALESCE(visitor, ?) WHERE session_id=?", (batch.visitor, session))
    if batch.person:
        con.execute("UPDATE session_web SET person=COALESCE(person, ?) WHERE session_id=?", (batch.person, session))
    if batch.user_agent:
        _device(con, session, batch.user_agent)
    if visit.net:
        _place(con, session, visit.net)
    for record in batch.records.get(SIGNALS, ()):
        if MARKS[PAGE] in record.text or MARKS[SESSION] in record.text:
            _entry(con, session, from_record(json.loads(record.text)))
            if MARKS[SESSION] in record.text:
                _device_of_page(con, session, batch.page_view)
        elif MARKS[ENVIRONMENT] in record.text:
            _environment(con, session, batch.user_agent, json.loads(record.text).get("env") or {})
    web_time.keep(con, batch)


def from_record(record):
    """The Entry of a page record or session record; None for a record of an older cake.js, which sent no source
    (its referrer, when it sent one, whole: fill() takes only the domain of it)."""
    if not isinstance(record.get("utm"), dict) or "rd" not in record:
        return None
    clicks = [name for name in SOURCE["click_ids"] if name in (record.get("ck") or ())]
    return _make_entry(record.get("t"), record.get("rd") or "", record["utm"], clicks, record.get("lang"),
                       record.get("tzo"))


def _make_entry(t, referring_domain, utm, clicks, language, tz_offset):
    cap = SOURCE["max_chars"]
    values = {name: (utm.get(name) or None) for name in SOURCE["campaign"]}
    values = {name: value[:cap] if isinstance(value, str) else None for name, value in values.items()}
    return Entry(t=t, referring_domain=referring_domain[:cap], utm_source=values["utm_source"],
                 utm_medium=values["utm_medium"], utm_campaign=values["utm_campaign"],
                 utm_content=values["utm_content"], utm_term=values["utm_term"], gad_source=values[AD_SOURCE],
                 click_ids=CLICK_SEPARATOR.join(clicks) or None, has_gclid=GCLID in clicks, has_fbclid=FBCLID in clicks,
                 language=language if isinstance(language, str) else None,
                 tz_offset=tz_offset if isinstance(tz_offset, int) else None)


def _entry(con, session, entry):
    """The entry source, when this record is earlier than the one it came from so far; the language and offset
    whenever they are not known yet."""
    if entry is None or not isinstance(entry.t, (int, float)):
        return
    con.execute("UPDATE session_web SET entry_t=?, referring_domain=?, utm_source=?, utm_medium=?, utm_campaign=?, "
                "utm_content=?, utm_term=?, gad_source=?, click_ids=?, channel=? WHERE session_id=? AND "
                "(entry_t IS NULL OR entry_t > ?)",
                (entry.t, entry.referring_domain, entry.utm_source, entry.utm_medium, entry.utm_campaign,
                 entry.utm_content, entry.utm_term, entry.gad_source, entry.click_ids, web_channel.channel(entry),
                 session, entry.t))
    _language(con, session, entry.language, entry.tz_offset)


def _device(con, session, user_agent):
    """The browser, system and device type the User-Agent names, where none is known yet."""
    con.execute("UPDATE session_web SET browser=COALESCE(browser, ?), os=COALESCE(os, ?), "
                "device_type=COALESCE(device_type, ?) WHERE session_id=?", (*web_device.describe(user_agent), session))


def _place(con, session, facts):
    """The session's country, region and city (netfacts.net_facts: the city database's), where none is known yet."""
    con.execute("UPDATE session_web SET country=COALESCE(country, ?), subdivision=COALESCE(subdivision, ?), "
                "city=COALESCE(city, ?) WHERE session_id=?", (*(facts.get(key) for key in GEO), session))


def _device_of_page(con, session, page_view):
    """A session cake.js began on an open page (its session record: after 30 minutes without activity, 24 hours or
    reset()) takes the device of the page's latest earlier session: the environment record, which can tell what the
    User-Agent does not (a tablet by its screen), is made once, when the page opens."""
    found = con.execute("SELECT w.browser, w.os, w.device_type FROM batches b JOIN session_web w ON w.session_id = "
                        "b.session_id WHERE b.pv=? AND b.session_id != ? AND w.device_type IS NOT NULL "
                        "ORDER BY b.recv_ms DESC LIMIT 1", (page_view, session)).fetchone()
    if found:
        con.execute("UPDATE session_web SET browser=?, os=?, device_type=? WHERE session_id=?", (*found, session))


def _language(con, session, language, tz_offset):
    con.execute("UPDATE session_web SET language=COALESCE(language, ?), tz_offset=COALESCE(tz_offset, ?) "
                "WHERE session_id=?", (language, tz_offset, session))


def _environment(con, session, user_agent, env):
    """The environment record: the device type with the screen and client hints, and the language and offset."""
    if user_agent or env.get("userAgent"):
        device = web_device.describe(user_agent or env.get("userAgent"), env)
        con.execute("UPDATE session_web SET browser=?, os=?, device_type=? WHERE session_id=?", (*device, session))
    offset = env.get("tzOffset")
    _language(con, session, env.get("language") if isinstance(env.get("language"), str) else None,
              offset if isinstance(offset, int) else None)


def fill(con, session_ids):
    """Fill in the rows of these sessions that no first page record of cake.js's has filled (see the docstring)."""
    for session_id in session_ids:
        row = con.execute("SELECT s.ua, s.url, s.net, s.start_ms, w.entry_t FROM sessions s LEFT JOIN session_web w "
                          "ON w.session_id = s.id WHERE s.id=?", (session_id,)).fetchone()
        if row is None:
            continue
        user_agent, url, net, start_ms, described = row
        if described is not None:
            continue
        con.execute("INSERT OR IGNORE INTO session_web(session_id, tab_id) VALUES(?,?)", (session_id, session_id))
        records = _stored_records(con, session_id)
        first = next((r for stream, r, _ in records if stream == SIGNALS and r.get("ty") in (PAGE, SESSION)), None)
        env = next((r.get("env") or {} for stream, r, _ in records if stream == SIGNALS and r.get("ty") == ENVIRONMENT),
                   None)
        rows = web_time.batch_rows(con, session_id)
        web_time.fill(con, session_id, records, rows, url)
        if env:
            _environment(con, session_id, user_agent, env)
        elif user_agent:
            _device(con, session_id, user_agent)
        _place(con, session_id, json.loads(net) if net else {})
        _entry(con, session_id, from_record(first or {}) or _old_entry(first, url, start_ms))


def _stored_records(con, session_id):
    """[(stream, record, page view)] of the session as kept, oldest first: every signal record, and the raw input
    records that say whether the page was shown (no other raw record is parsed)."""
    found = []
    for _, stream, text, page in streams.read_events(con, session_id, [SIGNALS, RAW], with_page=True):
        if stream == SIGNALS or VISIBILITY_MARK in text:
            found.append((stream, json.loads(text), page))
    return found


def _old_entry(record, url, start_ms):
    """The Entry of a session recorded before cake.js sent its source: the domain of the referrer its page record
    sent whole, and the campaign parameters and click ids of its landing address (none when the address cannot be
    read); made at its page record's time, or at the session's start without one."""
    record = record or {}
    query = _query(url)
    utm = {name: values[0] for name, values in query.items() if name in SOURCE["campaign"] and values}
    clicks = [name for name in SOURCE["click_ids"] if name in query]
    t = record.get("t") if isinstance(record.get("t"), (int, float)) else start_ms
    return _make_entry(t, _domain(record.get("ref")), utm, clicks, None, None)


def _query(address):
    """The query parameters of an address, {} for none or for an address urllib cannot read (an upload's u is any text:
    left unread, such a session would stop every request that describes sessions, as /api/web does)."""
    parts = addresses.split(address)
    return parse_qs(parts.query) if parts else {}


def _domain(address):
    """The host (and port) of an address, lower case, as the browser's URL.host gives it; '' for none or for one
    that cannot be read."""
    parts = addresses.split(address) if isinstance(address, str) else None
    return parts.netloc.rpartition("@")[-1].lower() if parts else ""
