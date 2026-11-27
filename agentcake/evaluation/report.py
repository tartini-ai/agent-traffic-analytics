"""`agentcake eval`'s report as Markdown: the gate first, then every table, each value with its sample size.

    markdown(results, verdicts, where, notes, limit_s) -> text
    markdown_gate(verdicts) -> [lines]       the gate's table alone

Rows name sessions by lab run names and 12-hex short hashes only (never a path, an address or a PostHog id); data
sets that were not given are named with what to give. The JSON next to it (agentcake/eval.py) holds every row.
"""
from agentcake.evaluation import recorded_cohorts, sessions, takeovers
from agentcake.units import PERCENT

DASH = "—"
VIEWS = (("verdict", "product view (four-layer class decides each action)"), ("model", "model view (timeline)"))
PRECISION_COLUMNS = ("data set / product", "recall", "humans")
STATUS = {"pass": "pass", "fail": "**FAIL**", "no_data": "no data", "elsewhere": "measured elsewhere"}
NOT_JUDGED = "not judged"
EVERY_HANDOFF = ("every true hand-off, whatever its session was judged: found (missed), share within the limit, "
                 "largest error found, extra hand-offs marked")
MIXED_FOUND = "mixed sessions judged Human + agent / mixed sessions"
OVER_THE_LIMIT = "over the limit"  # a median that is a missed hand-off


def markdown(results, verdicts, where, notes, limit_s):
    lines = ["# agentcake eval", ""]
    lines += markdown_gate(verdicts) + _sources(where, notes, results) + _scoreboard(results["scoreboard"], limit_s)
    lines += _heldout(results["heldout"]) + _calibration(results["calibration"]) + _sessions(results["rows"])
    lines += recorded_cohorts.markdown(results.get("recorded_cohorts", []), limit_s)
    lines += recorded_cohorts.grok_bot_markdown(results.get("grok_bot_cohorts", []), limit_s)
    lines += _humans(results["humans"]) + _takeovers(results["takeovers"], limit_s)
    lines += _segments(results["segments"]) + _baselines(results["baselines"]) + _layers(results["layers"])
    lines += _bots(results["bots"])
    return "\n".join(lines) + "\n"


def _number(value, unit=None):
    if value is None:
        return DASH
    if unit == "share":
        return f"{PERCENT * value:.1f}%"
    return f"{value:.3g}" if isinstance(value, float) else str(value)


def _measurement(m, unit):
    """One data set's value: a ratio as a percentage with its count and how many sessions it left out unjudged (too
    little data, or no visit), so that a smaller denominator never reads as a better result; a statistic with its
    sample size."""
    details = m.get("details") or {}
    left_out = f"{details['not_judged']} left out (too little data or no visit)" if details.get("not_judged") else ""
    if not m["n"]:
        return f"{m['source']}: no samples" + (f" ({left_out})" if left_out else "")
    if "count" in m:
        notes = [f"{details['mixed']} mixed"] if details.get("mixed") else []
        if left_out:
            notes.append(left_out)
        tail = "".join(f"; {note}" for note in notes)
        return f"{m['source']}: {_number(m['value'], unit)} ({m['count']}/{m['n']}{tail})"
    value, extra = _number(m["value"]), ""
    if "every_handoff" in details:
        value = OVER_THE_LIMIT if m["value"] is None else value
        extra = (f"; missed {details['missed']}, within the limit {_number(details['within_limit'], 'share')}, "
                 f"largest found {_number(details['largest_found'])} s")
    elif "largest" in details:
        extra = f"; largest {_number(details['largest'])}"
    return f"{m['source']}: {value} (n={m['n']}{extra})"


