import { useId, useState, type FormEvent, type ReactNode } from "react"
import { ListFilter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { FunnelReport, FunnelStep } from "@/data/types"
import { NO_VALUE, integer, percent } from "@/lib/format"
import { WORDS } from "@/lib/words"
import { CardEmpty, InfoTip } from "./bits"
import { VERDICTS } from "./verdict"

const W = WORDS.funnel
const MIN_STEPS = 2
const PATH_PATTERN = "/[^?#]*"
const PATH = new RegExp("^" + PATH_PATTERN + "$")
export const validFunnelSteps = (paths: string[]) => paths.length >= MIN_STEPS && paths.every((path) => PATH.test(path))
const formPaths = (paths: string[]) => [paths[0] ?? "", paths[1] ?? "", ...paths.slice(MIN_STEPS)]

/** Edit a set of steps independently of the report that the page has loaded for the applied steps. */
export function PathFunnel({ steps, onRun, children }: { steps: string[]; onRun: (steps: string[]) => void; children?: ReactNode }) {
  const stepKey = JSON.stringify(steps)
  const [draft, setDraft] = useState(() => ({ key: stepKey, paths: formPaths(steps) }))
  const paths = draft.key === stepKey ? draft.paths : formPaths(steps)
  const update = (next: string[]) => setDraft({ key: stepKey, paths: next })
  const inputId = useId()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const chosen = paths.map((path) => path.trim())
    if (!validFunnelSteps(chosen)) return
    setDraft({ key: JSON.stringify(chosen), paths: chosen })
    onRun(chosen)
  }

  return (
    <section aria-label={W.title}>
      <Card>
        <CardHeader><CardTitle icon={ListFilter}>{W.title}<InfoTip label={W.title} lines={[W.help, W.counts]} /></CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {paths.map((path, index) => {
                const id = inputId + "-" + index
                const number = integer(index + 1)
                return (
                  <div key={id} className="flex min-w-0 items-end gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Label htmlFor={id}>{W.stepPath(number)}</Label>
                      <Input id={id} value={path} required pattern={PATH_PATTERN}
                        onChange={(event) => update(paths.map((value, i) => i === index ? event.target.value : value))} />
                    </div>
                    {paths.length > MIN_STEPS && <Button type="button" variant="ghost" size="sm"
                      aria-label={W.removeStep(number)} onClick={() => update(paths.filter((_, i) => i !== index))}>{W.remove}</Button>}
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => update([...paths, ""])}>{W.add}</Button>
              <Button type="submit" variant="outline" size="sm">{W.run}</Button>
            </div>
          </form>
        </CardContent>
        {children && <CardContent>{children}</CardContent>}
      </Card>
    </section>
  )
}

const total = (step: FunnelStep) => step.agent + step.human
const COHORTS = [
  { label: WORDS.web.all, count: total },
  { label: VERDICTS.agent.label, count: (step: FunnelStep) => step.agent },
  { label: VERDICTS.human.label, count: (step: FunnelStep) => step.human },
]

export function FunnelResults({ report: { steps } }: { report: FunnelReport }) {
  const first = steps[0], last = steps[steps.length - 1]
  if (!first || total(first) === 0) return <CardEmpty text={W.none} />
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="font-semibold">{W.completion(percent(total(last), total(first)) + "%")}</p>
      <Table>
        <TableCaption className="text-left">{W.denominator}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{WORDS.path}</TableHead>
            {COHORTS.map(({ label }) => <TableHead key={label} scope="col" className="text-right">{label} {WORDS.sessions}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((step, index) => (
            <TableRow key={index}>
              <TableHead scope="row" className="min-w-28 font-mono whitespace-normal wrap-anywhere">{step.path}</TableHead>
              {COHORTS.map(({ label, count }) => {
                const reached = count(step), base = count(first)
                const previous = index > 0 ? count(steps[index - 1]) : 0
                return (
                  <TableCell key={label} className="text-right tabular-nums">
                    <strong>{integer(reached)}</strong>
                    {" (" + (base ? percent(reached, base) + "%" : NO_VALUE) + ")"}
                    {previous > 0 && <span className="block text-xs text-muted-foreground">{W.lost(integer(previous - reached))}</span>}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
