// The fixed sample props of the component overview (./components.tsx) for the components it shows without cake's own
// data: layers, a server half, pages, and the replay stage and controls with no player behind them.
import type { FunnelReport, Handoff, LayerReasons, ServerHalf, SessionPage } from "@/data/types"
import type { ReplayState } from "@/lib/use-replay"

/** A layer for each look: a verdict with its reasons, and a layer that is off with no reason given. */
export const LAYER_LOOKS: LayerReasons[] = [
  { layer: "environment", state: "agent", leans: "agent", percent: 99, reasons: [{ kind: "page", tone: "agent", text: "Automation software controls this browser.", detail: "navigator.webdriver is true" }, { kind: "browser", tone: "none", text: "Real GPU, normal screen.", detail: null }] },
  { layer: "verify", state: "off", leans: null, percent: null, reasons: [] },
]
/** A server half with each kind of row: a plain page request, and a signed one from another network. */
export const SERVER_LOOKS: ServerHalf = {
  pages: [
    { at_ms: 0, path: "/", fetch: { site: "none", mode: "navigate", dest: "document", user: "?1" }, signature: null, same_network: true, same_user_agent: true, same_language: true, reuses: 0 },
    { at_ms: 41250, path: "/pricing", fetch: { site: "same-origin", mode: "navigate", dest: "document", user: null }, signature: { agent: "chatgpt.com", verified: false }, same_network: false, same_user_agent: true, same_language: null, reuses: 1 },
  ],
  network: { country: "US", range: "OpenAI ChatGPT-User", ja4: "t13d1516h2_8daaf6152771", protocol: "HTTP/2", attribution: { text: "IP Geolocation by DB-IP", url: "https://db-ip.com" } },
  note: null,
}
/** Pages of each look: who acted on them (a human, both, an agent only) and a page without actions. */
export const PAGE_LOOKS: SessionPage[] = [
  { path: "/", at_ms: 0, duration_ms: 21300, actions: 3, who: "human" },
  { path: "/pricing?plan=team", at_ms: 21300, duration_ms: 44700, actions: 7, who: "human_agent" },
  { path: "/signup", at_ms: 66000, duration_ms: 4000, actions: 0, who: "agent" },
]
export const FUNNEL_LOOK: FunnelReport = {
  steps: [
    { path: "/pricing", agent: 1, human: 1 },
    { path: "/signup", agent: 1, human: 0 },
  ],
}
export const nothing = () => undefined
/** The replay stage and its controls as they look with no player behind them (the session page plays for real). */
export const EXAMPLE_SITE = "https://shop.example.com/"

export function stillReplay(address: string, status: ReplayState["status"]): ReplayState {
  return { status, missing: "freed", error: null, timeMs: 52000, playing: false, waiting: false, noPage: false, speed: 1, address, mount: nothing,
    play: nothing, pause: nothing, seek: nothing, setSpeed: nothing, jumpTo: nothing, nextHandoff: 80000, jumpToHandoff: nothing, retry: nothing }
}

/** A session of two tabs' replay as it looks with no player behind it: following the visitor, Tab 2 on the stage. */
export const stillTabs = (status: ReplayState["status"]): ReplayState =>
  ({ ...stillReplay(EXAMPLE_SITE, status), tabs: { numbers: [1, 2], view: "follow", shown: 2, segments: [], agent: null, setView: nothing } })

/** The hand-offs drawn on each tab's track in the overview: the first tab's own, and the hand-off from the first tab to
 *  the agent in the second. */
export const TAB_HANDOFFS: Handoff[][] = [[{ at_ms: 38_560, to: "agent" }, { at_ms: 83_868, to: "human" }], [{ at_ms: 22_880, to: "agent" }]]
