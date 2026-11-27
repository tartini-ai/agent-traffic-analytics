"""Every table of `agentcake eval`, built from the data sources.load() found.

    build(data, settings, limit_s, with_logistic) -> results

results: "recorded_cohorts" (recorder reference counts by mode), "grok_bot_cohorts" (Grok Bot counts from a CAKE_HOME),
"rows" (each data set's sessions with their four-layer
verdict, sessions.py; a website's own labelled
sessions, "site", are held out: only the sessions table and the scoreboard's held-out cells read them), "scoreboard"
(the behaviour layer reported the industry's way, scoreboard.py), "heldout" (thresholds set from data, tested on the
sites they were not set from, heldout.py), "calibration" (the percents against the answers, calibration.py),
"segments" (the lab's per-segment test and its splices, segments.py), "takeovers" (mixed sessions per data set,
takeovers.py: splices of the lab's human-like scripts and of its Claude in Chrome with clean recordings, a splice's
human side always a real person, and of Claude in Chrome with PostHog's probably-human units; PostHog's mixed
replays; CAKE_HOME sessions with recorded hand-offs; the recorder's hand-offs, scored against the stretches between
their marks), "baselines" (baselines.py), "layers" (layers.py), "humans" (humans.py), "bots" (bots.py) and
"store_sessions" (N1's page views and tokens).

PostHog's data is split as the behaviour model's study split it: the validation set is every session that holds a mixed replay or a Claude
in Chrome unit; its splices pair those Claude in Chrome units with its own probably-human units, and the dev set's
pair the lab's Claude in Chrome recordings with the dev set's humans.
"""
from agentcake.detect import rrweb_events
from agentcake.evaluation import (baselines, behaviour, bots, calibration, evidence as evidence_builder, heldout,
                                  humans, layers, recorded_cohorts, scoreboard, segments, sessions, splice,
                                  takeovers)

HUMAN = {"class": "human", "row": None, "group": "clean-human"}
AUTOMATED = {"class": "agent", "row": "automated", "group": "automated-browser"}
SPLICE_TRUTH = "stretches"


def build(data, settings, limit_s, with_logistic=True):
    lab = data["lab"] or {}
    rows = {"lab": sessions.lab(lab, {s["id"]: s["signals"] for s in data["lab_signals"]}),
            "lab_signals": sessions.lab_signals(data["lab_signals"]),
            "cakejs_uploads": sessions.cakejs(data["uploads"], AUTOMATED),
            "recordings": sessions.recordings(data["recordings"], HUMAN),
            "recorded": sessions.recorded(data["recorded"]),
            sessions.SELFCOLLECT: sessions.recorded(data.get(sessions.SELFCOLLECT) or [], sessions.SELFCOLLECT),
            "store": sessions.store(data["store"]), sessions.SITE: sessions.site(data.get(sessions.SITE) or []),
            "named": sessions.named(data["named"]),
            "public_humans": sessions.public_humans(data.get("public_humans") or [])}
    posthog = data["posthog"]
    if posthog:
        rows["posthog"] = sessions.posthog(posthog["units"], lambda u: behaviour.posthog_group(u, settings["posthog"]),
                                           lambda unit, group: posthog_truth(unit, group, settings))
    lab_segments = {run: {"segment_group": s["segment_group"], "events": s["raw"]} for run, s in lab.items()}
    cohorts = settings["recorded"].get("mode_cohorts", {})
    references = [r for r in rows["recorded"] if r["group"] in cohorts]
    reference_ids = {r["id"] for r in references}
    benchmark_rows = dict(rows, recorded=[r for r in rows["recorded"] if r["id"] not in reference_ids])
    handoffs = _recorded_handoffs(data["recorded"], rows["recorded"], limit_s)
    store_handoffs = {s["h"]: _handoff_row(s["evidence"], s["truth"][SPLICE_TRUTH], limit_s)
                      for s in data["store"] if s["truth"].get(SPLICE_TRUTH)}
    takeover_rows = {**_takeovers(lab, data, posthog, settings, limit_s, store_handoffs),
                     "recorded_handoffs": [r for h, r in handoffs.items() if h not in reference_ids]}
    return {"rows": rows,
            "recorded_cohorts": recorded_cohorts.build(references, handoffs, cohorts, limit_s),
            "grok_bot_cohorts": recorded_cohorts.grok_bot(rows["store"], store_handoffs, limit_s),
            "segments": {"single_source": segments.single_source(lab_segments, settings) if lab else [],
                         "lab_splices": segments.splices(lab_segments, settings, with_logistic) if lab else []},
            "takeovers": takeover_rows,
            "scoreboard": scoreboard.build(benchmark_rows, takeover_rows, settings, limit_s),
            "heldout": heldout.build(_heldout_sessions(data, benchmark_rows, settings), settings),
            "calibration": calibration.build(benchmark_rows, settings),
            "baselines": _baselines(lab, data, rows, settings, with_logistic),
            "layers": {"by_half": layers.by_half(_layered(rows), settings),
                       "by_layer": layers.by_layer(_layered(rows), settings)},
            "humans": humans.table(rows["recordings"]),
            "bots": {"named": bots.named_table(rows["named"]), "t22": bots.t22_table(rows["store"], settings)},
            "store_sessions": [{"h": s["h"], "page_views": s["page_views"], "tokens": s["tokens"]}
                               for s in data["store"]]}


