# Evaluation

`agentcake eval` measures how AgentCake judges sessions whose answers you know, and `agentcake eval --gate` compares
the measures with the thresholds in `thresholds.json`. Run it from a checkout of this repository
(`bin/agentcake eval`): an installed AgentCake does not carry this folder and says so. It only reads: it writes no
verdict and sends nothing.

    bin/agentcake eval [--gate] [--out DIR] [--sources FILE] [--cake-home DIR] [--truth-goal FILE] ...

`bin/agentcake eval --help` lists every option. With `--out`, the report is also written to `eval.md` and `eval.json`,
naming sessions by short hashes only.

## What this folder holds

| File | What it is |
|---|---|
| `thresholds.json` | The values `--gate` judges, one entry per measure (A1 to A9, N1 to N5), with the data sets each one reads |
| `named_user_agents.json` | Ten User-Agents of named AI products and the answer for each (measure A7) |
| `sources.example.json` | A template for `sources.json`: where this computer keeps your data |

A checkout also gives `agentcake eval` motion-attestation's 27 human captures (`tests/fixtures/motion_attestation`,
MIT): sessions that must never be called an agent.

## truth_goal.jsonl (your own labelled sessions)

Record sessions in an AgentCake whose answers you know (for example, visits you made yourself and visits an agent made
for you), list them in `truth_goal.jsonl` in this folder (or give `--truth-goal`), and point `--cake-home` at that
AgentCake's data folder (default: the current `CAKE_HOME`). One line per session, written after you checked it. The
session id never appears, only its short hash.

| Field | Meaning |
|---|---|
| `h` | `sha256("cake-goal|" + session id)[:12]` (cake.js's tab session id, `s`, in the CAKE_HOME's `sessions` table) |
| `case` | `T3`, `T5`, `T6`, `T8` or `T22`: an AI agent in a real browser, a hand-off between a human and an agent, an automated browser, a listed bot, a crawler script |
| `group` | what ran it, e.g. `claude-chrome`, `pw-humanlike-headed`, `googlebot-verified`, `googlebot-impersonated`, `uptimerobot`, `local-ai-tool`, `cloud-script` |
| `class` | the class it should get: `human`, `agent`, `mixed`, `bot` or `too_little_data` |
| `row`, `name`, `verification` | optional: `ai` or `automated`; the list id; `verified`, `self_reported` or `impersonation` |
| `crawler` | optional, `true`: the reasons must say "looks like a crawler" |
| `stretches` | optional, for a hand-off: `[[from_ms, to_ms, "agent" or "human"], ...]` in epoch ms, from the recorded times of the agent's last and the human's first action |
| `checked` | the day it was checked |

`sources.json` (copy `sources.example.json` into this folder, where git ignores it, or anywhere and give `--sources`)
names the same locations once instead of on every command: `cake_home`, `truth_goal`, `thresholds`,
`named_user_agents`.

## A website's own labelled sessions (held out)

Copy a website's AgentCake data folder, including `cake.db`, `replays/` and `config.json`. Without `config.json`,
AgentCake judges the sessions as if recorded on a computer and skips the address-range and signature checks. AgentCake
opens a copy without its `-wal` file in read-only, immutable mode. Pass the folder with `--site-home`. List the sessions
whose answers you know in a file and pass it with `--truth-site`. Only the listed sessions are read. The report counts
them on their own, in the sessions table and in the scoreboard's held-out lines, and nowhere else: no pooled rate,
precision, site count, calibration or threshold reads them, so they test what was tuned on other data. One line per
session; the session id never appears.

