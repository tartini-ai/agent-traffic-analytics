// The dashboard's four tables (DESIGN.md §6.1), one component: Paths, and Sources, Devices and Geography as PostHog's
// web analytics shows them. Each is a card whose title is the card's own, as the charts' are; on its right, for a
// breakdown, a Select picks the dimension (Channel, Referring domain, UTM … for Sources), then an All / Agent / Human
// toggle in the session list's verdict colours picks which sessions count. A row shows three numbers, most important
// first: its sessions (bold), visitors (distinct visitor IDs) and page views, of the sessions picked (All: Agent and
// Human together); with All, its Agent sessions' share of them (bold, a number, no bar). Hovering a row shows each
// number split into Agent and Human. Script bots are never counted, as the note under the table says. Rows come by the
// picked sessions, most first, ten, then "Show all N" in place. A path or breakdown value opens the Session replay list of
// its sessions, as PostHog's "View recordings"; a region or a city reads "Country – name", and a country's sessions
// without one "Country – Not set", as PostHog writes them. Country, region and city come from the city database on a
// server: DB-IP's credit sits under the table while it is in use; a server downloads it by itself, so until then the
// table shows the rows it has and no hint. On a narrow screen the table scrolls sideways
// inside its card, never the page. Every title has its icon before it, as every card title does, and the header's
// dropdown and chips are one height. Data comes as props (/api/web, page-side).
import { useState, type ReactNode } from "react"
import { MapPin, MonitorSmartphone, Route, Signpost, type LucideIcon } from "lucide-react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { DateRange, PathRow, Places, WebDimension, WebRow, WebTable } from "@/data/types"
import { LOCALE, NO_VALUE, integer, percent } from "@/lib/format"
import { PRODUCT_NAME } from "@/lib/product"
import { WORDS } from "@/lib/words"
import { CardEmpty, Hint, InfoTip, SourceCredit, TableNote } from "./bits"
import { VERDICTS } from "./verdict"

const W = WORDS.web
const PLACE: WebDimension[] = ["country", "region", "city"]
const regionNames = new Intl.DisplayNames([LOCALE], { type: "region" })
const languageNames = new Intl.DisplayNames([LOCALE], { type: "language" })

type Kind = "all" | "agent" | "human"
/** What a row counts: its Agent and Human sessions, their distinct visitor IDs (all, Agent, Human; null: none has one)
 *  and their page views (all, Agent, Human). */
type Counted = Pick<WebRow, "agent" | "human" | "visitors" | "agent_visitors" | "human_visitors" | "page_views" | "agent_page_views" | "human_page_views">
/** Each table's icon before its title: Paths the session page's Pages visited's (the same pages), Sources a signpost
 *  (where sessions come from), Devices a screen and a phone, Geography a map pin (not the globe of Your website). */
export const TABLE_ICONS = { paths: Route, sources: Signpost, devices: MonitorSmartphone, geography: MapPin } satisfies Record<string, LucideIcon>

/** The sessions a table can count, in the session list's verdict filter colours (All is neutral). */
const KINDS: { value: Kind; label: string; variant: "outline" | "agent" | "human" }[] = [
  { value: "all", label: W.all, variant: "outline" },
  { value: "agent", label: VERDICTS.agent.label, variant: "agent" },
  { value: "human", label: VERDICTS.human.label, variant: "human" },
]

/** A row's sessions, visitors (null: none has a visitor ID) and page views, of one kind (all: Agent and Human). */
export function counted(row: Counted, kind: Kind): [number, number | null, number] {
  if (kind === "agent") return [row.agent, row.agent_visitors, row.agent_page_views]
  if (kind === "human") return [row.human, row.human_visitors, row.human_page_views]
  return [row.agent + row.human, row.visitors, row.page_views]
}