def markdown_gate(verdicts):
    """The gate's table: each threshold, its status, the gated values and the reference ones."""
    lines = ["## Gate (eval/thresholds.json)", "",
             "| # | goal | status | gated value (samples) | reference only | measurement |",
             "|---|---|---|---|---|---|"]
    for v in verdicts:
        gated = "; ".join(_measurement(m, v["unit"]) + (f" {STATUS[m['status']]}" if m["n"] else "")
                          for m in v["gated"]) or DASH
        unmeasured = [source for source in v["missing"] if source not in {m["source"] for m in v["gated"]}]
        if unmeasured and v["status"] != "elsewhere":
            gated += f"; no data from: {', '.join(unmeasured)}"
        reference = "; ".join(_measurement(m, v["unit"]) for m in v["reference"]
                              if m["n"] or (m.get("details") or {}).get("not_judged")) or DASH
        where = v["measured_by"] if v["status"] == "elsewhere" else v["statistic"]
        lines.append(f"| {v['id']} | {v['goal']} | {STATUS[v['status']]} | {gated} | {reference} | {where} |")
        lines += _beside_handoffs(v)
    return lines + [""]


def _beside_handoffs(v):
    """Two rows under the hand-off threshold, never judged: every true hand-off, whatever its session was judged, and
    how many of the mixed sessions were judged Human + agent; each data set where it stands, gated or reference.
    Nothing for a threshold whose measurements do not carry them."""
    if not any("every_handoff" in (m.get("details") or {}) for m in v["gated"] + v["reference"]):
        return []
    lines = []
    for cell, about in ((_every_handoff, EVERY_HANDOFF), (_mixed_found, MIXED_FOUND)):
        gated, reference = (_cells(v[part], cell) for part in ("gated", "reference"))
        lines.append(f"| {v['id']} (reference) | {DASH} | {NOT_JUDGED} | {gated} | {reference} | {about} |")
    return lines


def _cells(measurements, cell):
    return "; ".join(f"{m['source']}: {cell(m['details'])}" for m in measurements
                     if "every_handoff" in (m.get("details") or {})) or DASH


def _every_handoff(details):
    every = details["every_handoff"]
    return (f"found {every['true'] - every['missed']}/{every['true']} (missed {every['missed']}), within the limit "
            f"{_number(every['within_limit'], 'share')}, largest found {_number(every['largest_found'])} s, "
            f"extra {every['extra']}")


def _mixed_found(details):
    judged = details["mixed_found"]
    share = judged["count"] / judged["n"] if judged["n"] else None
    return f"{_number(share, 'share')} ({judged['count']}/{judged['n']})"


def _sources(where, notes, results):
    lines = ["## Data", "", "| data set | sessions | note |", "|---|---|---|"]
    counts = {source: len(items) for source, items in results["rows"].items()}
    counts.update({source: len(items) for source, items in results["takeovers"].items()})
    for source in sorted(counts):
        lines.append(f"| {source} | {counts[source]} | {notes.get(_note_key(source), '')} |")
    for key, note in sorted(notes.items()):
        if key not in {_note_key(s) for s in counts}:
            lines.append(f"| {key} | 0 | {note} |")
    return lines + [""]


def _note_key(source):
    return {"lab": "lab_sessions", "cakejs_uploads": "cakejs_uploads"}.get(source, source)


def _rate(rate, bound="both"):
    """k/n with its share and exact 95% interval: both ends, or only the upper one (a false positive rate)."""
    if not rate["n"]:
        return f"0/0 {DASH}"
    share = _number(rate["value"], "share")
    if bound == "high":
        return f"{rate['k']}/{rate['n']} ({share}, ≤ {_number(rate['high'], 'share')})"
    return f"{rate['k']}/{rate['n']} ({share}, {_number(rate['low'], 'share')}–{_number(rate['high'], 'share')})"


