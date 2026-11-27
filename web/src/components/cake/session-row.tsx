// One session in a list: its verdict, who acted (the agent's name badge with how sure the name is, or Unnamed's tag with
// the one grey avatar, as the session page shows them), an Agent session's split, and its timeline (who acted when, at
// their places in the session). Agent rows are highlighted, bot rows are muted. DESIGN.md §6.1
// A session an earlier AgentCake's demo shop recorded says so with a neutral tag, as the source tag did until 0.4.0.
// The row is a link: the hints inside it (the marker's, the tags') open on hover, and the link keeps the focus.
// A session of more than one tab says how many and draws a line per tab; one that more than one agent acted in names
// each of them.
import { Store } from "lucide-react"
import { Link } from "react-router"
import { Badge } from "@/components/ui/badge"
import type { SessionSummary } from "@/data/types"
import { duration, integer } from "@/lib/format"
import { cn } from "@/lib/utils"
import { WORDS } from "@/lib/words"
import { AgentTag } from "./avatar"
import { Hint, InsideLink } from "./bits"
import { CrumbHead } from "./crumb"
import { MiniTimeline, TabLines, spansOf, timeLabel } from "./timeline"
import { ThinEvidenceTag, TurnsBadge, UnnamedTag, VERDICTS, VerdictBadge, isHighlighted } from "./verdict"

/** The agents a row names: every agent of a session more than one acted in, else its one agent (null: Unnamed). */
const agentsOf = (s: SessionSummary) => s.agents ?? [{ name: s.agent, certainty: s.certainty }]

/** Who acted, as the row names it when no agent's tag does: a bot by its name or as Script bot, else a human. */
function whoActed(s: SessionSummary) {
  if (s.agent) return s.agent
  return s.verdict === "bot" ? VERDICTS.bot.label : WORDS.aHuman
}

/** "Demo shop": the session was recorded in the demo shop, not on the website (its sentence on hover). */
export function DemoShopTag() {
  return <Hint text={WORDS.demoShopAbout} focusable><Badge variant="tag"><Store aria-hidden />{WORDS.demoShop}</Badge></Hint>
}

export function SessionRow({ s, compact = false, listSearch }: { s: SessionSummary; compact?: boolean; listSearch?: string }) {
  const hi = isHighlighted(s.verdict)
  const bot = s.verdict === "bot"
  return (
    <Link
      to={{ pathname: `/sessions/${s.id}`, search: listSearch }}
      data-highlight={hi || undefined}
      className={cn(
        "grid items-center rounded-xl border-2 border-line bg-card text-sm transition-transform minimal:border minimal:hover:bg-muted",
        compact ? "grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-2" : "grid-cols-[7rem_minmax(0,1fr)_minmax(7rem,12rem)_7rem] gap-4 px-4 py-3 shadow-hard-sm hover:-translate-x-px hover:-translate-y-px hover:shadow-hard max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-y-2 minimal:hover:translate-none",
        hi && (compact ? "border-l-6 border-l-agent minimal:border-l-3" : "border-l-8 border-l-agent minimal:border-l-3"),
        bot && "border-border opacity-60 shadow-none hover:opacity-100",
      )}
    >
      <InsideLink>
        <VerdictBadge verdict={s.verdict} className="justify-self-start" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <b className="flex min-w-0 items-center gap-1.5 font-extrabold minimal:font-semibold">
            {hi && <Hint text={WORDS.rowMarker}><CrumbHead className="size-5 shrink-0" label={WORDS.rowMarker} /></Hint>}
            {s.verdict === "agent" ? agentsOf(s).map((a) => (a.name ? <AgentTag key={a.name} name={a.name} certainty={a.certainty} /> : <UnnamedTag key="" />))
              : s.agent && !bot ? <AgentTag name={s.agent} certainty={s.certainty} /> : <span className="truncate">{whoActed(s)}</span>}
            {s.evidence && <ThinEvidenceTag />}
            {compact && s.demo_shop && <DemoShopTag />}
          </b>
          {!compact && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {s.demo_shop && <DemoShopTag />}
              {s.agent_turns && <TurnsBadge turns={s.agent_turns} />}
              {s.tabs && s.tabs.length > 1 && `${WORDS.tabCount(integer(s.tabs.length))} · `}{integer(s.pages)} page{s.pages === 1 ? "" : "s"} · {duration(s.duration_ms)}
            </span>
          )}
        </span>
        <span className={cn(compact ? "col-span-2" : "max-md:col-span-2 max-md:row-start-2")}>
          {bot ? <span className="text-xs text-faint-foreground">{WORDS.botRow}</span>
            : s.tabs ? <TabLines tabs={s.tabs} durationMs={s.duration_ms} />
              : <MiniTimeline spans={s.segments ? spansOf(s.segments, s.duration_ms) : []} label={s.segments ? timeLabel(s.segments) : WORDS.whoUnknown} />}
        </span>
        {!compact && <span className="text-right text-xs text-faint-foreground max-md:row-start-1 max-md:col-start-2">{s.when}</span>}
      </InsideLink>
    </Link>
  )
}