/** What the hover over a row says: each of its numbers, split into Agent and Human. */
function split(row: Counted) {
  const both = (agent: number | null, human: number | null) =>
    [`${agent === null ? NO_VALUE : integer(agent)} ${VERDICTS.agent.label}`, `${human === null ? NO_VALUE : integer(human)} ${VERDICTS.human.label}`] as const
  return [W.split(WORDS.sessionsGroup, ...both(row.agent, row.human)), W.split(WORDS.visitorsGroup, ...both(row.agent_visitors, row.human_visitors)),
    W.split(WORDS.pageViewsGroup, ...both(row.agent_page_views, row.human_page_views))]
}

/** One table (see the file's head): icon before its title; column names its rows, which come most sessions first;
 *  label: what a row's first cell shows, for the kind of sessions picked; controls: what sits before the toggle (a
 *  breakdown's Select); empty: what it says when it has no rows; note: a line under the bots sentence (a data source's
 *  credit). */
export function StatsTable<R extends Counted>({ title, icon, help, column, rows, rowKey, label, shown, controls, empty, note }: {
  title: string; icon: LucideIcon; help: string; column: string; rows: R[]; rowKey: (row: R) => string; label: (row: R, kind: Kind) => ReactNode; shown: number
  controls?: ReactNode; empty: string; note?: ReactNode
}) {
  const [kind, setKind] = useState<Kind>("all")
  const [expanded, setExpanded] = useState<string | null>(null) // the column whose rows show all: another breakdown starts at ten again
  const ofKind = rows.filter((row) => counted(row, kind)[0] > 0).sort((a, b) => counted(b, kind)[0] - counted(a, kind)[0]) // ties keep the API's order
  const all = expanded === column
  const visible = all ? ofKind : ofKind.slice(0, shown)
  const none = kind === "all" || rows.length === 0 ? empty : W.noKind(VERDICTS[kind].label)
  const bots = <TableNote>{W.botsNote}</TableNote>
  return (
    <section aria-label={title}>
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle icon={icon}>{title}<InfoTip label={title} lines={[help, WORDS.about.agentShare]} /></CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {controls}
            <ToggleGroup type="single" value={kind} onValueChange={(value) => value && setKind(value as Kind)} aria-label={`${title}: ${W.kind}`}>
              {KINDS.map((k) => <ToggleGroupItem key={k.value} value={k.value} variant={k.variant}>{k.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? <CardEmpty text={none} /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{column}</TableHead>
                  {[WORDS.sessionsGroup, WORDS.visitorsGroup, WORDS.pageViewsGroup].map((name) => <TableHead key={name} className="text-right">{name}</TableHead>)}
                  {kind === "all" && <TableHead className="text-right">{W.agentShare}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const [sessions, visitors, views] = counted(row, kind)
                  return (
                    <Hint key={rowKey(row)} text={split(row)}>
                      <TableRow>
                        <TableCell className="min-w-32 whitespace-normal wrap-anywhere">{label(row, kind)}</TableCell>
                        <TableCell className="text-right font-bold">{integer(sessions)}</TableCell>
                        <TableCell className="text-right">{visitors === null ? NO_VALUE : integer(visitors)}</TableCell>
                        <TableCell className="text-right">{integer(views)}</TableCell>
                        {kind === "all" && <TableCell className="text-right font-bold">{`${percent(row.agent, row.agent + row.human)}%`}</TableCell>}
                      </TableRow>
                    </Hint>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <CardContent className="flex flex-wrap items-baseline justify-between gap-2">
          {note ? <div className="flex flex-col gap-1">{bots}{note}</div> : bots}
          {ofKind.length > shown && <Button variant="link" size="sm" onClick={() => setExpanded(all ? null : column)}>{all ? W.showFewer : W.showAll(integer(ofKind.length))}</Button>}
        </CardContent>
      </Card>
    </section>
  )
}

/** Paths, as PostHog names its table of pages: the paths Agent and Human sessions viewed most (a session counts once per
 *  path; its page views of it each time it opened). */
export function PathsTable({ paths, shown, range }: { paths: PathRow[]; shown: number; range?: DateRange }) {
  const link = ({ path }: PathRow, kind: Kind) => {
    const query = new URLSearchParams({ path, ...(range && { range }), ...(kind !== "all" && { filter: kind }) })
    return (
      <Button variant="link" size="xs" asChild className="h-auto min-h-8 max-w-full justify-start whitespace-normal text-left">
        <Link to={`/sessions?${query}`} aria-label={W.watchPath(path)}><span className="wrap-anywhere font-mono">{path}</span></Link>
      </Button>
    )
  }
  return <StatsTable title={WORDS.paths} icon={TABLE_ICONS.paths} help={WORDS.about.paths} column={WORDS.path} rows={paths} rowKey={(p) => p.path} label={link}
    shown={shown} empty={WORDS.noSessionsInRange} />
}

function named(names: Intl.DisplayNames, code: string) {
  try {
    return names.of(code) ?? code
  } catch {
    return code // not a code the browser knows: shown as it came
  }
}

/** What a row's value reads as: not set (a country's own, for a region or a city), no referrer, a country's or a
 *  language's name, a place with its country. */
export function rowLabel(dimension: WebDimension, row: WebRow) {
  if (row.value === null) return row.country ? `${named(regionNames, row.country)} – ${W.notSet}` : W.notSet
  if (dimension === "referring_domain" && row.value === "") return W.direct
  if (dimension === "country") return named(regionNames, row.value)
  if (dimension === "language") return named(languageNames, row.value)
  return row.country ? `${named(regionNames, row.country)} – ${row.value}` : row.value
}

/** The Session replay list of a row's sessions (the API's dimension and key; no key: those without a value), of the
 *  kind the table counts when Agent or Human is picked (the list's verdict filter), with what the row reads as, for
 *  the list's filter tag. */
export function rowLink(dimension: WebDimension, row: WebRow, range?: DateRange, kind: Kind = "all") {
  const q = new URLSearchParams({ dimension, ...(row.key !== null && { key: row.key }), label: rowLabel(dimension, row),
                                  ...(range && { range }), ...(kind !== "all" && { filter: kind }) })
  return `/sessions?${q}`
}

/** Sources, Devices or Geography: a Select picks the dimension, initial the one it opens with (Channel, Device type,
 *  Country), else the first. Country, region and city come from the city database on a server (place): on this
 *  computer their table says they need a server; while the database is in use its credit sits under the table. A
 *  server downloads the database by itself, once a month, so until it has one the table shows the rows it has and no
 *  hint (the settings page and doctor say when the last update ran). icon: TABLE_ICONS' for the table. */
export function WebStatsTable({ title, icon, help, table, shown, place, range, initial }: {
  title: string; icon: LucideIcon; help: string; table: WebTable; shown: number; place: Places; range?: DateRange; initial?: WebDimension
}) {
  const [dimension, setDimension] = useState<WebDimension>(initial ?? table[0]?.dimension ?? "channel")
  const rows = table.find((d) => d.dimension === dimension)?.rows ?? []
  const located = PLACE.includes(dimension)
  const empty = !located || dimension === "country" && place.source !== "none" ? WORDS.noSessionsInRange
    : place.source === "none" ? W.serverOnly(PRODUCT_NAME) : W.noPlace
  const note = located && place.attribution ? <SourceCredit credit={place.attribution} /> : undefined
  const controls = (
    <Select value={dimension} onValueChange={(value) => setDimension(value as WebDimension)}>
      <SelectTrigger aria-label={`${title}: ${W.breakdown}`}><SelectValue /></SelectTrigger>
      <SelectContent>{table.map((d) => <SelectItem key={d.dimension} value={d.dimension}>{W.dimensions[d.dimension]}</SelectItem>)}</SelectContent>
    </Select>
  )
  const link = (row: WebRow, kind: Kind) => {
    const text = rowLabel(dimension, row)
    return <Button variant="link" size="xs" asChild><Link to={rowLink(dimension, row, range, kind)} aria-label={W.watch(text)}>{text}</Link></Button>
  }
  // a key of its own for Not set (null) and for No referrer (""), which can be rows of one table
  return <StatsTable title={title} icon={icon} help={help} column={W.dimensions[dimension]} rows={rows} rowKey={(row) => JSON.stringify(row.key)} label={link} shown={shown}
    controls={controls} empty={empty} note={note} />
}
