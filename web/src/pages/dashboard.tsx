// Dashboard (DESIGN.md §1.1), in three parts with one heading level. Key metrics: the Agent block first, then the counts
// by importance, each card named by what it counts: sessions, visitors, page views, active time spent and pages per
// session, in total and by verdict. Deep dive, its cards straight under its heading and named by their content as
// PostHog's and Clarity's dashboards: Top agents, Trends, Paths, Path funnel, Sources, Devices and Geography, each
// as wide as the cards above. Reference last (the session list is Session replay's). What a number or a chart means is
// behind its information icon (Clarity's own words where Clarity defines it). The disk shows only as a warning, from the
// budget's warning share on or while new replays stop. One AgentCake is one project, its website: no source filter.
// Until the first session it shows how to connect the website, the home page's onboarding (as PostHog 1.0's dashboard
// showed its setup over the page until the first event); while the only sessions are an earlier AgentCake's demo shop's,
// it says the website isn't connected and links to the four steps. On a server whose latest sessions came from a CDN's
// IP addresses (address_check), a warning says the address read is the CDN's. Data: /api/setup (is anything recorded, by the
// website, and was there ever an Agent session), then /api/overview and /api/web (visitors, active time spent, the
// Paths, Sources, Devices and Geography tables) filtered by date range (kept in the URL, like PostHog 1.0's filters).
import { useState } from "react"
import { Activity, FileText, Files, Network, Plug, Timer, UsersRound } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BudgetWarning, DiskStoppedWarning, DocumentLink, InfoTip, PageHeader, StatCard } from "@/components/cake/bits"
import { Spotlight, SpotlightEmpty } from "@/components/cake/spotlight"
import { TopAgentsChart } from "@/components/cake/top-agents"
import { METRICS, activeMinutes } from "@/components/cake/metric-picker"
import { TrendsChart } from "@/components/cake/trends-chart"
import { PathsTable, TABLE_ICONS, WebStatsTable } from "@/components/cake/web-stats"
import { VERDICTS } from "@/components/cake/verdict"
import { BotHelp, Taxonomy } from "@/components/cake/coverage"
import { Loaded } from "@/components/cake/page-state"
import { api, useApi } from "@/data/api"
import type { ActiveTime, DateRange, Overview, Verdict, WebAnalytics } from "@/data/types"
import { RANGE_KEYS, readRange } from "@/lib/filters"
import { NO_VALUE, integer, mbToBytes, minutes, percent } from "@/lib/format"
import { PRODUCT_NAME } from "@/lib/product"
import { TAXONOMY } from "@/lib/taxonomy"
import { cn } from "@/lib/utils"
import { CLARITY, RANGES, WORDS, metricName } from "@/lib/words"
import { Onboarding } from "@/pages/home"
import { DashboardFunnel } from "@/pages/dashboard-funnel"

/** The text colour of each verdict's icon on the number cards: the colour its badge's word has. */
const VERDICT_TONE: Record<Verdict, string> = { human: "text-human-foreground", agent: "text-agent-foreground", bot: "text-unsure-foreground" }

/** "Agent sessions", "Human visitors", "Script bot page views": every count on the dashboard is named by what it
 *  counts. */
const countOf = (verdict: Verdict, unit: string) => `${VERDICTS[verdict].label} ${unit}`

function VerdictIcon({ verdict }: { verdict: Verdict }) {
  const Icon = VERDICTS[verdict].icon
  return <Icon className={cn("size-4", VERDICT_TONE[verdict])} aria-hidden />
}

/** The date range filter, kept in the URL: the one Select the dashboard and the session list both show. */
export function RangeFilter({ range, onRange }: { range: DateRange; onRange: (v: string) => void }) {
  return (
    <Select value={range} onValueChange={onRange}><SelectTrigger aria-label="Date range"><SelectValue /></SelectTrigger>
      <SelectContent>{RANGE_KEYS.map((r) => <SelectItem key={r} value={r}>{RANGES[r]}</SelectItem>)}</SelectContent></Select>
  )
}

export function DashboardPage() {
  const [asked, setAsked] = useState(0)
  const setup = useApi((signal) => api.setup(signal), [asked])
  return (
    <Loaded state={setup} what="the dashboard">
      {(s) => (s.recorded.sessions > 0 ? <Dashboard agentEver={s.recorded.agent > 0} demoOnly={s.recorded.site === 0} />
        : <Onboarding setup={s} onOpen={() => setAsked(asked + 1)} />)}
    </Loaded>
  )
}

