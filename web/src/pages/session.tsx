// One session: replay + who acted when + pages visited + four-layer reasons + server middleware + all actions (DESIGN.md §6.4). Data:
// /api/session/<id>; the replay plays in rrweb-player, chunk by chunk from …/replay?chunk=<n> (lib/use-replay.ts).
// A session of more than one tab (a visit's tabs are one session, as PostHog's are) says how many, plays one tab at a
// time (the tab the visitor is active in, or one picked), has a track per tab, names the tab of each page and action,
// and shows each tab's own reasons, the tab the verdict rests on first.
import { useState } from "react"
import { ArrowLeft, Search, Sparkles, Timer } from "lucide-react"
import { Link, useLocation, useNavigate, useParams } from "react-router"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SectionTitle, Columns } from "@/components/cake/bits"
import { AgentTag } from "@/components/cake/avatar"
import { DeleteSession } from "@/components/cake/delete-session"
import { Loaded } from "@/components/cake/page-state"
import { ReplayControls, ReplayStage, missingText } from "@/components/cake/replay-stage"
import { ServerHalfTable } from "@/components/cake/server-half"
import { SessionPages } from "@/components/cake/session-pages"
import { MiniTimeline, SessionTimeline, TabTimeline, segsInTimeOrder, timelineView, type TabTimelineTrack, type TimelineSeek } from "@/components/cake/timeline"
import { Legend, ThinEvidenceTag, TurnsBadge, UnnamedTag, VERDICTS, VerdictBadge } from "@/components/cake/verdict"
import { ReasonLayer } from "@/components/cake/reasons"
import { api, useApi } from "@/data/api"
import type { Actor, AgentName, SessionDetail, SessionSummary, SessionTab } from "@/data/types"
import { clock, duration, integer } from "@/lib/format"
import { playable } from "@/lib/replay-tabs"
import { actorAt } from "@/lib/replay-timing"
import { useReplay, type ReplayState } from "@/lib/use-replay"
import { WORDS } from "@/lib/words"

export function SessionPage() {
  const { id = "" } = useParams()
  return <SessionView key={id} id={id} />
}

function SessionView({ id }: { id: string }) {
  const { search } = useLocation()
  const navigate = useNavigate()
  const toList = { pathname: "/sessions", search }
  const detail = useApi((signal) => api.session(id, signal), [id])
  return (
    <div className="flex flex-col gap-5">
      <div><Button variant="link" size="sm" asChild><Link to={toList}><ArrowLeft aria-hidden />{WORDS.sessionsPage}</Link></Button></div>
      <Loaded state={detail} what="this session">{(d) => (
        <SessionBody key={d.session.id} d={d} onDone={() => void navigate(toList, { replace: true })} />
      )}</Loaded>
    </div>
  )
}

/** The cursor's name for each actor: the agent acting by name (agent: its name, null when it has none), a human, or
 *  Unknown. */
const cursorLabels = (agent: string | null): Record<Actor, string> =>
  ({ agent: agent ?? VERDICTS.agent.label, human: WORDS.aHuman, unsure: VERDICTS.unknown.label })

/** "0:52 of 1:36 · Agent": how the timeline reads where the replay is (who acts in the tab on the stage). */
function positionText(d: SessionDetail, replay: ReplayState, ms: number) {
  const who = actorAt(replay.tabs?.segments ?? d.timeline.segments, ms)
  const labels = cursorLabels(replay.tabs ? replay.tabs.agent : d.session.agent)
  return `${clock(ms)} of ${clock(d.timeline.duration_ms)}${who ? ` · ${labels[who]}` : ""}`
}

/** The agents a session or a tab names: every one of a session more than one acted in, else its one (null: Unnamed). */
const namedAgents = (s: Pick<SessionSummary, "agent" | "certainty" | "agents">): AgentName[] => s.agents ?? [{ name: s.agent, certainty: s.certainty }]

/** Its verdict's badges: the verdict (with how sure, on the session page), limited evidence, an Agent session's split,
 *  and who acted by name. */