| Field | Meaning |
|---|---|
| `h` | the short hash, as in `truth_goal.jsonl` |
| `site` | the website, e.g. `shop.example` |
| `group` | who or what ran it, e.g. `owner` (the site's owner browsing), `claude-chrome`, `codex-browser` |
| `class` | the class it should get: `human`, `agent`, `mixed`, `bot` or `too_little_data` |
| `row`, `name` | optional, only when certain: `ai` or `automated`; the list id |
| `checked` | the day it was checked |

In `sources.json`, the keys are `site_home` and `truth_site`.

## Recording Antigravity modes

Use the same interactive tasks on the test shop and lab page for manual and agent sessions. In the recorder's
truth list (pass it with `--truth-recordings`), supply a short recording hash `h`, a `label`, the known
`truth` and the browser surface in `mode`. The recording hash is
`sha256("cake-s1.5|" + recorder run id)[:12]`.

| Label | Truth | Mode | What the operator used |
|---|---|---|---|
| `agy-human` | `human` | `in-app` | A person manually operating the Antigravity side-panel browser |
| `agy-browser` | `agent` | `in-app` | Antigravity's browser agent operating the side-panel browser |
| `agy-cu` | `agent` | `in-app` or `own-chrome` | Confirmed computer use through native pointer and keyboard input |

### Confirm the browser surface

The Antigravity App documents manual side-panel browsing from v2.26.0 and the built-in browser agent rollout
from v2.30.0 for personal accounts in local desktop workspaces. Check **Settings → Browser → Browser Actuation
Rules** and observe the browser subagent act in its App tab before using `agy-browser`. **Requires Google
Chrome** uses Chrome DevTools MCP. Static page reads can skip opening a tab. Log the observed mechanism for
each run and use `agy-cu` only after confirming native pointer or keyboard control on the surface. [Antigravity browser documentation](https://antigravity.google/docs/browser)

### Match the tasks

Use the maintainer's recorder kit on the test shop and lab page. Start each run in a fresh recording with the
same site fixture and task goal for each operator. Do one manual run and one browser-agent run for each task,
then repeat the matrix if collecting twenty per cohort. Repeat it for each confirmed native Computer Use surface
when available. Keep the short flows to measure limited evidence. Save the short hash, task code, app version, OS,
account type, model, observed tools and surface with the recording.

| Task | Site | Actions |
|---|---|---|
| S1 | Shop | Open a category, scroll and inspect two products |
| S2 | Shop | Search for a known item, open a result and return to the results |
| S3 | Shop | Open a product and change a variant or quantity |
| S4 | Shop | Add an item and update its quantity in the test cart |
| S5 | Shop | Open a single item from the catalog and finish |
| L1 | Lab | Complete a form with synthetic text, a selection and a submit action |
| L2 | Lab | Move between fields, correct one value and verify the result |
| L3 | Lab | Scroll to a lower section, use a control and return to the top |
| L4 | Lab | Follow links across two pages and verify a detail on the final page |
| L5 | Lab | Toggle a single test control and finish |

Record five additional same-tab handoffs. For an agent-to-human recording, stop the built-in subagent and
continue in its tab. For a human-to-agent recording the built-in subagent supports resuming its tab after a
sign-in pause. Use a test account and synthetic data if exercising that path. Keep the agent's last action and
the human's first action, or the corresponding times for the reverse direction. Use the agent's actuation
label, `truth: mixed`, and `stretches: [[from_ms, to_ms, who], ...]` in action order, with the start of each
stretch at the first action on that side. [Antigravity handoff documentation](https://antigravity.google/docs/browser#pause-take-over-and-sign-in)

### Score the recordings

Pass `--recordings`, `--truth-recordings` and `--out` to the checkout's `bin/agentcake eval`. Compare the
same recordings before and after changes. Keep historical `agy` runs on their own line until the original truth
list confirms the operator mode. A1 and A8 show `agy-human` and A2 shows `agy-browser` and `agy-cu` as
references. The **Antigravity recording cohorts** table and `recorded_cohorts` in `eval.json` include every
loaded run, split by recorded surface. Unknown or missing surfaces are shown as unverified.

For manual sessions, require zero Agent or Mixed verdicts. In a ten-run browser-agent cohort, require at least
eight Agent or Mixed verdicts named `antigravity-browser` and at most two Too little data verdicts. Use the
per-surface Computer Use results to establish a baseline. For the handoff runs, check the Mixed count over all
sessions and the number of direction-matched handoffs found, including the count within the A5 time limit.
Keep these hashes in the recordings truth list. The cohorts are reference data outside the pooled handoff
gate, scoreboard totals, calibration and fitted thresholds.

Reconcile the exported row IDs against the truth list before scoring. Use `n_actions` and the raw input in the
private recorder to distinguish short sessions from missing uploads and segmentation gaps. Compare any proposed
page-visible trace against matched manual runs, ordinary Chrome and other Chromium apps. Require fresh agent
runs and held-out human controls before changing a detection rule.

## Recording Grok Bot

Use the Grok Bot cloud computer on a controlled test shop with AgentCake in server mode. Record at least 20
agent-only visits across tasks such as browsing products, searching, adding to a test cart and filling a form.
Include short visits. Record five additional visits where a person takes over in the same tab. Use synthetic
values and a test account if a task requires signing in. [Grok Bot computer and takeover documentation](https://docs.x.ai/grok-bot/faq#can-grok-bot-use-any-website)

Label each visit in the `truth_goal.jsonl` format above. Give agent-only visits `case: T3` and `class: agent`,
and give takeover visits `case: T5` and `class: mixed`. Give both `group: grok-bot`. Use the hash of the
stored session ID for `h`. For a takeover, record the last action of one side and the first action of the
next side so the `stretches` mark the change in epoch milliseconds. Keep the source recordings, browser and
request evidence, and truth list private.

```sh
bin/agentcake eval --cake-home /path/to/recording-data --truth-goal /path/to/grok-truth.jsonl --out /path/to/report
```

Read **Grok Bot recording cohorts** in `eval.md` or `grok_bot_cohorts` in `eval.json`. Compare the loaded
session count with the truth list before interpreting the rates. The counts include thin visits, show how
often agent-only visits were judged Mixed, and give the verdict names so any name other than `grok-bot`
is visible. The takeover row reports Mixed verdicts, matched handoffs and the A5 median. A direction mismatch
counts as a miss. The true handoff count also includes visits with no verdict timeline.

Check that at least 90% of all agent-only visits are Agent or Mixed, that none are falsely Mixed, and that
every named verdict uses `grok-bot`. Use the Mixed count and A5's time limit to check the takeover cohort.
The ordinary A2 reference for `store/grok-bot` uses the judged visits. `recorded/grok-bot` is the equivalent
reference for agent visits loaded through `--recordings`. Use the stored server-mode cohort to evaluate
request and network evidence. Compare the same clean human and held-out sets before and after any rule
change. Update the rule's evidence grade only after checking the live recordings.

## What the report says

One line per measure it could run, with its data set, the number of sessions, the result and, with `--gate`, the
threshold. A data set without a location is skipped and the report says what to give. With `--gate`, the exit code is 0
when every threshold this command measures passes, 1 when one fails or has no data (what did not run did not pass), and
2 for a usage error.

A5, the hand-off error, is measured where AgentCake shows hand-offs: in the mixed sessions it judged Human + agent.
Each of their true hand-offs gets the seconds to the nearest hand-off the timeline marked in the same direction (a
missed one counts as over the limit), and the gate judges the median. A data set with no session judged Human + agent
has no samples, which is not a pass. A mixed session whose agent stretch holds fewer than 3 clicks or inputs of its own
is judged Human and shows no hand-off: AgentCake would rather miss an agent than call a human one. Two lines under A5 print, never judged,
every true hand-off (found, missed, share within the limit, largest error found, extra ones marked) and how many mixed
sessions were judged Human + agent.

## README's figures

README's "How it decides" gives the size of the test data; its results are this section's, counted on 2026-11-26 with
AgentCake 0.6.2's code: one run of `agentcake eval` over every data set it reads that has answers, the converted public
humans included, and six public sets of people that the scripts which converted them judged the same way, apart from
`agentcake eval` (the percent a session shows is calibrated on what `agentcake eval` reads, so a set kept out of it
stays held out). The sessions are real people's, so they are not in this repository and the counts can't be repeated
from here; on your own labelled sessions (`truth_goal.jsonl`), the same measures describe your site.

| Data set | Whose | What it holds | Agent sessions | Human sessions | People | Websites |
|---|---|---|---|---|---|---|
| The recorder | ours | A person's own visits, and their visits with Claude in Chrome, ChatGPT's Chrome extension, Codex's browser, Codex Computer Use and Antigravity's browser, on our test shop and lab page | 346 (5 hand-offs) | 11 | 1 | 2 |
| Our own agent runs | ours | Claude Code driving Claude in Chrome and 10 browser tools, Codex CLI and Antigravity CLI driving 8 of them; 4 libraries' own agents, with Claude Code as their model; automation dressed up as a human | 669 | — | — | the same 2 |
| The lab | ours | Claude in Chrome and Playwright, with every layer | 26 | — | — | the same lab page |
| The lab's signal recordings and cake.js uploads | ours | 31 more lab runs' environment, with no actions; cake.js's uploads from Playwright | 30 | 3 | not given | the same 2 |
| PostHog replays | ours | Visits to tartini.ai: Claude in Chrome, Playwright and Meta Muse at the times a log shows them; the rest probably human | 47 | 95 | not given | 1 |
| PSAI | public, MIT | People doing tasks on real websites | — | 509 | not given | 135 |
| CaptchaSolve30k | public, Apache-2.0 | People solving captcha games | — | 220 | not given | 1 |
| motion-attestation | public, MIT | Pointer, touch and key captures | — | 27 | not given | 1 |
| SERENE | public, CC BY 4.0 | 13 people's own browsing over a month (the parts downloaded) | — | 1,966 | 13 | 220 |
| AdSERP, Ninawe, KeyRecs, DUX, Chao Shen | public, CC BY 4.0; held out | Search results pages, typing tasks, a web form, a Windows mouse study | — | 4,291 | 389–399 | 4 |
| **14 data sets** | | | **1,118** | **7,122** | **at least 403** | **about 350** |

PSAI names 135 websites and SERENE keeps 220 domains; about 14 names are in both, so the total is about 350. Chao
Shen's sessions come from Windows, not a website. SapiMouse (245 sessions of 120 people, none judged agent) publishes
no licence, so it is in no total.

- **1,020 of 1,118 agent sessions recognized, from 37 tools.** Recognized: the four layers together judged the
  session Agent, or Human + agent. Every session whose answer is an agent (for the recorder's 5 hand-offs, a human and
  an agent) counts once: the lab's 26 sessions are also among its signal recordings. A tool is what drove the browser:
  an AI agent (Claude in Chrome, 153 of its 170 sessions recognized; ChatGPT's Chrome extension, Codex's browser, Codex
  Computer Use, Antigravity's browser, Meta Muse), a browser tool a coding agent drove (agent-browser, Browser Use,
  dev-browser, Chrome DevTools MCP, Playwright MCP, ExecuteAutomation's Playwright MCP server, Playwright CLI,
  Puppeteer MCP server, Rodney, Selenium MCP), a library's own agent (Stagehand, Midscene, Skyvern; Browser Use's
  library is the same tool as its MCP server), or an automation library (Playwright, Puppeteer, a Chrome DevTools
  Protocol client, and those made to look human: Camoufox, Patchright, ghost-cursor with puppeteer-humanize,
  human-cursor, HumanCursor, fingerprint-injector, a stealth plugin for Playwright, a stealth plugin for Puppeteer,
  rebrowser-puppeteer, nodriver, zendriver, Pydoll, Botasaurus, SeleniumBase's UC Mode, undetected-chromedriver).
  Running with or without a window, in another Chrome, or driven by another coding agent, is the same tool. Where it
  falls short:
  - **Made to look human:** 201 of 224 sessions recognized; the behaviour layer alone recognized 136 of them, the
    other layers most of the rest. Camoufox passed as human in all 10 of its sessions, Patchright in 6 of 10 (Not
    sure), nodriver and zendriver in 1 of 15 each (Not sure: their only actions were clicks made by a script, as a
    site's own scripts make them), and with a window and their human-like mode on, Botasaurus in 3 of 15 and Pydoll in
    2 of 15.
  - **PostHog's replays** hold behaviour only: no keys, no wheel, nothing the other layers read. 17 of their 47 agent
    replays were recognized: Claude in Chrome 17 of 30, Playwright 0 of 13, Meta Muse 0 of 2, the other 2 none.
  - **Too few actions:** in 241 agent sessions the behaviour layer had too few actions to judge, and the lab's signal
    recordings hold none; the other layers recognized most of them. 17 stayed too little data, which counts as Human
    with limited evidence: 8 PostHog replays, 4 signal recordings of Claude in Chrome and 5 of Antigravity's browser.
  - **The recorder's agents:** Antigravity's browser 5 of 10 (the other 5 too little data), Codex Computer Use 77 of
    112 (the rest Not sure), ChatGPT's Chrome extension 6 of 7.
- **2 of 7,122 sessions by at least 403 real people judged agent.** Judged agent: Agent, or Human + agent. People are
  counted where a set says who recorded each session (the recorder's 1, SERENE's 13, the held-out sets' 389–399, as
  DUX's two files may share people); PSAI, CaptchaSolve30k, motion-attestation, the lab and PostHog's visitors don't
  say. Held out, never used to write, tune or calibrate anything, are only AdSERP, Ninawe, KeyRecs, DUX and Chao Shen:
  0 of their 4,291 sessions. The 2 are SERENE's, one person's on one website: presses of 5 to 10 ms, with one pointer
  move before each click, as a tap on a touchscreen or a trackpad makes (SERENE doesn't record which). SERENE is not
  held out: its sessions judged agent were studied (8 before 0.4.1's rule for a click repeated in place). PSAI and
  CaptchaSolve30k calibrate the percents, the recorder's 11 are threshold A1's, and PostHog's 95 are probably human, as
  an agent may have acted when no log shows it. 2,105 of the 7,122 had too few actions for any layer (Human with thin
  evidence); sessions with keys only, as in Ninawe and KeyRecs, never reach plain Human.
- **81 of 159 sessions with a hand-off judged Human + agent, the hand-off a median of 0 seconds off.** Data: 154
  sessions spliced from 11 recordings a person made and 4 of Claude in Chrome, by the four patterns of
  `agentcake/data/splice.json` (a splice is left out when one of its stretches holds no action, as 22 of 176 were), and
  the recorder's 5 real hand-offs. Counted as A5 counts it (above), both sets together: in the 81 sessions judged
  Human + agent, the median error of their 103 true hand-offs is 0 seconds; all 103 were found, 78 within 3 seconds,
  the farthest 34.8 seconds off. Over all 159 sessions, 103 of 258 true hand-offs were found: when the agent's stretch
  holds fewer than 3 clicks or inputs of its own, the session is judged Human and shows no hand-off.

PostHog records no keys, no wheel and no `isTrusted`, so on its replays the behaviour model judges from less than
cake.js records; `thresholds.json` gates none of them. The model fits no threshold to any data (the report's "Held-out
check of fitted thresholds"). The percent a session shows is calibrated on the sets `agentcake eval` reads, which
changes no verdict.