def _scoreboard(board, limit_s):
    """The behaviour layer reported the industry's way (scoreboard.py): agents, humans, precision, sites, mixed."""
    lines = ["## Behaviour layer scoreboard (industry-standard metrics)", "",
             "Every rate with its exact 95% interval (Clopper–Pearson); for a false positive rate, its upper end. "
             "Evaluable: enough actions to judge (the rest is too little data). Recall and false positives are the "
             "behaviour model's own verdict on the evaluable sessions; recall on all sessions is what a site sees; "
             "four layers: the class Agent or Mixed. rec.: raw cake.js events or an rrweb-only recording.", "",
             "| agents: data set / product | rec. | sessions | evaluable | recall (evaluable) | recall (all) | "
             "four layers |", "|---|---|---|---|---|---|---|"]
    for c in board["agents"]:
        lines.append(f"| {c['source']} / {c['product']} | {c['recording']} | {c['sessions']} | "
                     f"{_rate(c['evaluable'])} | {_rate(c['recall'])} | {_rate(c['recall_all'])} | "
                     f"{_rate(c['four_layers'])} |")
    lines += ["", "| humans: data set / group | rec. | sessions | evaluable | false positives (behaviour) | "
                  "four layers: Agent or Mixed |", "|---|---|---|---|---|---|"]
    cells = board["humans"] + [dict(c, source="all humans", group=kind) for kind, c in board["pooled_humans"].items()]
    for c in cells:
        lines.append(f"| {c['source']} / {c['group']} | {c['recording']} | {c['sessions']} | {_rate(c['evaluable'])} "
                     f"| {_rate(c['false_positives'], 'high')} | {_rate(c['four_layers'], 'high')} |")
    prevalences = sorted({p for c in board["precision"] for p in c["at"]}, key=float)
    lines += ["", "Precision if agents were this share of all sessions, with the false positive rate of the humans "
                  "recorded the same way: as measured / at its upper bound.", "",
              "| " + " | ".join(PRECISION_COLUMNS) + " | " + " | ".join(
                  f"precision at {_number(float(p), 'share')}" for p in prevalences) + " |",
              "|---" * (len(prevalences) + len(PRECISION_COLUMNS)) + "|"]
    for c in board["precision"]:
        cells = " | ".join(f"{_number(c['at'][p]['measured'], 'share')} / {_number(c['at'][p]['bound'], 'share')}"
                           for p in prevalences)
        lines.append(f"| {c['source']} / {c['product']} | {_number(c['recall'], 'share')} | {c['humans']} | {cells} |")
    lines += ["", "| site | humans: evaluable | humans: false positives | agents: evaluable | agents: recall |",
              "|---|---|---|---|---|"]
    for site, cell in board["sites"].items():
        humans, agents = cell["humans"], cell["agents"]
        lines.append(f"| {site} | {_rate(humans['evaluable']) if humans else DASH} | "
                     f"{_rate(humans['false_positives'], 'high') if humans else DASH} | "
                     f"{_rate(agents['evaluable']) if agents else DASH} | "
                     f"{_rate(agents['recall']) if agents else DASH} |")
    lines += ["", f"Mixed sessions (product view; A3–A5): per-action accuracy, agent-share error, hand-offs within "
                  f"{limit_s} s.", "",
              "| data set | sessions | accuracy median (decided) | share error median (pt) | hand-offs true / missed / "
              f"within {limit_s} s | found: median s |", "|---|---|---|---|---|---|"]
    for source, s in board["mixed"].items():
        lines.append(f"| {source} | {s['scored']} | {_number(s['accuracy_decided']['median'])} | "
                     f"{_number(s['share_error_pp']['median'])} | {s['handoffs_true']} / {s['handoffs_missed']} / "
                     f"{_number(s['handoffs_within_limit'], 'share')} | {_number(s['handoff_error_s']['median'])} |")
    return lines + [""] + _held_out_cells(board.get("held_out") or {})


def _held_out_cells(held_out):
    """The held-out data sets' cells (scoreboard.py: a website's own sessions, counted nowhere else)."""
    if not held_out:
        return []
    lines = ["Held out: a website's own sessions, labelled afterwards; counted only here (no pooled rate, precision, "
             "site count, calibration or threshold reads them).", "",
             "| held out: data set / product or group | answer | sessions | evaluable | behaviour: agent | "
             "four layers: Agent or Mixed |", "|---|---|---|---|---|---|"]
    for source, cells in held_out.items():
        for c in cells["agents"]:
            lines.append(f"| {source} / {c['product']} | agent | {c['sessions']} | {_rate(c['evaluable'])} | "
                         f"{_rate(c['recall'])} | {_rate(c['four_layers'])} |")
        for c in cells["humans"]:
            lines.append(f"| {source} / {c['group']} | human | {c['sessions']} | {_rate(c['evaluable'])} | "
                         f"{_rate(c['false_positives'], 'high')} | {_rate(c['four_layers'], 'high')} |")
    return lines + [""]


