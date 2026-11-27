// The interface's own wording, in one place (DESIGN.md §2). Visitors are Human / Agent / Unknown / Script bot, never
// person, people or user; the names of the categories themselves are src/lib/taxonomy.ts's (judging.en.json). Text that
// comes with the data (session titles, reasons, the coverage table) is not here: it comes from /api. A sentence with a
// count takes it as integer() writes it (src/lib/format.ts): this file imports nothing at run time, so tests read it.
import type { DateRange } from "@/data/types"

export const WORDS = {
  agentSessions: "Agent sessions",
  actedForHuman: "Sessions where an AI agent acted on behalf of a human",
  rowMarker: "An AI agent acted for a human",
  aHuman: "A human",
  botRow: "Script bot sessions are counted but don't show a timeline.",
  withAgentTitle: "Install with your AI agent",
  withAgentHow: "Open Claude Code, Codex or another coding agent in your website's code folder. If your website has no code, use a new, empty folder. Then paste the following prompt:",
  /** Under the prompt: what the agent does with it (the guide it points to, INSTALL.md), in the order it does it. */
  withAgentWhat: (product: string) => `Answer the agent's questions about your website, such as its address, and sign in to your accounts. Review its plan, including where ${product} runs and any costs, and approve it. The agent can then create a server, add a DNS record and connect your website.`,
  setUpManually: "Install manually",
  scriptWhere: "Paste this line once, before the closing </head> tag in the layout or template that every page uses. For separate HTML files, add the line to each file.",
  /** Step 2's "On a server": the three things a public website's AgentCake needs on its own subdomain, each in plain
   *  words over its commands (/api/setup's server: install, dns, settings). */
  onServer: {
    install: { title: "A server", what: (product: string) => `Use a Linux server with Docker, at least 1 GB of memory, and ports 80 and 443 open. Run these commands in the ${product} release folder to add your subdomain to the Caddyfile and start ${product} with Caddy. Caddy automatically obtains and renews the HTTPS certificate that browsers require.` },
    dns: { title: "A DNS record", what: () => "Add this record in your DNS provider's settings to point your subdomain to your server. On Cloudflare, set the record to DNS only (gray cloud). It usually takes effect within a few minutes to a few hours." },
    settings: { title: "Settings on the server", what: (product: string) => `Run these commands in the release folder on the server, with your domain in place of <your-domain>. These commands set your website's domain and the address where browsers reach ${product}. The last command restarts ${product}.` },
  },
  serverFullSteps: "For detailed steps, or to install without Docker, see",
  dashboard: "Dashboard",
  keyMetrics: "Key metrics",
  deepDive: "Deep dive",
  sessionsPage: "Session replay",
  sessionId: "Session ID",
  deleteSession: {
    action: "Delete session",
    title: "Delete this session?",
    scope: "This permanently deletes the session, its replay, and every tab in the visit.",
    pending: "Deleting session…",
    failed: "Couldn't delete this session.",
    unexpected: "The server didn't confirm the deletion. Try again.",
    cleanup: "Some data may still be in the database or a backup. Try deleting the session again to finish cleanup.",
    gone: "This session is already gone.",
    back: "Back to session list",
  },
  watchReplays: "Watch replays",
  whoUnknown: "Actor not identified",
  agentsByName: "Agents by name",
  eitherTurns: "All agent sessions",
  allHumanSessions: "All human sessions",
  withThinEvidence: "with limited evidence",
  paths: "Paths",
  path: "Path",
  funnel: {
    title: "Path funnel",
    help: "Enter page paths in the order they should be visited. Use paths like /checkout without the query string or fragment.",
    counts: "Agent includes Human + agent. Each session counts once per step.",
    stepPath: (step: string) => "Step " + step + " path",
    add: "Add step",
    remove: "Remove",
    removeStep: (step: string) => "Remove step " + step,
    run: "Run funnel",
    loading: "the path funnel",
    none: "No sessions reached the first step in this date range.",
    completion: (share: string) => share + " completion rate",
    denominator: "Percentages are relative to the sessions that reached the first step in each column.",
    lost: (count: string) => count + " dropped off",
  },
  sessionsGroup: "Sessions",
  visitorsGroup: "Visitors",
  pageViewsGroup: "Page views",
  botsNotInChart: "Script bot sessions are counted separately and are excluded from this chart.",
  activeTime: "active time spent",
  pagesPerSession: "pages per session",
  session: "session",
  sessions: "sessions",
  totals: "Sessions, visitors, page views, active time spent, and pages per session",
  allFromDemoShop: "All sessions are from the demo shop",
  /** The dashboard's warning while the IP addresses AgentCake reads look like a CDN's (Overview.address_check). */
  addressCheck: {
    title: "CDN IP addresses detected",
    text: (cdn: string, sessions: string, product: string) =>
      `${product} found that ${cdn} of the last ${sessions} sessions came from CDN IP addresses. This usually means that ${product} receives the CDN's address instead of each visitor's address. Currently, ${product} doesn't use IP addresses to verify names. If the DNS record for ${product} goes through Cloudflare, set it to DNS only. If a CDN or load balancer is in front of ${product} on your own domain, set proxy_hops. For details, see`,
  },
  visitors: "visitors",
  noVisitorIds: "No visitor IDs in the selected date range",
  visitorsAre: "Each visitor is identified by a random ID that the page script stores in their browser for one year after their last visit.",
  outOfTotalTime: (total: string) => `of ${total} min total time`,
  pageViews: "page views",
  noSessionsInRange: "No sessions in the selected date range",
  noAgentSessionsInRange: "No Agent sessions in the selected date range",
  chart: "chart",
  agentsChart: "Top agents",
  agentsChartLead: "This chart shows the selected metric for each agent's sessions, with or without a human.",
  demoShop: "Demo shop",
  demoShopAbout: "This session was recorded in the demo shop, not on your website.",
  notConnectedTitle: "Your website isn't connected yet",
  notConnectedDemo: "The sessions on this page come from the demo shop, not your website.",
  connectWebsite: "Connect your website",
  layerLocalOrServer: "Local or server",
  layerServerOnly: "Server only",
  trends: "Trends",
  metric: "Metric",
  intervals: { hour: "Hour", day: "Day" },
  /** The note under Trends: the time zone its days and hours are in, as /api/web names it ("PST", "UTC+05:45"). */
  timesIn: (zone: string) => `Times in ${zone}`,
  /** The Agent block's comparison, PostHog's words for its previous period: as long as the range, right before it. */
  vsPrior: (count: string) => `vs. ${count} prior`,
  timeZone: "Time zone",
  timeZoneAbout: "Dates and times on the dashboard and in Session replay use this time zone.",
  /** The time zone choice that follows the computer or server AgentCake runs on: its IANA name and its abbreviation
   *  ("This computer's time zone (America/Los_Angeles, PST)"), the abbreviation alone when nothing names it. */
  followMachine: (where: string, name: string | null, short: string) =>
    `${where}'s time zone (${name && name !== short ? `${name}, ${short}` : short})`,
  searchTimeZones: "Search time zones",
  noTimeZoneMatches: "No time zone matches your search.",
  /** Settings, How detection works: the date of the agent and network lists in use (a release's, or an update's). */
  listsBuilt: (built: string, age: string) => `Built on ${built} (${age} ago).`,
  /** Settings, How detection works: the monthly update of the lists and, on a server that reads the visitor's address,
   *  the city database (lists_auto_update; places: /api/settings lists.city_database); its last run (lists.last_update);
   *  and the warning once updates fail in a row (lists.failing). off and failing take the command as a part of their
   *  own, so the page sets it as code. */
  autoUpdate: {
    title: "Automatic updates",
    on: (places: boolean) => `Downloads the latest agent lists${places ? ", IP ranges, and city database" : " and IP ranges"} every month. No data about your site or its visitors is sent.`,
    off: <Command>(command: Command, places: boolean) => [`The agent lists${places ? ", IP ranges, and city database are" : " and IP ranges are"} downloaded only when you run `, command, "."] as const,
    lastOk: (when: string) => `Last update: ${when} (successful)`,
    lastFailed: (when: string, error: string) => `Last update: ${when} (failed: ${error})`,
    retry: (product: string) => `${product} tries the update again the next day.`,
    failing: (count: string) => `The last ${count} updates failed. To update now, run this command:`,
  },
  /** The top bar's Style menu (DESIGN.md §17): its name and the two styles' names. */
  style: "Style",
  styles: { cake: "Cake", minimal: "Minimal" },
  showAsTable: "Show as table",
  hideTable: "Hide table",
  toAgent: "Hand-off to agent",
  toHuman: "Hand-off to human",
  replayLoading: "Loading replay…",
  replayFailed: "Couldn't load the replay.",
  replayFreed: "This replay was deleted to free up disk space. You can still see the session's classification and timeline.",
  replayDropped: "Part of this replay wasn't saved because the disk space limit was reached at the time.",
  replayNone: "There's nothing to replay because this visit didn't send any page events.",
  replayWaiting: "Loading the next part…",
  replayNoPage: "No page content was recorded at this point. The replay shows only pointer movements and clicks.",
  replayPosition: "Replay position",
  /** A session of more than one tab (a visit's tabs are one session): how many, each tab by its number, and what the
   *  replay shows: the tab the visitor is active in, or one tab picked (DESIGN.md §6.4). */
  tabCount: (count: string) => `${count} tabs`,
  tab: (n: number) => `Tab ${n}`,
  /** A tab whose number another part of the session shares (it went quiet for 30 minutes, then went on): when it began. */
  tabFrom: (n: number, at: string) => `Tab ${n} from ${at}`,
  followVisitor: "Follow the visitor",
  replayTab: "Tab shown in the replay",
  tabColumn: "Tab",
  reasonsTab: "Tab classified",
  /** What Crumb's drawing is to a screen reader where it stands for a state. */
  crumb: { loading: "Loading illustration", error: "Error illustration", empty: "Empty state illustration" },
  jumpToHandoff: "Jump to hand-off",
  pagesVisited: "Pages visited",
  noActions: "No actions recorded",
  entryPage: "Entry page",
  exitPage: "Exit page",
  serverHalf: "Server middleware",
  serverHalfLead: "This shows what the server middleware on your site reported for each page request.",
  serverHalfNone: "None of the page requests in this session include data from your site's server middleware.",
  layerOff: "This layer wasn't used to classify this session.",
  layerNoHit: "This layer found no evidence for this session.",
  shareOfActions: "Share of actions:",
  web: {
    titles: { sources: "Sources", devices: "Devices", geography: "Geography" },
    dimensions: {
      channel: "Channel", referring_domain: "Referring domain", utm_source: "UTM source", utm_medium: "UTM medium",
      utm_campaign: "UTM campaign", device_type: "Device type", browser: "Browser", os: "OS", country: "Country",
      region: "Region", city: "City", timezone: "Time zone", language: "Language",
    },
    breakdown: "Break down by",
    notSet: "Not set",
    direct: "No referrer",
    showAll: (count: string) => `Show all ${count}`,
    showFewer: "Show fewer",
    all: "All",
    kind: "Session type",
    agentShare: "Agent sessions %",
    split: (metric: string, agent: string, human: string) => `${metric}: ${agent}, ${human}`,
    noKind: (kind: string) => `No ${kind} sessions in the selected date range`,
    removeFilter: "Remove filter",
    watch: (value: string) => `View sessions for ${value} in Session replay`,
    watchPath: (path: string) => `View sessions that visited ${path}`,
    visitedPath: (path: string) => `Visited path: ${path}`,
    removePathFilter: "Remove visited path filter",
    noPathMatches: "Try a longer date range or remove the visited path filter.",
    serverOnly: (product: string) => `Country, region, and city data is available only when ${product} runs on a server.`,
    noPlace: "No sessions in the selected date range have a known country.",
    botsNote: "This table includes Agent and Human sessions only. Script bot sessions aren't counted.",
  },
  /** What each dashboard card shows, behind its information icon (Clarity's own words stay in CLARITY), written as
   *  Clarity writes its tooltips. */
  about: {
    agents: ["This is the number of sessions where an AI agent acted on your site, alone or together with a human."],
    visitors: "This is the number of unique visitors to your site during the selected period of time.",
    pageViews: ["This is the number of pages viewed on your site during the selected period of time, including repeated views of the same page."],
    pagesPerSession: ["This is the average number of pages viewed in a session."],
    trends: ["This chart shows how the selected metric changes over time for Human and Agent sessions."],
    paths: "This table shows the pages visited during the selected period of time, with the sessions, visitors, and page views for each page.",
    sources: "This table shows where your sessions come from, by channel, referring domain, or UTM parameter.",
    devices: "This table shows the device types, browsers, and operating systems used in your sessions.",
    geography: "This table shows where your sessions come from, by country, region, city, time zone, or language.",
    agentShare: "When All is selected, the last column shows the percentage of sessions that are Agent sessions.",
  },
}

/** Microsoft Clarity's own definitions of its dashboard's metrics, word for word (the owner asked for Clarity's words):
 *  Sessions without its sentence on bots, which AgentCake counts. Clarity defines no other metric the dashboard shows. */
export const CLARITY = {
  sessions: ["This is the number of visits to your site during the selected period of time."],
  activeTime: ["This is the average time spent in a session", "Active time: When a user's attention was on your site",
    "Inactive time: When your site was hidden behind other tabs or windows"],
}

/** A total's name, the metric alone: "Sessions", "Active time spent". */
export const metricName = (unit: string) => unit.charAt(0).toUpperCase() + unit.slice(1)


/** The date filter's choices, in menu order. */
export const RANGES: Record<DateRange, string> = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" }

