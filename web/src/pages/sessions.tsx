// Session replay: the session list, everything by default, highlighted agent rows, muted bots (DESIGN.md §6.1). Data:
// /api/sessions, one page at a time; the filters live in the URL (like PostHog 1.0's event list). The verdict filter is
// All, Agent, Human and Script bot, All picked by default, each verdict in its badge's colours; under Agent, a second
// row splits it into Agent only and Human + agent (named as src/lib/taxonomy.ts names them), which combines with the
// agent's name (the dashboard links to each name). A row of the dashboard's Sources, Devices or Geography tables opens
// the list of its sessions (dimension and key in the URL, as PostHog's "View recordings"): a tag in the filter bar says
// which. A Paths row adds the exact visited pathname to the list's URL. Its own filter tag clears just that path.
import { useState } from "react"
import { useLocation, useSearchParams } from "react-router"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Hint, PageHeader } from "@/components/cake/bits"
import { Crumb } from "@/components/cake/crumb"
import { Loaded } from "@/components/cake/page-state"
import { SessionRow } from "@/components/cake/session-row"
import { Legend } from "@/components/cake/verdict"
import { api, asApiError, useApi } from "@/data/api"
import type { AgentTurns, DateRange, Evidence, SessionSummary, SessionsPage as Page, SessionsQuery, Verdict, WebDimension } from "@/data/types"
import { ALL, ANY_AGENT, VERDICT_FILTERS, choiceQuery, pick, readEvidence, readRange, readTurns } from "@/lib/filters"
import { TAXONOMY, TURNS_ORDER } from "@/lib/taxonomy"
import { sessionCount } from "@/lib/counts"
import { integer } from "@/lib/format"
import { WORDS } from "@/lib/words"
import { RangeFilter } from "@/pages/dashboard"

/** The verdict filter's chips in order, each in its verdict's colours (All is neutral). */
const CHIPS: { value: Verdict | typeof ALL; label: string; variant: "outline" | Verdict }[] = [
  { value: ALL, label: "All", variant: "outline" },
  { value: "agent", label: TAXONOMY.verdicts.agent.label, variant: "agent" },
  { value: "human", label: TAXONOMY.verdicts.human.label, variant: "human" },
  { value: "bot", label: TAXONOMY.verdicts.bot.label, variant: "bot" },
]

type Filters = { filter: Verdict | typeof ALL; turns: AgentTurns | typeof ALL; evidence: Evidence | typeof ALL; agent: string; range: DateRange; path: string | null }
/** The row of a dashboard table the list is narrowed to: its dimension, key (null: the sessions without a value), label. */
type Row = { dimension: WebDimension; key: string | null; label: string }
const DIMENSIONS = Object.keys(WORDS.web.dimensions) as WebDimension[]

function readRow(params: URLSearchParams): Row | null {
  const dimension = params.get("dimension")
  if (!dimension || !DIMENSIONS.includes(dimension as WebDimension)) return null
  return { dimension: dimension as WebDimension, key: params.get("key"), label: params.get("label") ?? params.get("key") ?? WORDS.web.notSet }
}

export function SessionsPage() {
  const [params, setParams] = useSearchParams()
  const filter = pick(params.get("filter"), VERDICT_FILTERS, ALL)
  // the split only narrows Agent sessions and thin evidence Human ones, so each holds while its verdict is picked
  const agentPicked = filter === "agent", humanPicked = filter === "human"
  const filters: Filters = {
    filter, turns: agentPicked ? readTurns(params) : ALL, evidence: humanPicked ? readEvidence(params) : ALL,
    agent: params.get("agent") ?? ANY_AGENT, range: readRange(params), path: params.get("path") || null,
  }
  const row = readRow(params)
  const query: SessionsQuery = {
    verdict: choiceQuery(filters.filter),
    turns: choiceQuery(filters.turns),
    evidence: choiceQuery(filters.evidence),
    agent: filters.agent === ANY_AGENT ? undefined : filters.agent,
    range: filters.range,
    path: filters.path ?? undefined,
    ...(row && { dimension: row.dimension, ...(row.key !== null && { key: row.key }) }),
  }
  const key = JSON.stringify(query)
  // The answer remembers its query, so the rows, "Load more" and its cursor always belong together.
  const first = useApi(async (signal) => ({ key, query, page: await api.sessions(query, signal) }), [key])
  const set = (name: keyof Filters) => (value: string | null) => setParams((p) => {
    if (value === null) p.delete(name)
    else p.set(name, value)
    return p
  })
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={WORDS.sessionsPage} />
      <Loaded state={first} what="sessions">
        {(answer) => <SessionList key={answer.key} query={answer.query} page={answer.page} filters={filters} set={set} clear={() => setParams({})}
          row={row} clearRow={() => setParams((p) => { ["dimension", "key", "label"].forEach((name) => p.delete(name)); return p })} />}
      </Loaded>
    </div>
  )
}

