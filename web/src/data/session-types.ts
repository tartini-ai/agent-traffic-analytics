// The JSON of GET /api/session/<id> (agentcake/api/session.py, session_tabs.py) and of its replay's chunks
// (agentcake/api/replay.py): one session's page. Part of the /api contract of ./types.ts, which re-exports these types
// (kept apart so each file stays one job).
import type { Attribution } from "./place-types"
import type { Actor, AgentTurns, Certainty, Evidence, Handoff, Segment, SessionSummary, Timeline, Verdict } from "./types"

// ---------------------------------------------------------------- GET /api/session/<id>

export type LayerId = "name" | "verify" | "environment" | "behavior"
/** What one layer concluded: a verdict, nothing found, or switched off here. */
export type LayerState = Verdict | "human_agent" | "unknown" | "no_hit" | "off"
/** The kind of evidence behind a reason; the page picks its icon. */
export type ReasonKind = "user_agent" | "server" | "page" | "browser" | "clicks" | "keys" | "motion" | "model"
/** A reason: what it means (text) and, under it, what was seen in technical words (detail), null when it has none. */
export type Reason = { kind: ReasonKind; tone: "human" | "agent" | "none"; text: string; detail: string | null }
/** One of the four layers of "Why this classification", in the order name, verify, environment, behavior. leans: the side its
 *  evidence points to, and percent how sure it is of that side (1–99); both null when it judged nothing (no hit, off,
 *  too little data). */
export type LayerReasons = { layer: LayerId; state: LayerState; reasons: Reason[]; percent: number | null; leans: "agent" | "human" | "bot" | null }
/** One action in "All actions": what, never what was typed (inputs are masked), and the page it was taken on; tab: the
 *  tab it was taken in, only in a session with more than one. */
export type Action = { at_ms: number; who: Actor; what: string; page: string; tab?: number }
/** One page of a session, in the order the pages opened: the first is where the visit came in, the last where it left
 * . A single-page app's new address is a new page. */
export type SessionPage = {
  /** Path and query, as cake keeps them. */
  path: string
  /** When the page opened, and how long the visitor stayed on it: until its own tab's next page opened, a tab's last
   *  page until that tab's end. */
  at_ms: number
  duration_ms: number
  /** The visitor's actions on the page: "All actions" without its Open rows. */
  actions: number
  /** Who acted on the page, named as the session categories name it: a human only, an agent only, a human and an
   *  agent (Human + agent), or unknown when all its actions are; null for a page without actions (no one acted). */
  who: "human" | "agent" | "human_agent" | "unknown" | null
  /** The tab it opened in, only in a session with more than one. */
  tab?: number
}
/** Why a replay is gone or cut short: deleted to free disk space ("When the budget is full, free space for me"; the
 *  verdict, timeline and server half stay), some events not stored while the disk budget was full, or nothing to
 *  replay (the visit sent no page events). */
export type ReplayMissing = "freed" | "dropped" | "none"
/** The replay's chunks (one per 10 seconds of activity), read one at a time from …/replay?chunk=<n>: the player
 *  reads the chunk it plays and the one after it, and the chunks before a moment it jumps to. */
export type ReplayInfo = {
  /** Where the player starts, and the address of the page at that moment. */
  start_ms: number
  start_url: string
  /** The session's ms 0 on the events' clock (epoch milliseconds): an event stamped T is at T − epoch_ms. */
  epoch_ms: number
  /** "Jump to hand-off" starts the player this long before a hand-off (a cake setting). */
  handoff_lead_ms: number
  /** Chunk n covers chunks[n], in time order; empty when there is nothing to replay. */
  chunks: { start_ms: number; end_ms: number }[]
  /** Why the replay is gone or cut short; null when it is all there. */
  missing: ReplayMissing | null
}

/** What the site's server saw of one page request: the server half's token (SERVER.md, agentcake/edge_token.py). */
export type ServerPage = {
  /** When the server saw the request. */
  at_ms: number
  path: string
  /** Sec-Fetch-Site, -Mode, -Dest and -User as the browser sent them; null for one it did not send. */
  fetch: { site: string | null; mode: string | null; dest: string | null; user: string | null }
  /** A signed request: its Signature-Agent and whether the signature verified; null when it was not signed. */
  signature: { agent: string | null; verified: boolean } | null
  /** Whether the request came from the network cake.js's uploads came from; null when cake can't tell. */
  same_network: boolean | null
  /** Whether cake.js's uploads sent the page request's User-Agent, and its Accept-Language; null when either side
   *  didn't say. */
  same_user_agent: boolean | null
  same_language: boolean | null
  /** How many more page views of the visit brought this page's token again: the browser showed them a stored copy
   *  (after a 304, or going back), so they have no server half of their own. */
  reuses: number
  /** The tab the page was requested in, only in a session with more than one. */
  tab?: number
}
/** The network cake.js's uploads came from (server mode): the country of its address (the city database's), its
 *  published range, and what the load balancer saw; never the address itself. attribution: DB-IP's credit, when the
 *  country is its. */
