"""The value of each threshold of eval/thresholds.json on each data set, from the tables.

    collect(results, settings, limit_s) -> [measurement]     what gate.judge() reads

A measurement: {"threshold", "source", "value", "n", "count" (when the value is count / n), "what", plus "groups"
(A9) or "details" (medians, largest values, misses)}. Which data sets the gate judges and which it only prints is
eval/thresholds.json's "data"; this module measures every data set that has the samples. The statistic of each
threshold is its "statistic" in thresholds.json; the code below is that sentence.
"""
from agentcake.evaluation import recorded_cohorts, sessions, takeovers
from agentcake.evaluation.stats import tally

AGENTLIKE = ("agent", "mixed")
RECORDED = "recorded"  # the data set of the recorder's agents that A2 judges; every other label is "recorded/<label>"
SELFCOLLECT = sessions.SELFCOLLECT  # the recordings we ran ourselves: "selfcollect/<label>", printed only
NOT_JUDGED = ("too_little_data", "excluded")
NO_HIT, OFF = "no_hit", "off"


def collect(results, settings, limit_s):
    rows, out = results["rows"], []
    out += [_a1(source, rows.get(source, [])) for source in ("recordings", "posthog")]
    out += _a2(rows, settings)
    for source, items in results["takeovers"].items():
        out += _takeover(source, items, limit_s)
    out += [_a6(source, rows.get(source, []), settings["reasons"]["automated"])
            for source in ("lab_signals", "cakejs_uploads", "store")]
    named = rows.get("named", [])
    out.append(_ratio("A7", "named", sum(1 for r in named if sessions.right(r)), len(named),
                      "named User-Agents with the right list id and class"))
    out += [_a8(source, rows.get(source, [])) for source in ("lab", "recordings", RECORDED, "store", "posthog")]
    recorded = rows.get(RECORDED, [])
    for label in settings["recorded"].get("reference_human_labels", ()):
        cohort = [r for r in recorded if r["group"] == label and r["truth"].get("class") == "human"]
        if cohort:
            source = f"{RECORDED}/{label}"
            out.extend((_a1(source, cohort), _a8(source, cohort)))
    out.append(_a9(results["bots"]["t22"]))
    out.append(_n1(results.get("store_sessions", [])))
    return out


def _ratio(threshold, source, count, n, what, **extra):
    return {"threshold": threshold, "source": source, "value": count / n if n else None, "count": count, "n": n,
            "what": what, **extra}


def _a1(source, rows):
    humans = [r for r in rows if r["truth"].get("class") == "human" and r["class"] not in NOT_JUDGED]
    agents = sum(1 for r in humans if r["class"] == "agent")
    return _ratio("A1", source, agents, len(humans), "human sessions judged agent (whole session)",
                  details={"mixed": sum(1 for r in humans if r["class"] == "mixed"),
                           "not_judged": sum(1 for r in rows if r["truth"].get("class") == "human"
                                             and r["class"] in NOT_JUDGED)})


def _a2(rows, settings):
    """A2 over judged sessions, as its statistic says: too little data is left out (A8 counts it) and each line says
    how many it left out."""
    groups = set(settings["lab"]["a2_groups"])
    lab = [r for r in rows.get("lab", []) if r["group"] in groups]
    store = [r for r in rows.get("store", []) if r["truth"].get("class") == "agent"
             and (r["truth"].get("case") == "T3" or r["group"] in groups)]
    posthog = [r for r in rows.get("posthog", []) if r["group"] == settings["posthog"]["agent_group"]]
    out = [_judged_ratio(source, items) for source, items in (("lab", lab), ("store", store), ("posthog", posthog))]
    grok = [r for r in store if r["group"] == recorded_cohorts.GROK_BOT and r["truth"].get("case") == "T3"]
    if grok:
        out.append(_judged_ratio(f"store/{recorded_cohorts.GROK_BOT}", grok))
    return (out + _a2_recorded(rows.get(RECORDED, []), settings["recorded"]["a2_labels"])
            + _a2_self_collected(rows.get(SELFCOLLECT, [])))


def _judged_ratio(source, agents):
    judged = [r for r in agents if r["class"] not in NOT_JUDGED]
    return _ratio("A2", source, sum(1 for r in judged if r["class"] in AGENTLIKE), len(judged),
                  "local agent sessions judged agent or mixed", details={"not_judged": len(agents) - len(judged)})


def _a2_recorded(rows, a2_labels):
    """The recorder's agents (answer agent; hand-offs are A3-A5's): threshold A2's labels together in "recorded", every
    other label on a line of its own. Those with too little data are A8's, as for PostHog."""
    agents = {}
    for r in rows:
        if r["truth"].get("class") == "agent":
            source = RECORDED if r["group"] in a2_labels else f"{RECORDED}/{r['group']}"
            agents.setdefault(source, []).append(r)
    return [_recorded_ratio(RECORDED, agents.pop(RECORDED, []))] + [
        _recorded_ratio(source, members) for source, members in sorted(agents.items())]


