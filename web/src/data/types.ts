// The JSON contract between cake's Python server and these pages: one response type per endpoint of /api.
// Each endpoint also has a JSON Schema in ./schema/ (the Python tests check cake's answers against it) and a sample
// answer in ./fixtures/ (served only by the screenshot and dev servers, never built into the release). `npm run
// check:ui` checks that every sample matches both its schema and its type here. web/README.md lists the endpoints.
//
// Conventions
// - Keys are snake_case, like PostHog 1.0's API and cake 0.3.4's /api/health.
// - Times inside a session are whole milliseconds from its start (`*_ms`); the pages format them ("1:36", "1m 36s").
// - Wall-clock times and days come formatted by the server in the owner's timezone ("Today 09:12", "Thu").
// - A session's shares are whole percents of its actions; counts are whole numbers; sizes are bytes or MB as named.
// - Text meant for the page (titles, reasons, the coverage table) comes in English, ready to show.
// - Any status other than 2xx carries an ApiErrorBody.

// ---------------------------------------------------------------- shared

/** Who acted in a session, one verdict each (DESIGN.md §3.1): a session cake can't tell counts as human, with
 *  evidence "thin" (its reasons say why). */
import type { AddressCheck } from "./health-types"
import type { WebDimension } from "./web-types"

export type Verdict = "human" | "agent" | "bot"
/** A Human session cake couldn't tell (too few actions, a phone or tablet it can't confirm, evidence too weak or
 *  pointing both ways). */
export type Evidence = "thin"
/** Who acted during one stretch of a session or in one action ("unsure": the behavior model couldn't tell). */
export type Actor = "human" | "agent" | "unsure"
/** An Agent session from start to finish, or a human and an agent taking turns (hand-off points on its timeline). */
export type AgentTurns = "agent_only" | "human_agent"
/** How sure an agent's or a bot's name is: verified by a signature or a published address range; likely from
 *  the name it gives or the product's own traces. Behavior alone never names an agent. */
export type Certainty = "verified" | "likely"
/** The date filter of the dashboard and the session list; all: every session, from the first. */
export type DateRange = "24h" | "7d" | "30d" | "all"

/** Share of a session's actions each actor took, in whole percents that add up to 100 (all 0 when the behavior model
 *  did not run, as for bots). */
export type Share = { human: number; agent: number; unsure: number }
/** One stretch of a session in which one actor acted. */
export type Segment = { who: Actor; start_ms: number; end_ms: number }
/** A moment control passed between a human and an agent. */
export type Handoff = { at_ms: number; to: "human" | "agent" }
/** Who acted when, over a whole session: drawn as the timeline under a replay. */
export type Timeline = { duration_ms: number; segments: Segment[]; handoffs: Handoff[] }

/** One session as every list shows it (sessions page, dashboard, the home page's examples). */
export type SessionSummary = {
  id: string
  verdict: Verdict
  /** "thin" for a Human session cake couldn't tell, which the pages mark; null otherwise. */
  evidence: Evidence | null
  /** Set for Agent sessions, null otherwise. */
  agent_turns: AgentTurns | null
  /** The agent's product or automation tool name (Claude in Chrome, ChatGPT, Playwright…), or the program's name for a
   *  bot; null when no name fits an agent (the pages say Unnamed) and for sessions without an agent. */
  agent: string | null
  /** How sure the name is; null without a name. */
  certainty: Certainty | null
  /** When it started, formatted by the server ("Today 09:12"). */
  when: string
  /** How long its recording runs: the player's length (the session page's timeline.duration_ms). */
  duration_ms: number
  /** How many pages it went to: the rows of its page's Pages visited. */
  pages: number
  share: Share
  /** Who acted when, on the recording's clock; sent for every session the behavior model split into runs, so the row can
   *  draw its timeline. */
  segments?: Segment[]
  /** Set only on a session an earlier AgentCake's demo shop recorded (until 0.4.0), not the website: its row says so. */
  demo_shop?: true
  /** Set only on a session with more than one tab (a visit's tabs share one session, as PostHog's do): each tab in the
   *  order it opened, Tab 1 first, with who acted when in it on the session's clock; the row draws a line per tab. A
   *  session with one tab has none, and is listed as it always was. */
  tabs?: TabTrack[]
  /** Set only when its tabs name more than one agent: every agent that acted, named ones first in the order of their
   *  tabs, then Unnamed (agent and certainty are the first's). */
  agents?: AgentName[]
}

