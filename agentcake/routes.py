"""The URL tables of the two listeners, like PostHog 1.0's posthog/urls.py: which view answers which path.

LOCAL is the local page on 127.0.0.1: the compiled pages (/ and their files), the JSON API they read (/api),
cake.js, the replay player's files, collect and /edge (0.4.0 removed the demo shop that was served at /demo). PUBLIC is
server mode's public listener (paths below path_prefix): only the page script, collect, /edge and a health check; the
local page is never served there. /edge takes a web server's log records signed with the server half's secret
(edge_api.py) on both. resolve() takes the first route that matches, so the compiled pages' catch-all comes last; no
match is 404.
"""
from collections import namedtuple

from agentcake import assets, collect, edge_api
from agentcake.api import (answers, deletion, funnel, health, onboarding, overview, registration, session, sessions,
                           settings, timezones, web)

Route = namedtuple("Route", "method path view is_prefix")
COLLECT = "/collect"  # the only path another origin may post to: server.py answers it with CORS on both listeners


def path(method, p, view):
    return Route(method, p, view, False)


def prefix(method, p, view):
    """Every path that starts with p, e.g. /api/session/<session id>."""
    return Route(method, p, view, True)


LOCAL = [
    path("GET", "/", assets.local_pages),
    path("GET", "/api/overview", overview.view),
    path("GET", "/api/web", web.view),
    path("GET", "/api/funnel", funnel.view),
    path("GET", "/api/sessions", sessions.view),
    prefix("GET", "/api/session/", session.view),
    path("GET", "/api/settings", settings.view),
    path("POST", "/api/settings", settings.save),
    path("GET", "/api/timezones", timezones.view),
    path("GET", "/api/setup", onboarding.view),
    path("GET", "/api/health", health.view),
    path("POST", "/api/delete", deletion.view),  # never on PUBLIC
    path("GET", "/api/register", registration.view),
    path("POST", "/api/register", registration.press),  # never on PUBLIC
    prefix("GET", "/api/", answers.no_route),
    prefix("POST", "/api/", answers.no_route),
    path("GET", "/c.js", assets.cake_js),
    path("GET", "/cake.js", assets.cake_js),
    prefix("GET", "/static/", assets.static_file),
    path("POST", COLLECT, collect.from_local),
    path("POST", edge_api.ROUTE, edge_api.receive),
    prefix("GET", "/", assets.web_file),
]

PUBLIC = [
    path("GET", "/healthz", health.healthz),
    path("GET", "/c.js", assets.cake_js),
    path("GET", "/cake.js", assets.cake_js),
    path("POST", COLLECT, collect.from_public),
    path("POST", edge_api.ROUTE, edge_api.receive),
]


def resolve(routes, method, p):
    """The view for this method and path, or None (p is None for a path outside the public listener's prefix)."""
    if p is None:
        return None
    for r in routes:
        if r.method == method and (p.startswith(r.path) if r.is_prefix else p == r.path):
            return r.view
    return None
