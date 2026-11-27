// Component overview: every component and every variant cake uses, like the shadcn docs.
// This page is in the visual baseline: any change to a component shows up here first (DESIGN.md §12).
// Components that draw data show cake's own (/api/overview, /api/register and /api/sessions); the rest show fixed sample props.
import type { ReactNode } from "react"
import { Activity, ChevronDown, Copy, Cpu, Download, MoreHorizontal, Play, Plus, Trash2, User, UsersRound } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BudgetWarning, CopyBlock, DiskStoppedWarning, DocumentLink, Hint, InfoTip, PageHeader, StatCard, StorageMeter, StorageUse } from "@/components/cake/bits"
import { Crumb, CrumbHead } from "@/components/cake/crumb"
import { DeleteSession } from "@/components/cake/delete-session"
import { FunnelResults, PathFunnel } from "@/components/cake/path-funnel"
import { OnboardingStep, OrSeparator } from "@/components/cake/onboarding"
import { ProjectLink } from "@/components/cake/project-link"
import { Loaded, PageError, PageLoading } from "@/components/cake/page-state"
import { DemoShopTag, SessionRow } from "@/components/cake/session-row"
import { Spotlight, SpotlightEmpty } from "@/components/cake/spotlight"
import { MiniTimeline, SessionTimeline, TabTimeline, segsInTimeOrder, spansOf, timeLabel, timelineView } from "@/components/cake/timeline"
import { ReplayControls, ReplayStage } from "@/components/cake/replay-stage"
import { ReasonLayer } from "@/components/cake/reasons"
import { ServerHalfTable } from "@/components/cake/server-half"
import { SessionPages } from "@/components/cake/session-pages"
import { Legend, Swatch, ThinEvidenceTag, TurnsBadge, UnnamedTag, VERDICTS, VerdictBadge } from "@/components/cake/verdict"
import { AVATAR_SHAPES, AgentAvatar, AgentTag } from "@/components/cake/avatar"
import { BotHelp, Taxonomy } from "@/components/cake/coverage"
import { TopAgentsChart } from "@/components/cake/top-agents"
import { TrendsChart } from "@/components/cake/trends-chart"
import { TimezonePicker } from "@/components/cake/timezone-picker"
import { PathsTable, TABLE_ICONS, WebStatsTable } from "@/components/cake/web-stats"
import { RegisterCard } from "@/components/cake/register-card"
import { StyleMenu } from "@/components/cake/style-menu"
import { UNREACHABLE, api, useApi } from "@/data/api"
import type { Overview, Registration, SessionSummary, Timezones, WebAnalytics } from "@/data/types"
import { NO_VALUE, integer, mbToBytes } from "@/lib/format"
import { EXAMPLE_SITE, FUNNEL_LOOK, LAYER_LOOKS, PAGE_LOOKS, SERVER_LOOKS, TAB_HANDOFFS, nothing, stillReplay, stillTabs } from "@/pages/component-samples"
import { PRODUCT_NAME } from "@/lib/product"
import { UNNAMED } from "@/lib/taxonomy"
import { CLARITY, WORDS } from "@/lib/words"

/** One component's part of the overview: its name, what it is for in plain words (a paragraph, or several for a longer
 *  rule), the code it names (props, tokens, files, the API it reads), in code type like the name, and the component. */
function Block({ name, use, code, children }: { name: string; use: string | string[]; code?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t-2 border-dashed border-border pt-6 minimal:border-t minimal:border-solid">
      <div className="flex flex-col gap-0.5"><h2 className="font-mono text-base font-bold">{name}</h2>
        {[use].flat().map((paragraph) => <p key={paragraph} className="text-sm text-muted-foreground">{paragraph}</p>)}
        {code && <p className="font-mono text-xs text-muted-foreground">{code}</p>}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  )
}

/** One SessionRow per look: highlighted (Agent: Human + agent, Agent only), normal (Human, Human on thin evidence),
 *  muted (Script bot). */
const ROW_LOOKS: ((s: SessionSummary) => boolean)[] = [
  (s) => s.agent_turns === "human_agent", (s) => s.agent_turns === "agent_only", (s) => s.verdict === "human",
  (s) => s.evidence === "thin", (s) => s.verdict === "bot",
]