def _heldout(fits):
    """Thresholds set from data (heldout.py): the packaged value, the one people's data gives, and each site judged
    with the threshold fitted without it."""
    lines = ["## Held-out check of fitted thresholds", "",
             "Each threshold is fitted from people alone: the value that fires most while firing on at most the "
             "budget of every data set's measured segments. Fitted again without each site, that site's people are "
             "judged with it. Agents are never used in a fit, so every agent product is held out.", ""]
    if not fits:
        lines += ["No threshold of this model is set from data (agentcake/data/eval.json \"heldout\" lists none).", ""]
    for f in fits:
        lines += [f"{f['rule']} ({f['feature']} {f['operator']} threshold, budget {_number(f['budget'], 'share')}): "
                  f"packaged {_number(f['shipped'])}, fitted on all people {_number(f['fitted'])}.", "",
                  "| site held out | threshold fitted without it | its people judged | judged agent |",
                  "|---|---|---|---|"]
        lines += [f"| {c['site']} | {_number(c['threshold'])} | {c['people']} | {c['false_positives']} |"
                  for c in f["by_site"]]
        lines += ["", "| agents (threshold fitted on all people) | sessions judged | judged agent |", "|---|---|---|"]
        lines += [f"| {name} | {c['sessions']} | {c['agent']} |" for name, c in f["agents"].items()]
        lines.append("")
    return lines


def _calibration(table):
    """The percents against the answers (calibration.py): per bin of predicted chance of an agent, the actual share."""
    lines = ["## Calibration of the percents", "",
             "Chance of an agent against what the sessions were, both classes weighted alike (a percent assumes humans "
             "and agents equally common). Brier: the mean squared gap between chance and answer, 0 perfect, 0.25 a "
             "coin; weighted alike / as counted.", ""]
    parts = (("behaviour, each data set held out of the fit", table["behaviour"]["held_out"]),
             ("behaviour, the packaged map", table["behaviour"]["packaged"]),
             ("the session percent, every layer", table["session"]))
    for title, check in parts:
        lines += [f"{title}: {check['sessions']} sessions, Brier {_number(check['brier'])} / "
                  f"{_number(check['brier_natural'])}.", "",
                  "| predicted chance of an agent | sessions | agents | mean predicted | actual share |",
                  "|---|---|---|---|---|"]
        lines += [f"| {_number(b['from'], 'share')}–{_number(b['to'], 'share')} | {b['sessions']} | {b['agents']} | "
                  f"{_number(b['predicted'], 'share')} | {_number(b['actual'], 'share')} |" for b in check["bins"]]
        lines.append("")
    return lines + [f"Held out: {', '.join(table['behaviour']['folds'])}.", ""]


def _sessions(rows):
    lines = ["## Sessions: the four-layer class per data set and group", "",
             "| data set / group | sessions | class (row) counts | right |", "|---|---|---|---|"]
    for source, items in rows.items():
        groups = {}
        for r in items:
            groups.setdefault(r["group"], []).append(r)
        for group, members in groups.items():
            classes = {}
            for r in members:
                label = r["class"] + (f" · {r['row']}" if r["row"] else "")
                classes[label] = classes.get(label, 0) + 1
            answered = [r for r in members if r["truth"].get("class")]
            right = f"{sum(1 for r in answered if sessions.right(r))}/{len(answered)}" if answered else DASH
            lines.append(f"| {source} / {group} | {len(members)} | "
                         f"{', '.join(f'{k} {n}' for k, n in sorted(classes.items()))} | {right} |")
    return lines + ["", "right: class, and the row / name / kind / verification the answer gives. Lab signal "
                    "recordings have no events: without behaviour a session the environment does not name stays "
                    "too little data.", ""]


