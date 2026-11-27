"""GET /api/sessions?verdict=&turns=&evidence=&agent=&range=&dimension=&key=&path=&cursor=: the session list,
one page at a time (the session list page draws it).

First the sessions with data newer than their verdict are judged (judging.catch_up); then, newest first, the sessions
that count (visits.py) with the verdict (visits.VERDICTS; none or "all" is every verdict), of an Agent session's
split `turns` (agent_only or human_agent, which narrows the list to Agent sessions), on thin `evidence` (Human sessions
cake could not tell), of the agent named exactly as agent_names lists it, in the range. A page holds data/api.json
page_size sessions; `next` is an opaque cursor for the page after it (the last row's start and id: rows added since do
not shift the pages), null on the last page; total is how many sessions every filter keeps. counts are under the agent
and range filters whatever the verdict and split; agent_names (the named agents: an agent no name fits has no name
to filter by) under the range only, so the agent filter can always be changed. dimension and key keep the sessions of
one row of the dashboard's Sources, Devices or Geography tables (web_dimensions.py; dimension without key: the
sessions with no value; key sent empty: the empty value, a referring domain's visits without a referrer), as PostHog's
web analytics opens the recordings of a row. path keeps the Agent and Human sessions that viewed an exact path
in any counted tab, as the dashboard's Paths table does. Every count is under these filters too.
"""
import base64
import binascii
from http import HTTPStatus

from agentcake import config, judging, timezone
from agentcake.api import answers, periods, visits, web, web_dimensions

CURSOR_SEPARATOR = ":"
BASE64_BLOCK = 4  # protocol: base64 text comes in blocks of 4 characters


@answers.view
def view(request):
    verdict = answers.choice(request, "verdict", ("all",) + visits.VERDICTS)
    turns = answers.choice(request, "turns", visits.TURNS)
    evidence = answers.choice(request, "evidence", visits.EVIDENCE)
    agent = answers.text_param(request, "agent")
    range_key = answers.choice(request, "range", periods.range_keys())
    dimension = answers.choice(request, "dimension", tuple(web_dimensions.EXPRESSIONS))
    path = answers.text_param(request, "path")
    after = read_cursor(answers.text_param(request, "cursor"))
    judging.catch_up()
    now, size, zone = periods.now_ms(), answers.numbers()["page_size"], timezone.chosen(config.load_cfg())
    scope = visits.Scope().between(periods.window(range_key, now, zone)[0])
    con = visits.connect()
    try:
        if path:
            web.fill(con, scope)
            scope = web.visiting(scope, path)
        if dimension:
            scope = web_dimensions.where(scope, dimension, answers.given_param(request, "key"))
        listed = scope.agent(agent)
        rows = listed.group(verdict).group(turns).group(evidence)
        with visits.snapshot(con):
            results, keys = visits.page(con, rows.before(after) if after else rows, size + 1, now, zone)
            body = {"counts": visits.counts(con, listed), "total": visits.total(con, rows),
                    "agent_names": [name for name, _ in visits.agents(con, scope) if name], "results": results[:size],
                    "next": cursor(keys[size - 1]) if len(results) > size else None, "page_size": size}
    finally:
        con.close()
    return answers.ok(body)


def cursor(key):
    start_ms, session_id = key
    return base64.urlsafe_b64encode(f"{start_ms}{CURSOR_SEPARATOR}{session_id}".encode()).decode().rstrip("=")


def read_cursor(text):
    """(start_ms, id) of a cursor this view gave out, None for none; Refused (400) for anything else."""
    if text is None:
        return None
    try:
        start, _, session_id = base64.urlsafe_b64decode(text + "=" * (-len(text) % BASE64_BLOCK)).decode().partition(
            CURSOR_SEPARATOR)
        if not session_id:
            raise ValueError(text)
        return int(start), session_id
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise answers.Refused(answers.error(HTTPStatus.BAD_REQUEST, "bad_cursor")) from None