export type Network = { country: string | null; range: string | null; ja4: string | null; protocol: string | null; attribution: Attribution | null }
/** The session page's Server middleware table. */
export type ServerHalf = {
  /** One row per page request whose token arrived, in time order. */
  pages: ServerPage[]
  /** null on this computer, where every visit comes from 127.0.0.1. */
  network: Network | null
  /** Why pages are missing or there are none, in a sentence from cake; null when nothing needs saying. */
  note: string | null
}

/** A tab's replay: its chunks, read from …/replay?tab=<its id>&chunk=<n>, on the session's clock (the session's
 *  ReplayInfo gives the clock's epoch_ms and handoff_lead_ms). */
export type TabReplay = Pick<ReplayInfo, "start_ms" | "start_url" | "chunks" | "missing">

/** One tab of a session with more than one. Each tab is judged on its own (its verdict, how sure, its reasons and who
 *  acted when); the session's verdict is made from theirs. A tab that went quiet for 30 minutes while another was in
 *  use, and then went on, is the same tab: its two parts share its number. */
export type SessionTab = {
  /** The tab's own id: its replay is …/replay?tab=<id>, and /sessions/<id> (an address from before a session spanned
   *  tabs) opens the session with this tab picked. */
  id: string
  /** Which tab it is: 1 for the first one opened ("Tab 1"). */
  tab: number
  /** When its recording starts and ends, on the session's clock. */
  start_ms: number
  end_ms: number
  verdict: Verdict
  evidence: Evidence | null
  agent_turns: AgentTurns | null
  agent: string | null
  certainty: Certainty | null
  percent: number | null
  /** Its own "Why this classification": the summary and the four layers, on the session's clock. */
  summary: string
  layers: LayerReasons[]
  /** Its own track: who acted when and its hand-offs, on the session's clock. */
  segments: Segment[]
  handoffs: Handoff[]
  replay: TabReplay
}

/** Which tab the replay shows from start_ms to end_ms while it follows the visitor (PostHog's segmenter: the tab the
 *  visitor is active in); together they cover the whole session. tab: a SessionTab's id. */
export type FollowStretch = { tab: string; start_ms: number; end_ms: number }

export type SessionDetail = {
  session: SessionSummary
  /** Who acted, in one line ("A human, then Claude in Chrome, then the human again"). */
  title: string
  /** The verdict in a sentence or two, shown after the verdict's name. */
  summary: string
  /** How sure cake is of the verdict, in whole percents (1–99, calibrated): Human that a human acted, Agent that an
   *  agent did, Unknown that an agent did, Bot how far its name is verified; null when it doesn't say (judged before
   *  the percent was kept, or a phone or tablet shown as Human: the behavior model isn't used there). */
  percent: number | null
  timeline: Timeline
  /** The pages in the order they opened; never empty. */
  pages: SessionPage[]
  layers: LayerReasons[]
  actions: Action[]
  replay: ReplayInfo
  server: ServerHalf
  /** Set only on a session of more than one tab session (a tab that went quiet and went on is one tab in two parts,
   *  both here), and so are follow, verdict_tab and named_tab: each tab session, in the order it opened. Then timeline
   *  holds every tab's segments and hand-offs, pages and actions say which tab, replay is the first tab's (with the
   *  session's clock), and summary, layers and percent are those of the tab the verdict rests on. */
  tabs?: SessionTab[]
  follow?: FollowStretch[]
  /** The tab the verdict rests on: of the tabs whose own verdict is the session's, the surest. */
  verdict_tab?: string
  /** The tab an address named, when it named one of the session's tabs rather than the session: the page opens with it
   *  picked. */
  named_tab?: string
}

// ---------------------------------------------------------------- GET /api/session/<id>/replay?chunk=<n>&tab=<id>

/** An rrweb event as recorded (timestamp in epoch milliseconds); the player reads the rest. */
export type ReplayEvent = { type: number; timestamp: number; data: Record<string, unknown> }
export type ReplayChunk = { chunk: number; start_ms: number; end_ms: number; events: ReplayEvent[] }
/** The fields replay uses from POST /api/delete to confirm removal and spot cleanup failures. */
export type DeleteCleanup = { error: string | null; log_cleared: boolean }
export type SessionDeletion = {
  sessions: { found: boolean }[]
  database: DeleteCleanup
  backups: (DeleteCleanup & { rows: number })[]
  log_lines: number
}