function Verdict({ s, percent }: { s: Pick<SessionSummary, "verdict" | "evidence" | "agent_turns" | "agent" | "certainty" | "agents">; percent: number | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <VerdictBadge verdict={s.verdict} percent={percent} />{s.evidence && <ThinEvidenceTag />}{s.agent_turns && <TurnsBadge turns={s.agent_turns} />}
      {s.verdict === "agent" ? namedAgents(s).map((a) => (a.name ? <AgentTag key={a.name} name={a.name} certainty={a.certainty} /> : <UnnamedTag key="" />))
        : s.agent && <AgentTag name={s.agent} certainty={s.certainty} />}
    </div>
  )
}

/** A tab's name: "Tab 2", or "Tab 1 from 45:10" for a part of a tab whose number another part shares. */
function tabName(tabs: SessionTab[], tab: SessionTab) {
  return tabs.filter((t) => t.tab === tab.tab).length > 1 ? WORDS.tabFrom(tab.tab, clock(tab.start_ms)) : WORDS.tab(tab.tab)
}

/** The tracks of a session with more than one tab: one per tab, its parts' runs and hand-offs together. */
function tabTracks(d: SessionDetail, tabs: SessionTab[], shown: number | undefined): TabTimelineTrack[] {
  return [...new Set(tabs.map((t) => t.tab))].map((n) => {
    const parts = tabs.filter((t) => t.tab === n)
    const { spans, handoffs } = timelineView({ duration_ms: d.timeline.duration_ms, segments: parts.flatMap((t) => t.segments), handoffs: parts.flatMap((t) => t.handoffs) })
    return { label: WORDS.tab(n), spans, handoffs, shown: n === shown }
  })
}

function SessionBody({ d, onDone }: { d: SessionDetail; onDone: () => void }) {
  const s = d.session
  const replay = useReplay(d, (n, signal, tab) => api.replayChunk(s.id, n, signal, tab), cursorLabels)
  const live = replay.status !== "missing"
  // a session of several tabs keeps its controls while another tab has a replay to play; with none, none (§6.4)
  const anyReplay = live || (d.tabs ?? []).some((t) => playable(t.replay))
  const acted = s.share.human + s.share.agent + s.share.unsure > 0 // the actions All actions lists, by who took them
  const tabCount = new Set(d.tabs?.map((t) => t.tab)).size
  // the timeline moves the replay once it is ready; in a session of several tabs also while another tab's replay loads,
  // so the control and its focus stay while the player changes tabs
  const movable = replay.status === "ready" || (replay.tabs !== undefined && replay.status === "loading")
  const seek: TimelineSeek | undefined = live && movable
    ? { durationMs: d.timeline.duration_ms, valueMs: replay.timeMs, valueText: positionText(d, replay, replay.timeMs), onSeek: replay.seek } : undefined
  const view = timelineView(d.timeline, { playheadMs: live ? replay.timeMs : undefined })
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Verdict s={s} percent={d.percent} />
          <h1 className="text-3xl font-semibold minimal:text-2xl minimal:font-bold minimal:tracking-tight">{d.title}</h1>
          <p className="text-sm text-muted-foreground">{s.when} · {duration(d.timeline.duration_ms)} · {tabCount > 1 && `${WORDS.tabCount(integer(tabCount))} · `}{integer(d.pages.length)} page{d.pages.length === 1 ? "" : "s"} · {WORDS.sessionId} <span className="font-mono">{s.id}</span></p>
        </div>
        <DeleteSession sessionTitle={d.title} session={s} onDelete={() => api.deleteSession(s.id)} onDone={onDone} />
      </div>
      <Columns ratio="3-2">
        <div className="flex flex-col gap-5">
          <Card className="gap-0 py-0">
            <ReplayStage replay={replay} />
            {anyReplay && <ReplayControls replay={replay} durationMs={d.timeline.duration_ms} />}
          </Card>
          {replay.missing === "dropped" && <Alert variant="warn"><AlertDescription>{missingText("dropped")}</AlertDescription></Alert>}
          {replay.noPage && <Alert variant="info" data-replay-note="no-page"><AlertDescription>{WORDS.replayNoPage}</AlertDescription></Alert>}
          <Card>
            <CardHeader><CardTitle icon={Timer}>Activity timeline</CardTitle><CardAction><Legend /></CardAction></CardHeader>
            <CardContent className="flex flex-col gap-4">
              {d.tabs ? <TabTimeline tracks={tabTracks(d, d.tabs, replay.tabs?.shown)} playhead={view.playhead} ticks={view.ticks} seek={seek} />
                : <SessionTimeline {...view} seek={seek} />}
              {acted ? <>
                <MiniTimeline human={s.share.human} agent={s.share.agent} unsure={s.share.unsure} segs={segsInTimeOrder(d.timeline.segments, s.share)} size="lg" />
                <p className="text-sm text-muted-foreground">{`${WORDS.shareOfActions} ${VERDICTS.human.label} ${s.share.human}%, ${VERDICTS.agent.label} ${s.share.agent}%, ${VERDICTS.unknown.label} ${s.share.unsure}%`}</p>
              </> : <p className="text-sm text-muted-foreground">{WORDS.noActions}</p>}
            </CardContent>
          </Card>
          <SessionPages pages={d.pages} onJump={replay.status === "ready" ? replay.jumpTo : undefined} />
        </div>
        <Reasons d={d} />
      </Columns>
      <div>
        <SectionTitle aside={<span className="text-xs text-faint-foreground">{WORDS.serverHalfLead}</span>}>{WORDS.serverHalf}</SectionTitle>
        <ServerHalfTable server={d.server} />
      </div>
      <Actions d={d} replay={replay} />
    </>
  )
}