export function ComponentsPage() {
  const data = useApi((signal) => Promise.all([api.overview({}, signal), api.registration(signal), api.sessions({}, signal), api.web({}, signal), api.timezones(signal)]), [])
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Components" lead={<>This page shows every component and variant that {PRODUCT_NAME} uses. Add new styles as variants here and in <DocumentLink path="DESIGN.md" />.</>} />
      <Loaded state={data} what="the component overview">{([overview, registration, sessions, web, timezones]) => <Overview overview={overview} registration={registration} sessions={sessions.results} web={web} zones={timezones.zones} />}</Loaded>
    </div>
  )
}

function Overview({ overview: o, registration, sessions, web, zones }: {
  overview: Overview; registration: Registration; sessions: SessionSummary[]; web: WebAnalytics; zones: Timezones["zones"]
}) {
  const rows = ROW_LOOKS.flatMap((look) => sessions.find(look) ?? [])
  const human = sessions.find((s) => s.verdict === "human")
  const demoRow = human && { ...human, id: `${human.id}-demo`, demo_shop: true as const }
  const mixed = rows.find((s) => s.agent_turns === "human_agent")
  const tabbed = sessions.find((s) => s.tabs)
  const mixedSpans = mixed?.segments && spansOf(mixed.segments, mixed.duration_ms)
  return (
    <>
      <Block name="StyleMenu" use={[
          "Use the Style menu at the end of the top bar to switch between two styles. Minimal is the default style and has a plain look. Cake includes the Crumb mascot.",
          "The menu shows a small preview of each style and a check mark next to the style in use. The selected style applies immediately and is saved in this browser. To see every component on this page in Minimal, choose Minimal in the menu.",
        ]} code="lib/style.ts · data-style minimal on <html> · tokens.css · minimal: variant (index.css) · localStorage agentcake-style">
        <StyleMenu />
      </Block>
      <Block name="Button · variant" use={[
          "Use the Default button for the one main action on each screen. Use an Outline button for a secondary action, such as Cancel in a dialog. Use a Secondary button when a secondary action needs less emphasis.",
          "Use Ghost buttons in toolbars and navigation. Use a Destructive button to delete data, and a Link button for a link inside text.",
        ]}>
        <Button>Default</Button><Button variant="outline">Outline</Button><Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button><Button variant="destructive"><Trash2 aria-hidden />Destructive</Button><Button variant="link">Link</Button>
        <p className="w-full text-sm">For setup steps, see <DocumentLink path="SERVER.md" />.</p>
      </Block>
      <Block name="Button · size" use="Use the Large size only in hero sections and the Default size for most other buttons. Use the Small size for buttons inside cards and rows. Every icon-only button has a tooltip that names its action.">
        <Button size="lg"><Play aria-hidden />Large</Button><Button>Default</Button><Button size="sm">Small</Button><Button size="xs">Extra small</Button>
        {([["icon-lg", "Add"], ["icon", "Copy"], ["icon-sm", "Download"]] as const).map(([size, label]) => (
          <Hint key={size} text={label}>
            <Button variant="outline" size={size} aria-label={label}>{label === "Add" ? <Plus /> : label === "Copy" ? <Copy /> : <Download />}</Button>
          </Hint>
        ))}
      </Block>

      <Block name="Badge · verdicts (VerdictBadge) · ThinEvidenceTag" use="Each classification is a badge with an icon, a word, and a color. Unknown marks only a stretch, action, or layer that couldn't be classified. Limited evidence appears next to an uncertain Human badge.">
        <VerdictBadge verdict="human" /><VerdictBadge verdict="agent" /><VerdictBadge verdict="bot" /><VerdictBadge verdict="unknown" /><ThinEvidenceTag />
      </Block>
      <Block name="VerdictBadge · TurnsBadge · percent" use={`On the session page, a bold percentage on the highlight shows how confident ${PRODUCT_NAME} is in the classification and each layer. For a Human classification with limited evidence, a separate, lower confidence percentage appears next to the tag.`}>
        <VerdictBadge verdict="agent" percent={94} /><VerdictBadge verdict="human" percent={96} /><VerdictBadge verdict="human" percent={55} /><ThinEvidenceTag />
        <VerdictBadge verdict="bot" percent={99} /><TurnsBadge turns="human_agent" percent={97} />
      </Block>
      <Block name="TurnsBadge · AgentTag · UnnamedTag" use={[
          "An Agent session is either Agent only or Human + agent. Both badges use the Agent colors. The Human + agent badge has a dot that is half human color and half agent color.",
          "One tag shows the agent's name and the certainty of that name, in session rows and on the session page. The gray avatar marks agents with no name, which are labeled Unnamed.",
        ]}>
        <TurnsBadge turns="agent_only" /><TurnsBadge turns="human_agent" /><AgentTag name="Playwright" />
        <AgentTag name="ChatGPT" certainty="verified" /><AgentTag name="Claude in Chrome" certainty="likely" /><UnnamedTag />
      </Block>
      <Block name="Badge · variant · DemoShopTag" use="Tag badges show neutral facts, such as an agent's name or “sample data”. The “Demo shop” tag marks sessions from an earlier demo shop. The other badge variants come from shadcn/ui.">
        <Badge variant="tag">Claude in Chrome</Badge><Badge variant="tag">sample data</Badge><DemoShopTag /><Badge>Default</Badge><Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge><Badge variant="destructive">Destructive</Badge>
      </Block>
      <Block name="Legend · Swatch" use="A legend appears next to every share bar, timeline, and chart with two or more series.">
        <Legend /><Swatch kind="mixed" />
      </Block>

      <Block name="Card · variant" use={[
          "Default cards frame most content on a page. Use Flat cards for plain numbers, such as the session counts on the dashboard.",
          "Use Sunk cards for empty states and previews, such as the sample sessions on the setup page. Highlight cards are used only for the Agent block at the top of the dashboard.",
        ]}>
        <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["default", "flat", "sunk", "highlight"] as const).map((v) => (
            <Card key={v} variant={v} size="sm"><CardHeader><CardTitle>{v}</CardTitle><CardDescription>Card variant="{v}"</CardDescription></CardHeader></Card>
          ))}
        </div>
      </Block>
      <Block name="StatCard · InfoTip" use={[
          "Each number card under the Agent block names the metric it counts. The icon on each card uses the text color of its classification. Some cards show a note under the number with more detail or the reason data is missing.",
          "Script bot cards are dimmed, and a dash appears when a number has no data. Hover over the information icon to see what a metric or chart means. Sessions and Active time spent use Clarity's own definitions.",
        ]}>
        <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sessions" value={integer(o.counts.all)} mark={<Activity className="size-4" aria-hidden />} help={<InfoTip label="Sessions" lines={CLARITY.sessions} />} />
          <StatCard label={`${VERDICTS.human.label} ${WORDS.sessions}`} value={integer(o.counts.human)} sub={`${integer(o.counts.thin)} ${WORDS.withThinEvidence}`} mark={<User className="size-4 text-human-foreground" aria-hidden />} />
          <StatCard label={`${VERDICTS.bot.label} ${WORDS.sessions}`} value={integer(o.counts.bot)} mark={<Cpu className="size-4 text-unsure-foreground" aria-hidden />} muted help={<BotHelp bot={o.coverage.bot} />} />
          <StatCard label="Visitors" value={web.visitors.all === null ? NO_VALUE : integer(web.visitors.all)} sub={web.visitors.all === null ? WORDS.noVisitorIds : undefined}
            mark={<UsersRound className="size-4" aria-hidden />} />
        </div>
      </Block>

      <Block name="Spotlight" use="The top of the dashboard, showing sessions where an agent acted on behalf of a human."><div className="w-full"><Spotlight overview={o} /></div></Block>
      <Block name="Spotlight · none yet" use="This version appears when sessions are recorded but none of them is an Agent session yet."><div className="w-full"><SpotlightEmpty /></div></Block>

      <Block name="SessionRow" use={[
          "Agent session rows are highlighted, and Script bot session rows are dimmed. Human session rows appear without highlighting.",
          "The compact row is a smaller version used in previews and in the Agent block. Sessions from an earlier demo shop show the Demo shop tag.",
        ]} code="DemoShopTag">
        <div className="flex w-full flex-col gap-3">
          {rows.map((s) => <SessionRow key={s.id} s={s} />)}
          {demoRow && <SessionRow s={demoRow} />}
          {rows[0] && <div className="max-w-sm"><SessionRow s={rows[0]} compact /></div>}
        </div>
      </Block>
      <Block name="MiniTimeline · SessionTimeline" use={[
          "The timeline in each session row shows each human, agent, and unknown segment at its point in time. Screen readers announce these segments in time order.",
          "On the session page, a bar shows each actor's share of the actions, starting with whoever acted first. When two hand-off labels are close together, they appear on two rows so they don't overlap. A playhead marks the current point in the replay.",
        ]}>
        <div className="flex w-full flex-col gap-4">
          {mixed?.segments && <MiniTimeline spans={mixedSpans} label={timeLabel(mixed.segments)} />}
          {mixed?.segments && <MiniTimeline human={35} agent={65} unsure={0} segs={segsInTimeOrder(mixed.segments, { human: 35, agent: 65, unsure: 0 })} size="lg" />}
          {mixed?.segments && (
            <SessionTimeline {...timelineView({ duration_ms: mixed.duration_ms, segments: mixed.segments,
              handoffs: [{ at_ms: 38_000, to: "agent" }, { at_ms: 83_000, to: "human" }] }, { playheadMs: mixed.duration_ms / 2 })} />
          )}
          <SessionTimeline {...timelineView({ duration_ms: 215_000,
            segments: [{ who: "human", start_ms: 0, end_ms: 4_000 }, { who: "agent", start_ms: 39_000, end_ms: 78_000 }, { who: "human", start_ms: 78_000, end_ms: 215_000 }],
            handoffs: [{ at_ms: 39_000, to: "agent" }, { at_ms: 78_000, to: "human" }] })} />
        </div>
      </Block>
      <Block name="Table" use="Numbers in a table are right-aligned, and the table appears inside a card." code="Card">
        <Card className="w-full py-0">
          <Table>
            <TableHeader><TableRow><TableHead>Page</TableHead><TableHead className="text-right">Agent visits</TableHead><TableHead>Human / agent</TableHead></TableRow></TableHeader>
            <TableBody><TableRow><TableCell className="font-mono">/cart</TableCell><TableCell className="text-right">22</TableCell><TableCell><MiniTimeline human={29} agent={71} unsure={0} /></TableCell></TableRow></TableBody>
          </Table>
        </Card>
      </Block>

      <Block name="Tabs · ToggleGroup · Select" use="Tabs switch between panels on the same page. Use the toggle group to select one value, such as a language, a playback speed, or a retention period. Use a select menu for filters, such as the date range.">
        <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">On this computer</TabsTrigger><TabsTrigger value="b">On a server</TabsTrigger></TabsList><TabsContent value="a" /></Tabs>
        <ToggleGroup type="single" variant="outline" defaultValue="30"><ToggleGroupItem value="all">Keep everything</ToggleGroupItem><ToggleGroupItem value="30">30 days</ToggleGroupItem></ToggleGroup>
        <Select defaultValue="any"><SelectTrigger aria-label="Agent"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">Any agent</SelectItem><SelectItem value="cic">Claude in Chrome</SelectItem></SelectContent></Select>
      </Block>
      <Block name="Popover · TimezonePicker" use={[
          `The time zone picker in Settings looks like the other menus. Select it to search the list, and then select a time zone. The first choice follows the computer or server that ${PRODUCT_NAME} runs on.`,
          "Each time zone shows its offset from UTC. Dates and times on the dashboard and in Session replay use the time zone that you select.",
        ]} code="Popover · Input · selectTriggerClass · /api/settings timezone · /api/timezones">
        <div className="w-72"><TimezonePicker zones={zones} value="" follow={WORDS.followMachine("This computer", "America/Los_Angeles", "PST")} onPick={() => undefined} /></div>
      </Block>
      <Block name="ToggleGroup item · outline / agent / human / bot" use="In the session list's filter, All comes first, followed by each classification in its badge colors. Unselected items use the badge's light background and text color. When you select an item, its background changes to the badge's text color.">
        {(["all", "agent", "human", "bot"] as const).map((picked) => (
          <ToggleGroup key={picked} type="single" value={picked} aria-label={`Classification filter, ${picked === "all" ? WORDS.web.all : VERDICTS[picked].label} selected`}>
            <ToggleGroupItem value="all" variant="outline">All</ToggleGroupItem>
            {(["agent", "human", "bot"] as const).map((v) => <ToggleGroupItem key={v} value={v} variant={v}>{VERDICTS[v].label}</ToggleGroupItem>)}
          </ToggleGroup>
        ))}
      </Block>
      <Block name="Input · Label · Switch · Checkbox" use="Switches turn settings on or off. Select a checkbox to agree to something on a form, such as product update emails on the registration card. You need to select each checkbox yourself, and its label is always visible.">
        <div className="flex w-64 flex-col gap-1.5"><Label htmlFor="sel">Hide these parts of the page</Label><Input id="sel" defaultValue=".account-email" /></div>
        <Switch defaultChecked aria-label="On" /><Switch aria-label="Off" /><Switch size="sm" defaultChecked aria-label="Small" />
        <div className="flex items-center gap-2"><Checkbox id="box-off" /><Label htmlFor="box-off">Not selected</Label></div>
        <div className="flex items-center gap-2"><Checkbox id="box-on" defaultChecked /><Label htmlFor="box-on">Selected</Label></div>
      </Block>
      <Block name="Progress · StorageMeter · StorageUse · BudgetWarning · DiskStoppedWarning" use={[
          "The bar stays in the OK color until disk use reaches 80% of the budget, then turns to the warning color. A dashed line marks the 80% point. On the Settings page, the bar shows how much of the budget is used and when it will fill up.",
          "When disk use reaches 80% of the budget, a warning shows how full it is and what happens next. If the budget is full and no replays can be deleted, the warning says that new replays aren't stored. This warning appears in Settings and on the dashboard, which shows no other disk information.",
          "Another warning explains why new replays aren't stored while free disk space is below the minimum.",
        ]}>
        <div className="flex w-full max-w-md flex-col gap-4"><StorageMeter usedPct={31} warnAtPct={80} /><StorageMeter usedPct={82} warnAtPct={80} /></div>
        <div className="flex w-full max-w-md flex-col gap-3"><StorageUse usedBytes={o.storage.used_bytes} budgetBytes={mbToBytes(o.storage.budget_mb)} warnAtPct={o.storage.warn_at_pct} daysLeft={o.storage.days_left} disk={o.storage.disk} replaysStopped={o.storage.replays_stopped} /></div>
        <div className="grid w-full gap-3 md:grid-cols-2"><BudgetWarning usedPct={84} warnAtPct={80} freeAtPct={90} autoFree full={false} /><BudgetWarning usedPct={100} warnAtPct={80} freeAtPct={90} autoFree={false} full /></div>
        <div className="w-full max-w-xl"><DiskStoppedWarning disk={{ total: 500_000_000_000, free: 1_500_000_000, min_free: 2_147_483_648, low: true }} replaysStopped="disk" /></div>
      </Block>
      <Block name="Alert · variant" use="Info alerts explain how something works. Warn alerts ask for attention, such as when disk use reaches 80%. OK alerts confirm a finished task, and Destructive alerts report a failure.">
        <div className="grid w-full gap-3 md:grid-cols-2">
          <Alert variant="info"><AlertTitle>{VERDICTS.agent.label}</AlertTitle><AlertDescription>The behavior changes twice in this session.</AlertDescription></Alert>
          <Alert variant="warn"><AlertTitle>The disk budget is 82% full</AlertTitle><AlertDescription>8.2 GB of the 10 GB budget is used. To keep storing replays, raise the budget or let {PRODUCT_NAME} delete older replays.</AlertDescription></Alert>
          <Alert variant="ok"><AlertTitle>Receiving visits</AlertTitle><AlertDescription>Your site sent a visit 2 minutes ago.</AlertDescription></Alert>
          <Alert variant="destructive"><AlertTitle>Can't reach the server middleware</AlertTitle><AlertDescription>Check the signing key in Settings.</AlertDescription></Alert>
        </div>
      </Block>
      <Block name="Dialog · DropdownMenu · Tooltip (Hint, InfoTip)" use="A dialog asks you to confirm a destructive action. A dropdown menu lists the actions for a row, and every icon-only button shows a tooltip."
        code="Hint · InfoTip · TooltipContent · tooltipSurface · ChartTooltipContent">
        <Dialog>
          <DialogTrigger asChild><Button variant="destructive"><Trash2 aria-hidden />Delete all data</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>Delete every session?</DialogTitle><DialogDescription>This deletes 150 sessions and their replays. This action can't be undone.</DialogDescription></DialogHeader>
            <DialogFooter><Button variant="outline">Cancel</Button><Button variant="destructive">Delete</Button></DialogFooter></DialogContent>
        </Dialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline">Actions<ChevronDown aria-hidden /></Button></DropdownMenuTrigger>
          <DropdownMenuContent><DropdownMenuItem>Watch replay</DropdownMenuItem><DropdownMenuItem>Copy session link</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
        <Hint text="More"><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></Hint>
        <span className="flex items-center gap-2 text-sm font-bold text-muted-foreground">Active time spent<InfoTip label="Active time spent" lines={CLARITY.activeTime} /></span>
      </Block>
      <Block name="DeleteSession" use="The replay page asks you to confirm the session, its replay and every tab in the visit. The session title, time and ID identify the visit before you delete it."
        code="Dialog · Button destructive · Alert · POST /api/delete">
        <DeleteSession sessionTitle="An example session" session={{ id: "1234abcd", when: "Today 09:28" }}
          onDelete={async () => ({ sessions: [{ found: true }], database: { error: null, log_cleared: true }, backups: [], log_lines: 0 })} onDone={nothing} />
      </Block>
      <Block name="TopAgentsChart · MetricPicker" use={[
          "Top agents shows a bar for each agent, based on the metric that you select. The metric menu works the same way as on Trends. The agent with the highest value appears first.",
          "Each agent gets its own row, and Unnamed agents appear with the gray avatar. Each bar ends with its value, or a dash when there's no value. Script bots never appear in this chart.",
        ]} code="MetricPicker · /api/web">
        <div className="w-full"><TopAgentsChart agents={web.agents} /></div>
      </Block>
      <Block name="TrendsChart (shadcn Chart + recharts)" use={[
          "Trends shows one line for Human sessions and one for Agent sessions, by hour or by day.",
          "The chart has a legend and a tooltip. Show as table lists the same numbers. The note under the chart names the time zone of its days and hours.",
        ]} code="MetricPicker · chart-1 (Human) · chart-2 (Agent) · /api/web">
        <div className="w-full"><TrendsChart trends={web.trends} timeZone={web.time_zone} /></div>
      </Block>
      <Block name="CopyBlock · OrSeparator" use="Select Copy to copy a command or the sentence for a coding agent. Placeholders appear instead of real values.">
        <div className="flex w-full max-w-xl flex-col gap-3"><CopyBlock text="agentcake setup --print --site" /><OrSeparator /></div>
      </Block>
      <Block name="OnboardingStep" use="One numbered step of the website setup, shown on the home page and the dashboard before the first visit.">
        <div className="w-full max-w-xl"><OnboardingStep n={1} title="Enter your website's address"><p className="text-sm text-muted-foreground">Describe what to do in this step.</p></OnboardingStep></div>
      </Block>
      <Block name="ProjectLink" use="The top bar shows the website's address, which opens the site in a new tab. Until the address is set, the top bar shows Set up your website instead. Before the first session, it opens the setup steps, and after that, it opens Settings.">
        <div className="flex flex-wrap items-center gap-2"><ProjectLink domain="shop.example.com" connected /><ProjectLink domain={null} connected={false} /><ProjectLink domain={null} connected /></div>
      </Block>
      <Block name="Crumb" use={[
          "Use Wave for welcomes and movement, Look for waiting, Sleep for no results, and Oops for errors.",
          "The head alone is the logo and the marker for sessions where an agent acted for a human.",
        ]}>
        {(["wave", "look", "sleep", "oops"] as const).map((p) => <Crumb key={p} pose={p} className="w-28" label={`Mascot, ${p} pose`} />)}
        <CrumbHead className="size-12" /><CrumbHead className="size-6" />
      </Block>
      <Separator />
      <Block name="AgentAvatar · AgentTag · UnnamedTag" use={[
          "Each agent always has the same dessert-shaped avatar, next to its name. Avatars use flat colors that are never the same as a classification color.",
          "The gray avatar marks agents with no name, which are labeled Unnamed. Unnamed agents are shown with a gray scoop avatar, the same gray used for Script bot and Unknown. Avatars idle and blink, and they stay still when reduced motion is on.",
        ]} code="--avatar-1 … --avatar-6">
        <div className="flex w-full flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            {AVATAR_SHAPES.map((shape, i) => (
              <span key={shape} className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                <AgentAvatar look={{ shape: i, colour: 1 + (i % 6), phase: i % 6 }} className="size-14" />{shape}
              </span>
            ))}
            <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground"><AgentAvatar name={UNNAMED} className="size-14" />{UNNAMED}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">{o.agents_seen.map((a) => (a.name ? <AgentTag key={a.name} name={a.name} /> : <UnnamedTag key={UNNAMED} />))}</div>
        </div>
      </Block>
      <Block name="Taxonomy · BotHelp" use="The bottom of the dashboard lists each classification with its badge and a short description. Agent only and Human + agent appear under Agent. The “?” on the Script bot sessions card explains what counts as a script bot." code="BotHelp · judging.en.json (read when the pages are built)">
        <div className="w-full"><Taxonomy /></div>
      </Block>
      <Block name="StatsTable · PathsTable · WebStatsTable · TableNote" use={[
          "The Paths, Sources, Devices, and Geography cards all use this table. Each card shows its title at the top. Each table starts with a different breakdown: Channel, Device type, or Country.",
          "All, Agent, and Human use the session list's classification colors. Each row shows the sessions in bold, then visitors and page views, for the selected type. When All is selected, the Agent share also appears in bold.",
          "Hover over a row to split each number into Agent and Human. Rows are sorted by sessions, and the first ten appear until you select Show all. Script bots aren't counted.",
          "Select a path or a breakdown value to open its matching sessions with the date range and session type selected. The session list shows a removable filter. On a narrow screen, the table scrolls inside its card.",
          "A region or city appears with its country. Each country also has its own Not set row.",
          "Below Geography, SourceCredit links to the source of the city database.",
        ]} code="Select · SourceCredit · /api/web · /api/sessions">
        <div className="w-full"><PathsTable paths={web.paths} shown={web.shown} /></div>
        <div className="w-full"><WebStatsTable title={WORDS.web.titles.sources} icon={TABLE_ICONS.sources} help={WORDS.about.sources} table={web.tables.sources} shown={web.shown} place={web.place} /></div>
        <div className="w-full"><WebStatsTable title={WORDS.web.titles.geography} icon={TABLE_ICONS.geography} help={WORDS.about.geography} table={web.tables.geography} shown={web.shown} place={web.place} initial="region" /></div>
      </Block>
      <Block name="PathFunnel · FunnelResults" use={[
        "Enter two or more page paths in the order a session should reach them. The dashboard's date range determines which sessions count.",
        "The table shows how many sessions reached each step or dropped off before it, in all and for Agent and Human. Percentages use the sessions of that kind that reached the first step.",
      ]} code="Card · Input · Label · Button outline · Table · /api/funnel">
        <div className="w-full">
          <PathFunnel steps={FUNNEL_LOOK.steps.map((step) => step.path)} onRun={nothing}>
            <FunnelResults report={FUNNEL_LOOK} />
          </PathFunnel>
        </div>
      </Block>
      <Block name="PageLoading · PageError" use="Before a page's data is ready, a loading message fades in after a moment. If the data can't load, the page shows the error and a Try again button." code="Loaded">
        <div className="grid w-full items-center gap-4 md:grid-cols-2">
          <PageLoading what="sessions" />
          <PageError title="Unable to load sessions" message={UNREACHABLE} onRetry={() => undefined} />
        </div>
      </Block>
      <Block name="ReplayStage · ReplayControls" use="During playback, a label on the cursor shows who is acting. A message appears when there's no replay. Controls include play, time, speed, and Jump to hand-off." code="rrweb-player">
        <Card className="w-full max-w-xl gap-0 py-0">
          <ReplayStage replay={stillReplay(EXAMPLE_SITE, "missing")} />
          <ReplayControls replay={stillReplay(EXAMPLE_SITE, "ready")} durationMs={96400} />
        </Card>
      </Block>
      <Block name="Sessions of several tabs: TabLines · TabTimeline · ReplayControls tab menu" use={[
          "A session can include more than one tab of the same browser. Its row shows the number of tabs and a line for each tab.",
          "On the session page, the timeline shows a track for each tab, and the replay shows one tab at a time. By default, the replay follows the tab where the visitor is active. To watch one tab from start to end, select it in the tab menu. The address bar names the tab that the replay shows.",
          "Pages visited, All actions, and Server middleware add a Tab column. Why this classification shows the reasons for each tab, starting with the tab that the classification is based on.",
        ]} code="MiniTimeline size xs · /api/sessions tabs · /api/session tabs, follow, verdict_tab · replay?tab=">
        {tabbed?.tabs && (
          <div className="flex w-full flex-col gap-4">
            <SessionRow s={tabbed} />
            <TabTimeline ticks={timelineView({ duration_ms: tabbed.duration_ms, segments: [], handoffs: [] }).ticks} playhead={30}
              tracks={tabbed.tabs.map((t, i) => {
                const { spans, handoffs } = timelineView({ duration_ms: tabbed.duration_ms, segments: t.segments, handoffs: TAB_HANDOFFS[i] ?? [] })
                return { label: WORDS.tab(i + 1), spans, handoffs, shown: i === 1 }
              })} />
            <Card className="w-full max-w-xl gap-0 py-0">
              <ReplayStage replay={stillTabs("missing")} />
              <ReplayControls replay={stillTabs("ready")} durationMs={tabbed.duration_ms} />
            </Card>
          </div>
        )}
      </Block>
      <Block name="SessionPages" use="The pages in the replay, in the order they opened, with the entry and exit pages marked. Each row shows when the page opened, the time on it, who acted, and their actions. Selecting a row plays the replay from that page.">
        <div className="w-full max-w-xl"><SessionPages pages={PAGE_LOOKS} onJump={nothing} /></div>
      </Block>
      <Block name="ReasonLayer" use="Each of the four layers in Why this classification lists its reasons. Below each reason's explanation, smaller text lists the details that were detected. When a layer is turned off, it has a dashed border and a note that explains why.">
        <div className="grid w-full items-start gap-3 md:grid-cols-2">{LAYER_LOOKS.map((layer) => <ReasonLayer key={layer.layer} layer={layer} />)}</div>
      </Block>
      <Block name="ServerHalfTable" use="This table shows the details that your site's server middleware reported for each page request. In server mode, the table also shows the network line. A network line that shows a country ends with the city database credit.">
        <div className="w-full"><ServerHalfTable server={SERVER_LOOKS} /></div>
      </Block>
      <Block name="RegisterCard" use={[
          `The registration card appears before every page until this ${PRODUCT_NAME} is registered. Select View registration data to see the exact JSON that the button sends. The button stays disabled until the email address is valid.`,
          `In this example, the registration couldn't be sent, so the card shows the reason and a Continue button. ${PRODUCT_NAME} doesn't retry, and the card appears again the next time you open it.`,
        ]} code="src/lib/registration.ts">
        <div className="w-full">
          <RegisterCard rules={registration} outcome={{ state: "not_sent", message: `${PRODUCT_NAME} couldn't reach tartini.ai ([Errno 8] nodename nor servname provided, or not known). Check your internet connection, and then try again.` }}
            onRegister={nothing} onContinue={nothing} initial={{ email: "owner@example.com", company: "Example Shop" }} />
        </div>
      </Block>

    </>
  )
}
