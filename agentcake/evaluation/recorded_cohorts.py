"""Reference counts for recorder cohorts and for Grok Bot visits in an AgentCake data folder."""
from agentcake.evaluation import takeovers
from agentcake.evaluation.sessions import TOO_LITTLE
from agentcake.evaluation.stats import tally

AGENT_OR_MIXED = ("agent", "mixed")
DASH = "—"
GROK_BOT = "grok-bot"
GROK_CASES = {"T3": "agent", "T5": "mixed"}


def build(rows, handoffs, cohorts, limit_s):
    """Use every loaded session in each cohort, including ones with too little data or missing mode."""
    groups = {}
    for row in rows:
        label, truth = row["group"], row["truth"]
        cohort = cohorts.get(label)
        if cohort is None or truth["class"] not in cohort["truth"]:
            continue
        mode = truth.get("mode")
        surface = mode if mode in cohort["modes"] else None
        groups.setdefault((label, surface, truth["class"]), []).append(row)
    cells = []
    for (label, mode, truth), members in groups.items():
        cell = {"label": label, "mode": mode, "truth": truth, "sessions": len(members),
                "classes": tally(row["class"] for row in members)}
        name = cohorts[label].get("name")
        if name and truth == "agent":
            cell["expected_name"] = name
            cell["named_agent_or_mixed"] = sum(row["class"] in AGENT_OR_MIXED and row["name"] == name
                                              for row in members)
        if truth == "mixed":
            cell["handoffs"] = _handoffs([handoffs[r["id"]] for r in members if r["id"] in handoffs], limit_s)
        cells.append(cell)
    return sorted(cells, key=lambda c: (c["label"], c["mode"] or "", c["truth"]))


def _handoffs(rows, limit_s):
    """Count truth boundaries even when the session produced no timeline. Errors match the direction of the handoff."""
    errors = [error for row in rows if row["verdict"] for error in row["verdict"]["handoff_errors_s"]]
    found = [error for error in errors if error is not None]
    return {"true": sum(row["true_handoffs"] for row in rows), "found": len(found),
            "within_limit": sum(error <= limit_s for error in found)}


def markdown(cells, limit_s):
    if not cells:
        return []
    lines = ["## Antigravity recording cohorts", "",
             "| label | mode | truth | sessions | Agent | Mixed | Too little data | Agent or Mixed with expected "
             f"name | hand-offs found / true (within {limit_s} s) |", "|---|---|---|---|---|---|---|---|---|"]
    for cell in cells:
        n, classes = cell["sessions"], cell["classes"]
        name, handoffs = cell.get("expected_name"), cell.get("handoffs")
        named = f"{cell['named_agent_or_mixed']}/{n} (`{name}`)" if name else DASH
        timed = (f"{handoffs['found']}/{handoffs['true']} ({handoffs['within_limit']})"
                 if handoffs and handoffs["true"] else DASH)
        lines.append(f"| {cell['label']} | {cell['mode'] or 'unverified'} | {cell['truth']} | {n} | "
                     f"{classes.get('agent', 0)} | {classes.get('mixed', 0)} | {classes.get(TOO_LITTLE, 0)} | "
                     f"{named} | {timed} |")
    return lines + [""]


def grok_bot(rows, handoffs, limit_s):
    """Count all labelled T3 and T5 visits loaded from a CAKE_HOME, including visits with too little data."""
    groups = {}
    for row in rows:
        truth = row["truth"]
        expected = GROK_CASES.get(truth.get("case"))
        if row["group"] == GROK_BOT and expected and truth.get("class") == expected:
            groups.setdefault(expected, []).append(row)
    cells = []
    for truth, members in sorted(groups.items()):
        cell = {"truth": truth, "sessions": len(members), "classes": tally(row["class"] for row in members),
                "names": tally(row["name"] for row in members if row["name"]),
                "named_agent_or_mixed": sum(row["class"] in AGENT_OR_MIXED and row["name"] == GROK_BOT
                                            for row in members)}
        if truth == "mixed":
            cell["handoffs"] = _grok_handoffs(members, handoffs, limit_s)
        cells.append(cell)
    return cells


def _grok_handoffs(members, handoffs, limit_s):
    marks = [handoffs[row["id"]] for row in members if row["id"] in handoffs]
    timed = [row for row in marks if row["true_handoffs"]]
    a5 = takeovers.summary(timed, "verdict", limit_s)["in_mixed"]
    return {**_handoffs(timed, limit_s), "without_truth": len(members) - len(timed),
            "without_timeline": sum(row["verdict"] is None for row in timed),
            "a5_samples": a5["handoffs_true"], "a5_median_s": a5["handoff_error_median_s"]}


def grok_bot_markdown(cells, limit_s):
    if not cells:
        return []
    lines = ["## Grok Bot recording cohorts", "",
             "| Visit type | Sessions | Agent | Mixed | Too little data | Agent or Mixed | Agent or Mixed, named "
             "Grok Bot | Other names |", "|---|---|---|---|---|---|---|---|"]
    for cell in cells:
        classes, n = cell["classes"], cell["sessions"]
        agent, mixed = (classes.get(who, 0) for who in AGENT_OR_MIXED)
        visit = "Agent only" if cell["truth"] == "agent" else "Takeover"
        others = ", ".join(f"`{name}` ({count})" for name, count in sorted(cell["names"].items())
                           if name != GROK_BOT) or DASH
        lines.append(f"| {visit} | {n} | {agent} | {mixed} | {classes.get(TOO_LITTLE, 0)} | "
                     f"{agent + mixed}/{n} | {cell['named_agent_or_mixed']}/{n} | {others} |")
    lines += ["", "The Mixed column for Agent only visits counts false Mixed verdicts.", ""]
    handoffs = next((cell["handoffs"] for cell in cells if "handoffs" in cell), None)
    if handoffs:
        lines += _grok_handoff_markdown(handoffs, limit_s)
    return lines


def _grok_handoff_markdown(handoffs, limit_s):
    median, samples = handoffs["a5_median_s"], handoffs["a5_samples"]
    shown = "over the limit" if median is None else f"{median:.3g} s"
    measured = f"{shown} ({samples})" if samples else DASH
    return [f"| Direction-matched handoffs | Within {limit_s:g} s | Visits without handoff marks | "
            "Marked visits without a verdict timeline | A5 median (handoffs) |", "|---|---|---|---|---|",
            f"| {handoffs['found']}/{handoffs['true']} | {handoffs['within_limit']} | {handoffs['without_truth']} | "
            f"{handoffs['without_timeline']} | {measured} |", "",
            "Coverage includes all marked handoffs. A5 uses scored Mixed visits and counts misses as over the limit.",
            ""]
