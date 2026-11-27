import { useState } from "react"
import { useSearchParams } from "react-router"
import { FunnelResults, PathFunnel, validFunnelSteps } from "@/components/cake/path-funnel"
import { Loaded } from "@/components/cake/page-state"
import { api, useApi } from "@/data/api"
import type { DateRange } from "@/data/types"
import { WORDS } from "@/lib/words"

/** Only applied steps go in the dashboard's URL. Running the same steps again refreshes the report. */
export function DashboardFunnel({ range }: { range: DateRange }) {
  const [params, setParams] = useSearchParams()
  const steps = params.getAll("step")
  const [run, setRun] = useState(0)

  function runFunnel(chosen: string[]) {
    if (steps.length === chosen.length && steps.every((path, index) => path === chosen[index])) {
      setRun((n) => n + 1)
      return
    }
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set("range", range)
      next.delete("step")
      for (const path of chosen) next.append("step", path)
      return next
    })
  }

  return (
    <PathFunnel steps={steps} onRun={runFunnel}>
      {validFunnelSteps(steps) && <ReportRequest key={JSON.stringify([range, steps, run])} range={range} steps={steps} />}
    </PathFunnel>
  )
}

function ReportRequest({ range, steps }: { range: DateRange; steps: string[] }) {
  // The applied query keys this component so a new result starts with the loading state.
  const data = useApi((signal) => api.funnel(range, steps, signal), [])
  return <Loaded state={data} what={WORDS.funnel.loading}>{(report) => <FunnelResults report={report} />}</Loaded>
}