def _heldout_sessions(data, rows, settings):
    """Every session with a known answer and its events, as heldout.build() reads them: the lab, the recorder's
    recordings (people's and the ones we ran ourselves, each its own data set), the public humans and PostHog's units
    (rrweb only, so raw_input False)."""
    board = settings["scoreboard"]
    lab = {run: (s["raw"], True, False) for run, s in (data["lab"] or {}).items()}
    recorder = {item["h"]: (item["raw"], True, False) for item in data["recordings"] + data["recorded"]}
    self_collected = {item["h"]: (item["raw"], True, False) for item in data.get(sessions.SELFCOLLECT) or []}
    public = {item["h"]: (item["events"], True, item["touch"]) for item in data.get("public_humans") or []}
    posthog = {u["h"]: (u["events"], False, u["touch"]) for u in (data["posthog"] or {}).get("units", [])}
    events_of = {"lab": lab, "recordings": recorder, "recorded": recorder, sessions.SELFCOLLECT: self_collected,
                 "public_humans": public, "posthog": posthog}
    found = [(r, *events_of[source][r["id"]]) for source in events_of for r in rows.get(source, [])]
    return [{"source": r["source"], "group": r["group"], "product": board["products"].get(r["group"], r["group"]),
             "site": r.get("site") or board["sites"].get(r["source"], r["source"]), "truth": r["truth"].get("class"),
             "weak": bool(r["truth"].get("weak")),
             "events": events, "raw_input": raw_input, "touch": touch}
            for r, events, raw_input, touch in found if r["truth"].get("class") in ("human", "agent") and events]


def _takeovers(lab, data, posthog, settings, limit_s, store_handoffs):
    group = settings["lab"]
    cic_raw = [(run, s["raw"]) for run, s in lab.items() if s["segment_group"] == group["splice_agent"]]
    humanlike = [(run, s["raw"]) for run, s in lab.items() if s["segment_group"] == group["splice_humanlike"]
                 and splice.usable(s["raw"])]  # agents: a splice's human side is a real person (eval.json "lab")
    humans_raw = [(r["h"], r["raw"]) for r in data["recordings"] if splice.usable(r["raw"])]
    out = {"lab_splices": takeovers.splice_rows(humanlike, humans_raw, True, limit_s),
           "recording_splices": takeovers.splice_rows(cic_raw, humans_raw, True, limit_s),
           "store": list(store_handoffs.values())}
    if posthog:
        out.update(_posthog_takeovers(lab, posthog, settings, limit_s))
    return out


def _recorded_handoffs(items, rows, limit_s):
    """The recorder's hand-offs: each action's answer is the stretch it lies in, the true hand-offs the first action
    of each stretch that follows the other side's (splice.boundaries, as for a T5 session of a CAKE_HOME).
    Keyed by the recorder hash so reference hand-offs can be counted separately."""
    evidence = {r["id"]: r["evidence"] for r in rows}
    return {item["h"]: _handoff_row(evidence[item["h"]], item["stretches"], limit_s)
            for item in items if item["stretches"] and item["truth"] != "human"}


def _handoff_row(evidence, stretches, limit_s):
    return takeovers.session_row(evidence, _who_at(stretches), splice.boundaries(stretches), limit_s)