def _a2_self_collected(rows):
    """The recordings we ran ourselves: one line per label, apart from people's recordings, their answers
    certain (we ran them). eval/thresholds.json says which lines A2 judges: cic-mcp, Claude in Chrome driven by Claude
    Code, the product threshold A2 names; every other label is printed and never judged."""
    agents = {}
    for r in rows:
        if r["truth"].get("class") == "agent":
            agents.setdefault(r["group"], []).append(r)
    return [_recorded_ratio(f"{SELFCOLLECT}/{label}", members) for label, members in sorted(agents.items())]


def _recorded_ratio(source, agents):
    judged = [r for r in agents if r["class"] not in NOT_JUDGED]
    by_label = {}
    for r in judged:
        cell = by_label.setdefault(r["group"], {"n": 0, "agent_or_mixed": 0})
        cell["n"] += 1
        cell["agent_or_mixed"] += r["class"] in AGENTLIKE
    return _ratio("A2", source, sum(1 for r in judged if r["class"] in AGENTLIKE), len(judged),
                  "recorded agent sessions judged agent or mixed",
                  details={"by_label": by_label, "not_judged": len(agents) - len(judged)})


def _takeover(source, items, limit_s):
    view = takeovers.summary(items, "verdict", limit_s)
    model = takeovers.summary(items, "model", limit_s)
    accuracy, error = view["accuracy_decided"], view["share_error_pp"]
    details = {"model_view": {"accuracy_median": model["accuracy_decided"]["median"],
                              "share_error_median": model["share_error_pp"]["median"],
                              "handoffs_within_limit": model["handoffs_within_limit"],
                              "handoffs_missed": model["handoffs_missed"]},
               "classes": view["classes"], "sessions": view["sessions"]}
    out = [{"threshold": "A3", "source": source, "value": accuracy["median"], "n": view["scored"],
            "what": "median per-action accuracy (decided actions)", "details": dict(details, p90=accuracy["p90"])},
           {"threshold": "A4", "source": source, "value": error["median"], "n": view["scored"],
            "what": "median agent-share error, points", "details": dict(details, largest=error["max"])}]
    if view["handoffs_true"]:
        out.append(_a5(source, view, details))
    return out


def _a5(source, view, details):
    """A5 over the true hand-offs of the sessions judged Human + agent: their median error, a miss counting as over
    the limit, and no samples when those sessions have none. Every true hand-off's numbers and how many mixed sessions
    were judged Human + agent ride along, printed and never judged."""
    inside = view["in_mixed"]
    every = {"true": view["handoffs_true"], "missed": view["handoffs_missed"],
             "within_limit": view["handoffs_within_limit"], "largest_found": view["handoff_error_s"]["max"],
             "extra": view["handoffs_extra"]}
    return {"threshold": "A5", "source": source, "value": inside["handoff_error_median_s"],
            "n": inside["handoffs_true"],
            "what": "median hand-off error in the sessions judged Human + agent, s (a miss is over the limit)",
            "details": dict(details, missed=inside["handoffs_missed"], within_limit=inside["handoffs_within_limit"],
                            largest_found=inside["handoff_error_s"]["max"], extra=inside["handoffs_extra"],
                            every_handoff=every, mixed_found=view["mixed_found"])}


def _a6(source, rows, automated_reason):
    browsers = [r for r in rows if r["truth"].get("row") == "automated" and r["truth"].get("class") == "agent"]
    right = [r for r in browsers if r["class"] == "agent" and r["row"] == "automated"
             and automated_reason in r["reasons"]]
    return _ratio("A6", source, len(right), len(browsers),
                  "automated browsers judged Agent, Automated browser, with the automated-browser reason",
                  details={"wrong": sorted({r["id"] for r in browsers if r not in right})})


def _a8(source, rows):
    """A8 over the sessions the behaviour layer saw too little of and no other layer names: each is too little data,
    or a Human when it is a real phone or tablet (its environment records fit one: the evidence's touch_fits)."""
    few = [r for r in rows if r["too_little"] and r["layers"].get("name") == NO_HIT
           and r["layers"].get("environment") in (NO_HIT, OFF)]
    shown = sum(1 for r in few if r["class"] == "too_little_data"
                or (r["class"] == "human" and (r.get("evidence") or {}).get("touch_fits")))
    return _ratio("A8", source, shown, len(few),
                  "phones, tablets and too few actions shown as too little data, a real phone or tablet as Human",
                  details={"classes": tally(r["class"] for r in few)})


def _a9(t22):
    return _ratio("A9", "store", t22["right"], t22["n"], "T22 sessions judged right",
                  groups={group: {"n": cell["n"], "right": cell["right"]} for group, cell in t22["groups"].items()})


def _n1(labelled):
    views = sum(item["page_views"] for item in labelled)
    tokens = sum(item["tokens"] for item in labelled)
    return _ratio("N1", "store", tokens, views, "page views whose token reached cake and matched the session")