/** Why this classification: the session's reasons; with more than one tab, each tab's own, picked above them (first
 *  the tab an address named, else the one the verdict rests on), under that tab's own verdict. */
function Reasons({ d }: { d: SessionDetail }) {
  const [picked, setPicked] = useState(d.named_tab ?? d.verdict_tab ?? "")
  const tab = d.tabs?.find((t) => t.id === picked)
  return (
    <Card>
      <CardHeader>
        <CardTitle icon={Search}>Why this classification</CardTitle>
        {d.tabs && (
          <CardAction>
            <ToggleGroup type="single" variant="outline" size="sm" value={picked} onValueChange={(v) => v && setPicked(v)} aria-label={WORDS.reasonsTab} className="flex-wrap">
              {d.tabs.map((t) => <ToggleGroupItem key={t.id} value={t.id}>{tabName(d.tabs ?? [], t)}</ToggleGroupItem>)}
            </ToggleGroup>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {tab && <Verdict s={tab} percent={tab.percent} />}
        <Alert variant="info"><Sparkles aria-hidden /><AlertDescription><span>{tab?.summary ?? d.summary}</span></AlertDescription></Alert>
        {(tab?.layers ?? d.layers).map((layer) => <ReasonLayer key={layer.layer} layer={layer} />)}
      </CardContent>
    </Card>
  )
}

/** All actions, each time a link that moves the replay there; with more than one tab, the tab each was taken in. */
function Actions({ d, replay }: { d: SessionDetail; replay: ReplayState }) {
  const canSeek = replay.status === "ready"
  const tabbed = d.tabs !== undefined
  return (
    <div>
      <SectionTitle aside={<span className="text-xs text-faint-foreground">Text that visitors enter is masked.</span>}>All actions</SectionTitle>
      <Card className="py-0">
        <Table>
          <TableHeader><TableRow><TableHead>Time</TableHead>{tabbed && <TableHead>{WORDS.tabColumn}</TableHead>}<TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead className="max-md:hidden">Page</TableHead></TableRow></TableHeader>
          <TableBody>{d.actions.map((a, i) => (
            <TableRow key={`${a.at_ms}-${i}`}>
              <TableCell className="font-mono">{canSeek ? <Button variant="link" size="xs" onClick={() => replay.seek(a.at_ms)}>{clock(a.at_ms)}</Button> : clock(a.at_ms)}</TableCell>
              {tabbed && <TableCell data-tab-cell="">{a.tab}</TableCell>}
              <TableCell><VerdictBadge verdict={a.who} /></TableCell><TableCell className="whitespace-normal">{a.what}</TableCell><TableCell className="font-mono max-md:hidden">{a.page}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
      </Card>
    </div>
  )
}