/** One tab of a session on its list row: when its recording runs and who acted when, on the session's clock. */
export type TabTrack = { start_ms: number; end_ms: number; segments: Segment[] }
/** An agent's name and how sure it is; name null: an agent no name fits (Unnamed). */
export type AgentName = { name: string | null; certainty: Certainty | null }

/** Groups of sessions: the filters of the session list and their counts. all = human + agent + bot; agent splits into
 *  agent_only + human_agent (by agent_turns); thin counts the Human sessions on thin evidence. */
export type SessionGroup = "all" | Verdict | AgentTurns | Evidence
export type SessionCounts = Record<SessionGroup, number>

// ---------------------------------------------------------------- GET /api/overview?range=

export type OverviewQuery = { range?: DateRange }
/** Sessions per agent name, Human + agent sessions included; name null: the agents no product name fits (Unnamed);
 *  bots never appear here. */
export type AgentCount = { name: string | null; sessions: number }
/** Page views divided by sessions: of all sessions and of each verdict's; null for a group with no session in the range. */
export type PagesPerSession = { all: number | null; human: number | null; agent: number | null; bot: number | null }

/** What counts as a bot (the Bot number's "?"). Comes from agentcake/data/coverage.en.json, so the pages never carry this
 *  wording. The names of the categories themselves are judging.en.json's, read when the pages are built
 *  (src/lib/taxonomy.ts). */
export type Coverage = {
  bot: { question: string; answer: string }
}

export type Overview = {
  counts: SessionCounts
  /** Agent sessions of the range's previous period, PostHog's: as long as the range runs to the end of its current
   *  hour or day, right before it (25 hours, 8 days, 31 days), for "+12" and "vs. 30 prior"; null for all time, which
   *  has no earlier range (the comparison isn't shown). */
  agent_earlier: number | null
  agents_seen: AgentCount[]
  /** How many times a page opened in the range's sessions (each page view, and each new address a single-page app shows
   *  in one): all of them, and by the session's verdict, which add up to all. */
  page_views: { all: number; human: number; agent: number; bot: number }
  pages_per_session: PagesPerSession
  /** The newest Agent sessions, newest first (the top block). */
  latest_agent: SessionSummary[]
  /** The disk budget and what cake's data uses of it, whatever the filters: the dashboard warns from its warn_at_pct. */
  storage: Storage
  coverage: Coverage
  /** On a server, whether the IP address AgentCake reads is a CDN's own: the dashboard warns while it is. */
  address_check: AddressCheck
}

/** The settings page's disk numbers in one place (Settings.storage, budget_mb, auto_free): the dashboard warns from
 *  warn_at_pct, and says by auto_free what happens from free_to_pct on (the oldest replays are deleted) or when the
 *  budget is full; disk and replays_stopped say why new replays stop while the disk is below its floor. */
export type Storage = {
  used_bytes: number; budget_mb: number; warn_at_pct: number; days_left: number | null; auto_free: boolean
  /** The share of the budget at which freeing space starts, and under which it stops. */
  free_to_pct: number
  disk: Disk; replays_stopped: ReplaysStopped
}

// ---------------------------------------------------------------- GET /api/sessions?verdict=&turns=&evidence=&agent=&range=&dimension=&key=&path=&cursor=

/** verdict: one verdict; turns: an Agent session's split (keeps only Agent sessions); evidence: thin keeps the Human
 *  sessions cake couldn't tell; agent: an exact name from agent_names; dimension + key: the sessions of one row of the
 *  dashboard's Sources, Devices or Geography tables (dimension without key: those without a value);
 *  path: an exact stored pathname from Paths, over Agent and Human sessions; cursor: `next` of the page before. */