def _posthog_takeovers(lab, posthog, settings, limit_s):
    ph = settings["posthog"]
    units = posthog["units"]
    held_out = behaviour.validation_sessions(units, posthog["mixed"], ph, ph["agent_group"])
    out = {"posthog_mixed": [takeovers.session_row(
        evidence_builder.behaviour_only(m["events"], False, session_start=m["first_rrweb_t"]),
        lambda t, m=m: "agent" if m["agent_at"](t) else "human", [], limit_s) for m in posthog["mixed"]]}
    for name, validation in (("posthog_splices", True), ("posthog_splices_dev", False)):
        side = [u for u in units if (u["session"] in held_out) == validation]
        humans_ = [(u["h"], u["events"]) for u in side if u["label"] == ph["labels"]["human"] and not u["touch"]
                   and splice.usable(u["events"])]
        if validation:
            agents = [(u["h"], u["events"]) for u in side if behaviour.posthog_group(u, ph) == ph["agent_group"]
                      and splice.usable(u["events"])]
        else:
            agents = [(run, rrweb_events.events_from_rrweb(s["rrweb"])) for run, s in lab.items()
                      if s["segment_group"] == settings["lab"]["splice_agent"]]
        out[name] = takeovers.splice_rows(agents, humans_, False, limit_s)
    return out


def _baselines(lab, data, rows, settings, with_logistic):
    """Every baseline's call on each session that has events, grouped as the session rows are."""
    items = []
    signals = {s["id"]: s["signals"] for s in data["lab_signals"]}
    trained = baselines.logistic_flags(
        [(run, s["class"], s["segment_group"], s["raw"]) for run, s in lab.items()]
        + [(r["h"], "human", r["h"], r["raw"]) for r in data["recordings"]], settings) if with_logistic else {}
    for run, s in lab.items():
        items.append({"group": f"lab / {s['group']}", "flags": dict(baselines.flags(
            s["raw"], True, _first_env(signals.get(run)), settings), logistic=trained.get(run))})
    for r in data["recordings"]:
        items.append({"group": "recordings / clean-human", "flags": dict(baselines.flags(
            r["raw"], True, _first_env_of_payloads(r["payloads"]), settings), logistic=trained.get(r["h"]))})
    for r in rows.get("posthog", []):
        behaviour_result = r["evidence"]["behavior"]
        if behaviour_result and behaviour_result["verdict"] != "too_little_data":
            unit_events = _posthog_events(data, r["id"])
            items.append({"group": f"posthog / {r['group']}", "flags": baselines.flags(
                unit_events, False, None, settings, session_start=_posthog_start(data, r["id"]))})
    return baselines.table(items)


def _layered(rows):
    """The rows whose evidence has more than behaviour, for the tables that take parts of it away."""
    return [r for source in ("lab", "lab_signals", "cakejs_uploads", "recordings", "store") for r in rows[source]]


def posthog_truth(unit, group, settings):
    """A PostHog unit's answer: the one its dataset gives (the training set: truth, truth_strength); the site
    owner's presumed humans (the user's own labels showed many of them were agents, settings "posthog.untrusted") and
    labels the user has yet to confirm (pending) are weak answers ("weak"), reported on their own and left out of
    every pool and fit; else the PostHog study's answer by group."""
    labels = settings["posthog"]
    if unit.get("truth") is not None:
        if unit["truth"] not in ("human", "agent"):
            return {}
        weak = group in (labels["owner_presumed"], labels["pending"])
        return {"class": unit["truth"], "weak": True} if weak else {"class": unit["truth"]}
    if group in (labels["owner_group"], "visitor"):
        return {"class": "human"}
    return {"class": "agent"} if group != "unknown" else {}


def _who_at(stretches):
    truth = [tuple(stretch) for stretch in stretches]
    return lambda t: splice.who_at(truth, t)


def _first_env(signals):
    pages = (signals or {}).get("pages") or []
    return next((page["env"] for page in pages if page.get("env")), None)


def _first_env_of_payloads(payloads):
    return next(((report.get("snap") or {}).get("env") for report in payloads
                 if (report.get("snap") or {}).get("env")), None)


def _posthog_events(data, h):
    return next(u["events"] for u in data["posthog"]["units"] if u["h"] == h)


def _posthog_start(data, h):
    return next(u["start"] for u in data["posthog"]["units"] if u["h"] == h)