def _humans(table):
    s = table["summary"]
    lines = ["## Clean humans: every layer (A1)", "",
             f"{s['sessions']} sessions; classes {s['classes']}. Environment rules: {s['rules_in_table']} in the "
             f"table, "
             f"{s['rules_on']} on; held: hard {s['rules_held']['hard'] or 'none'}, soft "
             f"{s['rules_held']['soft'] or 'none'}, weak {s['rules_held']['weak'] or 'none'}. Sessions with a hard or "
             f"soft hit: {s['sessions_with_a_strong_hit']}; where soft hits would count (two rules): "
             f"{s['sessions_where_soft_hits_would_count']}; with an agent run long enough for Mixed: "
             f"{s['sessions_with_a_long_agent_run']}; looking like a crawler: {s['sessions_looking_like_a_crawler']}. "
             f"Weak-signal reasons, never a class: {s['weak_reasons'] or 'none'}.",
             "", "| session | class | behaviour | actions | environment hits | longest agent run | crawler patterns | "
             "weak reasons |", "|---|---|---|---|---|---|---|---|"]
    for r in table["sessions"]:
        hits = ", ".join(f"{rule} ({strength})" for rule, strength in r["env_hits"].items()) or DASH
        run = r["longest_agent_run"]
        run_text = f"{run['n']} actions, {run['span_s']:.1f} s" if run else "none"
        patterns = ", ".join(name for name, held in r["crawler"].items() if held) or DASH
        lines.append(f"| {r['id']} | {r['class']} | {r['behaviour']} | {r['n_actions']} | {hits} | {run_text} | "
                     f"{patterns} | {', '.join(r['weak_reasons']) or DASH} |")
    unknown = sorted((rule, cell["unknown"]) for rule, cell in table["rules"].items() if cell["unknown"])
    lines += ["", f"Rules that could not be checked (inputs not recorded): "
                  f"{', '.join(f'{rule} ({n})' for rule, n in unknown) or 'none'}.", ""]
    return lines


def _takeovers(sources, limit_s):
    lines = ["## Take-overs: per-action accuracy, agent share, hand-offs (A3, A4, A5)", "",
             "| data set | view | sessions | classes | accuracy median (decided) | share error median / max (pt) | "
             f"hand-offs true / missed / within {limit_s} s | found: median s | largest s |",
             "|---|---|---|---|---|---|---|---|---|"]
    for source, rows in sources.items():
        for view, about in VIEWS:
            s = takeovers.summary(rows, view, limit_s)
            if not s["sessions"]:
                lines.append(f"| {source} | {about} | 0 | | | | | | |")
                continue
            within = _number(s["handoffs_within_limit"], "share")
            lines.append(f"| {source} | {about} | {s['scored']} | {s['classes']} | "
                         f"{_number(s['accuracy_decided']['median'])} | {_number(s['share_error_pp']['median'])} / "
                         f"{_number(s['share_error_pp']['max'])} | {s['handoffs_true']} / {s['handoffs_missed']} / "
                         f"{within} | {_number(s['handoff_error_s']['median'])} | "
                         f"{_number(s['largest_handoff_error_s'])} |")
    lines.append("")
    for source in ("recording_splices", "lab_splices"):
        if sources.get(source):
            lines += [f"By pattern ({source}, product view): {takeovers.by_pattern(sources[source], 'verdict')}", ""]
    return lines