export type SessionsQuery = {
  verdict?: Verdict; turns?: AgentTurns; evidence?: Evidence; agent?: string; range?: DateRange; dimension?: WebDimension; key?: string
  path?: string; cursor?: string
}
export type SessionsPage = {
  /** Counts under agent, range, dimension and path, whatever the verdict and turns filters. */
  counts: SessionCounts
  /** How many sessions every filter keeps. */
  total: number
  /** Agent names to filter by (named agents only). */
  agent_names: string[]
  /** Newest first. */
  results: SessionSummary[]
  /** Opaque cursor for the next page, or null on the last page. */
  next: string | null
  /** The most sessions one page holds. */
  page_size: number
}

// ---------------------------------------------------------------- GET /api/session/<id> and its replay (./session-types.ts)

export type { Action, FollowStretch, LayerId, LayerReasons, LayerState, Network, Reason, ReasonKind, ReplayChunk, ReplayEvent, ReplayInfo, ReplayMissing, ServerHalf, ServerPage, SessionDetail, SessionPage, SessionTab, TabReplay } from "./session-types"

// ---------------------------------------------------------------- GET and POST /api/settings

/** Whether visits arrive from a source: shown as Receiving, Waiting or Not connected. */
export type Connection = "receiving" | "waiting" | "not_connected"
/** Where the website's visits arrive: this computer's AgentCake, or AgentCake installed on a server (server mode). */
export type Route = "this_computer" | "server"
/** The last log import of the site's web server: when, the log's format, and the recommended request headers its
 *  log lacks or leaves empty on every page request. */
export type LogImport = { last: string; format: string; missing: string[]; empty: string[] }

/** The last update of the lists: when it ran, in the server's words ("Yesterday 03:12"); whether it succeeded; why not. */
export type LastUpdate = { when: string; ok: boolean; error: string | null }

export type Settings = {
  /** The website's domain, "" until it is set; the key its page script sends (null before AgentCake first started). */
  site_domain: string
  site_key: string | null
  /** The line a site adds to its pages, with this AgentCake's address and the site key. */
  script_tag: string
  sources: { site: Connection; server_half: Connection }
  /** When each source last sent something, in the server's words ("Today 09:12"); null when it never did. */
  last_seen: { site: string | null; server_half: string | null }
  route: Route
  /** missing: request headers that none of the site's latest page requests brought its server (something in front of
   *  the server removes them); logs: the last log import, null before the first. */
  server_half: { missing: string[]; logs: LogImport | null }
  /** How often the open page asks for sources and last_seen again ("connected" within 10 seconds). */
  refresh_ms: number
  /** The agent and network lists in use (they come with each release, and an update replaces them): their date, how
   *  old they are, whether that is past max_age_days, and the command that downloads newer ones; the last update
   *  (monthly or by the command; null before the first), the failed updates in a row and whether that is enough to
   *  warn; whether the update takes in the city database too (only on a server that reads the visitor's address). */
  lists: {
    built: string; age_days: number; max_age_days: number; stale: boolean; update_command: string
    last_update: LastUpdate | null; failures: number; failing: boolean; city_database: boolean
  }
  /** Whether AgentCake downloads the latest lists, and on a server the city database, once a month (on by default). */
  lists_auto_update: boolean
  /** 0 keeps everything. */
  retention_days: number
  retention_choices: number[]
  budget_mb: number
  budget_choices_mb: number[]
  auto_free: boolean
  /** days_left: when the budget is full at last week's pace; null when nothing was added last week. free_to_pct: the
   *  share of the budget at which freeing space starts and under which it stops (auto_free_target_ratio), as
   *  auto_free's description states it. */
  storage: { used_bytes: number; warn_at_pct: number; days_left: number | null; disk: Disk; replays_stopped: ReplaysStopped; free_to_pct: number }
  /** The page script's settings: watch the site's own document lookups; CSS selectors of parts of its pages never
   *  recorded, on top of cake.js's own private elements. */
  hook_dom: boolean
  hide_selectors: string
  /** The IANA time zone days and times are written in ("America/Los_Angeles"); "" follows this computer's. */
  timezone: string
  /** This computer's time zone: its IANA name (null when nothing names one) and what the pages call it now ("PST"). */
  timezone_machine: { name: string | null; short: string }
  database: { path: string; sessions: number }
}

