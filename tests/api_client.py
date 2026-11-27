"""What the /api tests share: a client that asks the local listener's views as the local page does, and the
contract's schemas to check every answer against.

    Client()                      get(path, **query) and post(path, body, ...) -> Answer(status, body, headers);
                                  the request names this computer's local page (Host, and Origin on a POST)
    contract_problems(value, name)    where an answer breaks web/src/data/schema/<name>.schema.json
"""
import http.client
import json
import os
import sys
from collections import namedtuple
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import json_schema  # noqa: E402
from agentcake import config, routes  # noqa: E402
from agentcake.responses import Request  # noqa: E402

Answer = namedtuple("Answer", "status body headers")
_SCHEMAS = []


def contract_problems(value, name):
    if not _SCHEMAS:
        _SCHEMAS.append(json_schema.load_schemas())
    return json_schema.problems(value, name, _SCHEMAS[0])


class Client:
    """Asks the local listener's views directly, with the headers the local page's own requests carry."""

    def __init__(self, host=None):
        self.host = host or f"127.0.0.1:{config.load_cfg()['port']}"

    def get(self, path, headers=None, **query):
        return self.send("GET", path, b"", headers, query)

    def post(self, path, body, content_type="application/json", headers=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        sent = {"Content-Type": content_type, "Origin": f"http://{self.host}", **(headers or {})}
        return self.send("POST", path, raw, sent, {})

    def send(self, method, path, body, headers, query):
        message = http.client.HTTPMessage()
        for name, value in {"Host": self.host, **(headers or {})}.items():
            if value is not None:
                message[name] = value
        url = urlsplit(path)
        view = routes.resolve(routes.LOCAL, method, url.path)
        query = {name: list(value) if isinstance(value, (list, tuple)) else [value]
                 for name, value in query.items() if value is not None}
        answer = view(Request(url.path, query, message, body))
        text = answer.body.decode() if isinstance(answer.body, bytes) else answer.body
        return Answer(answer.status, json.loads(text) if answer.ctype.startswith("application/json") else text,
                      answer.headers)