def _segments(tables):
    lines = ["## The lab's per-segment test (segment-level accuracy; bh-lab.eval.jsonl)", "",
             "| mode | group | method | runs | segments | right | unsure | accuracy all / decided |",
             "|---|---|---|---|---|---|---|---|"]
    for r in tables["single_source"]:
        if r.get("result", True) is None:
            lines.append(f"| {r['mode']} | {r['group']} | {r['method']} | {r['runs']} | {r['segments']} | "
                         f"not trained: only one actor | | |")
            continue
        lines.append(f"| {r['mode']} | {r['group']} | {r['method']} | {r['runs']} | {r['segments']} | {r['correct']} "
                     f"| {r['unsure']} | {r['acc_all']} / {r['acc_decided']} |")
    lines += ["", "Splices of Claude in Chrome with the human-like script standing in (mechanics only):", "",
              "| mode | method | splices | accuracy mean | share error median (time/action/event) | unsure median | "
              "switch error median / p90 s | missed | extra |", "|---|---|---|---|---|---|---|---|---|"]
    for r in tables["lab_splices"]:
        med = r["share_err_pp_median"]
        lines.append(f"| {r['mode']} | {r['method']} | {r['splices']} | {r['acc_all_mean']} | {med['time']} / "
                     f"{med['actions']} / {med['events']} | {r['unsure_pct_median_time']} | "
                     f"{r['switch_err_s_median']} / {r['switch_err_s_p90']} | {r['true_switches_missed']} | "
                     f"{r['extra_pred_switches']} |")
    return lines + [""]


def _baselines(table):
    methods = sorted({m for group in table.values() for m in group})
    lines = ["## Whole-session models side by side (sessions called agent / sessions it could call)", "",
             "| group | " + " | ".join(methods) + " |", "|---" * (len(methods) + 1) + "|"]
    for group, cells in table.items():
        lines.append(f"| {group} | " + " | ".join(f"{cells[m]['agent']}/{cells[m]['n']}" if m in cells else DASH
                                                for m in methods) + " |")
    return lines + ["", "cake: the behaviour model alone; rules_hmm: the lab's rules + HMM without fallback; "
                    "choudhary: original thresholds; superline: @superline-ai/agent-detection 0.0.8; logistic: the "
                    "lab's logistic regression trained on the lab and the clean recordings without the session's "
                    "own group (agents) or the session itself (humans); PostHog replays are not scored by it "
                    "(their features lack what rrweb cannot record). Each cell: called agent / sessions it could "
                    "call.", ""]


def _layers(tables):
    lines = ["## Each part alone and together", ""]
    for kind, title in (("by_half", "halves: page = cake.js in the page, collector = the collect endpoint, server = "
                                    "the site's server half"),
                        ("by_layer", "judging layers")):
        configs = tables[kind]
        names = [" + ".join(c["keep"]) for c in configs]
        lines += [f"Right per {title} (class, and row when the answer has one):", "",
                  "| data set / group | " + " | ".join(names) + " |", "|---" * (len(names) + 1) + "|"]
        groups = list(configs[0]["groups"]) if configs else []
        for group in groups:
            cells = [f"{c['groups'][group]['right']}/{c['groups'][group]['n']}" for c in configs]
            lines.append(f"| {group} | " + " | ".join(cells) + " |")
        lines += ["| all | " + " | ".join(f"{c['right']}/{c['n']}" for c in configs) + " |", ""]
    return lines


def _bots(tables):
    named, t22 = tables["named"], tables["t22"]
    lines = ["## Named programs (A7) and listed bots vs automated browsers (T22, A9)", "",
             f"A7: {named['right']}/{named['n']} named User-Agents with the right list id and class.", "",
             "| list id | class | name said | kind | verification | right |", "|---|---|---|---|---|---|"]
    for r in named["rows"]:
        lines.append(f"| {r['name']} | {r['class']} | {r['said_name'] or DASH} | {r['kind'] or DASH} | "
                     f"{r['verification'] or DASH} | {'yes' if r['right'] else 'no'} |")
    lines += ["", f"T22: {t22['right']}/{t22['n']} right." if t22["n"] else
              "T22: no session yet (server mode runs listed in eval/truth_goal.jsonl).", ""]
    for group, cell in t22["groups"].items():
        lines.append(f"- {group}: {cell['right']}/{cell['n']} right; {cell['classes']}; crawler reason "
                     f"{cell['crawler_reason']} (expected {cell['crawler_expected']})")
    return lines + [""]