/** POST body (Content-Type: application/json): only the fields to change; the answer is the whole Settings. */
export type SettingsUpdate = {
  retention_days?: number
  budget_mb?: number
  auto_free?: boolean
  site_domain?: string
  hook_dom?: boolean
  hide_selectors?: string
  timezone?: string
  lists_auto_update?: boolean
}

// ---------------------------------------------------------------- GET /api/timezones

/** The time zones the settings page lists: UTC, then IANA's zones, each labelled with its offset from UTC now. */
export type Timezones = { zones: { name: string; label: string }[] }

// ---------------------------------------------------------------- GET /api/setup

/** The home page's ways to connect (the sentence for a coding agent, in English, and the commands of `setup --print`) and its example preview. */
export type Setup = {
  /** The one sentence for a coding agent, in English. */
  sentence: string
  /** Commands for the Terminal tab, one per line, placeholders only. */
  terminal: string
  /** The On a server tab's three things for the subdomain route, one line each, placeholders only: the commands that
   *  start AgentCake and Caddy from the release folder, the DNS record for cake.<the site's domain>, and the settings
   *  that tell AgentCake on the server its address (public_url). */
  server: { install: string; dns: string; settings: string }
  /** Shown as "Sample data" until real sessions arrive. */
  example: { sessions: SessionSummary[]; timeline: Timeline }
  /** At any time: the sessions the lists show, how many of them the website sent (site: all but those an earlier
   *  AgentCake's demo shop recorded) and how many are Agent sessions. Until the website's first session the home page
   *  shows how to connect it (like PostHog 1.0's overlay before the first event); the dashboard shows how to connect
   *  it until the first session of any kind, and says it isn't connected while only demo shop sessions are listed. */
  recorded: { sessions: number; site: number; agent: number }
}

// ---------------------------------------------------------------- GET and POST /api/register

/** Whether this data folder has registered with Tartini AI: until it has, the pages show the registration card
 *  before anything else. Also the answer to a POST that was sent. */
export type Registration = {
  registered: boolean
  /** What was sent, exactly as "View registration data" showed it, and when (formatted by the server); null before. */
  sent: { body: string; when: string } | null
  /** The checks the card makes before its button turns on, the ones cake makes before it sends: the email address
   *  matches email_pattern as a whole and has at most email_max_chars characters; a company at most company_max_chars. */
  email_pattern: string
  email_max_chars: number
  company_max_chars: number
  /** Where to write to have a registration deleted (PRIVACY.md). */
  delete_contact: string
}

/** POST body (Content-Type: application/json): the registration exactly as the card's "View registration data" shows it,
 *  JSON.stringify(payload, null, 2) with the keys in this order, company only when given. cake sends that text on
 *  unchanged (agentcake/register.py); a body in any other form is a 400. */
export type RegistrationPayload = { email: string; company?: string; product_updates: boolean; consent_version: string }

/** The disk that holds the data: bytes, and whether its free space is below the floor (disk_min_free_mb). */
export type Disk = { total: number; free: number; min_free: number; low: boolean }

/** Why new replays are not being stored, if they aren't: the disk is below its floor (none is deleted for it); the disk
 *  budget is full and nothing is left to delete. */
export type ReplaysStopped = "disk" | "budget" | null
export type { Attribution, PlaceSource, Places } from "./place-types"
export type { AddressCheck, Health } from "./health-types"

// ---------------------------------------------------------------- GET /api/web?range= (./web-types.ts)

export type { ActiveTime, AgentNumbers, PathRow, TrendEvery, TrendInterval, TrendNumbers, WebAnalytics, WebDimension, WebQuery, WebRow, WebTable } from "./web-types"

// ---------------------------------------------------------------- GET /api/funnel?range=&step=&step=

/** Each step counts visits that reached every preceding step in order. Agent includes Human + agent. */
export type FunnelStep = { path: string; agent: number; human: number }
export type FunnelReport = { steps: FunnelStep[] }

// ---------------------------------------------------------------- errors

/** The body of every answer that is not 2xx: what happened, in a sentence the page can show. */
export type ApiErrorBody = { error: string }