function Dashboard({ agentEver, demoOnly }: { agentEver: boolean; demoOnly: boolean }) {
  const [params, setParams] = useSearchParams()
  const range = readRange(params)
  const data = useApi((signal) => Promise.all([api.overview({ range }, signal), api.web({ range }, signal)]), [range])
  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">{WORDS.dashboard}</h1>
      <PageHeader as="h2" title={WORDS.keyMetrics} actions={<RangeFilter range={range} onRange={(value) => setParams((p) => { p.set("range", value); return p })} />} />
      {demoOnly && <NotConnected />}
      <Loaded state={data} what="the dashboard">{([o, web]) => <DashboardBody o={o} web={web} range={range} agentEver={agentEver} demoOnly={demoOnly} />}</Loaded>
    </div>
  )
}

/** Only the demo shop's sessions so far: the website isn't connected, and the four steps are a click away. */
function NotConnected() {
  return (
    <Alert variant="info">
      <Plug aria-hidden />
      <AlertTitle>{WORDS.notConnectedTitle}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{WORDS.notConnectedDemo}</span>
        <Button asChild variant="outline" size="sm"><Link to="/">{WORDS.connectWebsite}</Link></Button>
      </AlertDescription>
    </Alert>
  )
}

function DashboardBody({ o, web, range, agentEver, demoOnly }: {
  o: Overview; web: WebAnalytics; range: DateRange; agentEver: boolean; demoOnly: boolean
}) {
  const { counts, storage } = o
  return (
    <>
      <BudgetWarning usedPct={percent(storage.used_bytes, mbToBytes(storage.budget_mb))} warnAtPct={storage.warn_at_pct}
        freeAtPct={storage.free_to_pct} autoFree={storage.auto_free} full={storage.replays_stopped === "budget"} />
      <DiskStoppedWarning disk={storage.disk} replaysStopped={storage.replays_stopped} />
      {o.address_check.misconfigured && (
        <Alert variant="warn"><Network aria-hidden /><AlertTitle>{WORDS.addressCheck.title}</AlertTitle>
          <AlertDescription><>{WORDS.addressCheck.text(integer(o.address_check.cdn), integer(o.address_check.sessions), PRODUCT_NAME)} <DocumentLink path="SERVER.md" />.</></AlertDescription></Alert>
      )}
      {counts.agent > 0 || agentEver ? <Spotlight overview={o} /> : <SpotlightEmpty />}
      <Totals o={o} web={web} demoOnly={demoOnly} />
      <div className="mt-8 flex flex-col gap-5">
        <PageHeader as="h2" title={WORDS.deepDive} />
        <TopAgentsChart agents={web.agents} />
        <TrendsChart trends={web.trends} timeZone={web.time_zone} />
        <PathsTable paths={web.paths} shown={web.shown} range={range} />
        <DashboardFunnel range={range} />
        <WebStatsTable title={WORDS.web.titles.sources} icon={TABLE_ICONS.sources} help={WORDS.about.sources} table={web.tables.sources} shown={web.shown} place={web.place} range={range} initial="channel" />
        <WebStatsTable title={WORDS.web.titles.devices} icon={TABLE_ICONS.devices} help={WORDS.about.devices} table={web.tables.devices} shown={web.shown} place={web.place} range={range} initial="device_type" />
        <WebStatsTable title={WORDS.web.titles.geography} icon={TABLE_ICONS.geography} help={WORDS.about.geography} table={web.tables.geography} shown={web.shown} place={web.place} range={range} initial="country" />
      </div>
      <div className="mt-8 flex flex-col gap-3">
        <PageHeader as="h2" title={TAXONOMY.title} />
        <Taxonomy />
        {TAXONOMY.counted.map((line) => <p key={line} className="text-sm text-muted-foreground">{line}</p>)}
      </div>
    </>
  )
}