function SessionList({ query, page, filters, set, clear, row, clearRow }: {
  query: SessionsQuery; page: Page; filters: Filters; set: (name: keyof Filters) => (value: string | null) => void; clear: () => void
  row: Row | null; clearRow: () => void
}) {
  const [more, setMore] = useState<SessionSummary[]>([])
  const [next, setNext] = useState(page.next)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { search } = useLocation()
  const rows = [...page.results, ...more]
  const total = page.total // the rows on screen, even while a new filter loads
  const left = total - rows.length
  const loadMore = async (cursor: string) => {
    setLoading(true)
    try {
      const nextPage = await api.sessions({ ...query, cursor })
      setMore((m) => [...m, ...nextPage.results])
      setNext(nextPage.next)
      setError(null)
    } catch (e) {
      setError(asApiError(e).message)
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Card variant="flat" size="sm">
        <CardContent className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={filters.filter} onValueChange={(v) => v && set("filter")(v)} aria-label="Session type" className="flex-wrap">
            {CHIPS.map((c) => <ToggleGroupItem key={c.value} value={c.value} variant={c.variant}>{c.label} <span className="font-mono text-xs">{integer(page.counts[c.value])}</span></ToggleGroupItem>)}
          </ToggleGroup>
          <Separator orientation="vertical" className="h-6 max-md:hidden" />
          <Select value={filters.agent} onValueChange={set("agent")}><SelectTrigger aria-label="Agent"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ANY_AGENT}>All agents</SelectItem>{page.agent_names.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
          <RangeFilter range={filters.range} onRange={set("range")} />
          {row && (
            <span className="inline-flex items-center gap-1">
              <Badge variant="tag">{`${WORDS.web.dimensions[row.dimension]}: ${row.label}`}</Badge>
              <Button variant="link" size="sm" onClick={clearRow}>{WORDS.web.removeFilter}</Button>
            </span>
          )}
          {filters.path && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1">
              <Badge variant="tag" className="h-auto min-h-6 min-w-0 shrink whitespace-normal wrap-anywhere">{WORDS.web.visitedPath(filters.path)}</Badge>
              <Button variant="link" size="sm" aria-label={WORDS.web.removePathFilter} onClick={() => set("path")(null)}>{WORDS.web.removeFilter}</Button>
            </span>
          )}
          {filters.filter === "agent" && (
            <ToggleGroup type="single" variant="outline" size="sm" value={filters.turns} onValueChange={(v) => v && set("turns")(v)} aria-label="Human involvement" className="basis-full flex-wrap">
              <ToggleGroupItem value={ALL}>{WORDS.eitherTurns} <span className="font-mono text-xs">{integer(page.counts.agent)}</span></ToggleGroupItem>
              {TURNS_ORDER.map((t) => (
                <Hint key={t} text={TAXONOMY.turns[t].about}>
                  <ToggleGroupItem value={t}>{TAXONOMY.turns[t].label} <span className="font-mono text-xs">{integer(page.counts[t])}</span></ToggleGroupItem>
                </Hint>
              ))}
            </ToggleGroup>
          )}
          {filters.filter === "human" && (
            <ToggleGroup type="single" variant="outline" size="sm" value={filters.evidence} onValueChange={(v) => v && set("evidence")(v)} aria-label="Evidence" className="basis-full flex-wrap">
              <ToggleGroupItem value={ALL}>{WORDS.allHumanSessions} <span className="font-mono text-xs">{integer(page.counts.human)}</span></ToggleGroupItem>
              <Hint text={TAXONOMY.evidence.thin.about}>
                <ToggleGroupItem value="thin">{TAXONOMY.evidence.thin.label} <span className="font-mono text-xs">{integer(page.counts.thin)}</span></ToggleGroupItem>
              </Hint>
            </ToggleGroup>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{`${sessionCount(total)}, sorted from newest to oldest`}</span><Legend /></div>
      {rows.length ? (
        <div className="flex flex-col gap-3">{rows.map((s) => <SessionRow key={s.id} s={s} listSearch={search} />)}</div>
      ) : (
        <Card variant="sunk"><CardContent className="flex flex-col items-center gap-3 py-6 text-center">
          <Crumb pose="sleep" className="w-32" label={WORDS.crumb.empty} />
          <h3 className="text-lg font-semibold">No sessions match your filters</h3>
          <p className="text-sm text-muted-foreground">{filters.path ? WORDS.web.noPathMatches : "Try selecting a longer date range or clearing the agent filter."}</p>
          <Button variant="outline" size="sm" onClick={clear}>Clear filters</Button>
        </CardContent></Card>
      )}
      {error && <Alert variant="destructive"><AlertDescription>Couldn't load more sessions. {error} Try again.</AlertDescription></Alert>}
      {next && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loading} onClick={() => void loadMore(next)}>{`Load ${left > 0 ? Math.min(page.page_size, left) : page.page_size} more sessions`}</Button>
        </div>
      )}
    </>
  )
}