/** The counts under Key metrics, most important first, four to a row and every card the same size (one grid whose rows
 *  are equally tall): sessions, visitors, page views, active time spent and pages per session, each in total (a card
 *  named by the metric alone) and by verdict (Agent is the top block's number too; Script bot is muted). Only a total
 *  card says what its metric means. Visitors and active time come from /api/web: a visitor is a visitor ID (a visitor
 *  with sessions of two kinds counts in both), active time is Clarity's, with each kind's average total time under it.
 *  While only the demo shop's sessions are listed, Sessions says so. */
function Totals({ o, web, demoOnly }: { o: Overview; web: WebAnalytics; demoOnly: boolean }) {
  const { counts, coverage, page_views: views, pages_per_session: pages } = o
  const kinds = ["agent", "human", "bot"] as const
  const all = metricName
  const perSession = (value: number | null) => (value === null ? NO_VALUE : METRICS.pages_per_session.shown(value))
  const visitors = (n: number | null) => ({ value: n === null ? NO_VALUE : integer(n), sub: n === null ? WORDS.noVisitorIds : undefined })
  const time = (t: ActiveTime) => (t ? { value: METRICS.active_time.shown(activeMinutes(t.active_ms)), sub: WORDS.outOfTotalTime(minutes(t.total_ms)) }
    : { value: NO_VALUE, sub: WORDS.noSessionsInRange })
  return (
    <section aria-label={WORDS.totals} className="grid auto-rows-fr grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label={all(WORDS.sessions)} value={integer(counts.all)} sub={demoOnly ? WORDS.allFromDemoShop : undefined} mark={<Activity className="size-4" aria-hidden />}
        help={<InfoTip label={all(WORDS.sessions)} lines={CLARITY.sessions} />} />
      <StatCard label={countOf("agent", WORDS.sessions)} value={integer(counts.agent)} mark={<VerdictIcon verdict="agent" />} />
      <StatCard label={countOf("human", WORDS.sessions)} value={integer(counts.human)} sub={counts.thin ? `${integer(counts.thin)} ${WORDS.withThinEvidence}` : undefined} mark={<VerdictIcon verdict="human" />} />
      <StatCard label={countOf("bot", WORDS.sessions)} value={integer(counts.bot)} mark={<VerdictIcon verdict="bot" />} muted help={<BotHelp bot={coverage.bot} />} />
      <StatCard label={all(WORDS.visitors)} {...visitors(web.visitors.all)} mark={<UsersRound className="size-4" aria-hidden />}
        help={<InfoTip label={all(WORDS.visitors)} lines={[WORDS.about.visitors, WORDS.visitorsAre]} />} />
      {kinds.map((v) => <StatCard key={`${v}-visitors`} label={countOf(v, WORDS.visitors)} {...visitors(web.visitors[v])} mark={<VerdictIcon verdict={v} />} muted={v === "bot"} />)}
      <StatCard label={all(WORDS.pageViews)} value={integer(views.all)} mark={<FileText className="size-4" aria-hidden />}
        help={<InfoTip label={all(WORDS.pageViews)} lines={WORDS.about.pageViews} />} />
      {kinds.map((v) => <StatCard key={`${v}-views`} label={countOf(v, WORDS.pageViews)} value={integer(views[v])} mark={<VerdictIcon verdict={v} />} muted={v === "bot"} />)}
      <StatCard label={all(WORDS.activeTime)} {...time(web.active_time.all)} mark={<Timer className="size-4" aria-hidden />}
        help={<InfoTip label={all(WORDS.activeTime)} lines={CLARITY.activeTime} />} />
      {kinds.map((v) => <StatCard key={`${v}-time`} label={countOf(v, WORDS.activeTime)} {...time(web.active_time[v])} mark={<VerdictIcon verdict={v} />} muted={v === "bot"} />)}
      <StatCard label={all(WORDS.pagesPerSession)} value={perSession(pages.all)} sub={pages.all === null ? WORDS.noSessionsInRange : undefined} mark={<Files className="size-4" aria-hidden />}
        help={<InfoTip label={all(WORDS.pagesPerSession)} lines={WORDS.about.pagesPerSession} />} />
      {kinds.map((v) => <StatCard key={`${v}-pages`} label={countOf(v, WORDS.pagesPerSession)} value={perSession(pages[v])} sub={pages[v] === null ? WORDS.noSessionsInRange : undefined}
        mark={<VerdictIcon verdict={v} />} muted={v === "bot"} />)}
    </section>
  )
}
