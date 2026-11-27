// The pages' only way to cake's data: typed GET / POST of the JSON in ./types.ts, and useApi() for what every
// page shows before its data is there (loading) or when it can't get it (failed). Same idea as PostHog 1.0.0's
// frontend/src/Api.js (MIT): one small fetch wrapper that turns the server's error body into an error. No code copied.
import { useEffect, useState, type DependencyList } from "react"
import { PRODUCT_NAME } from "@/lib/product"
import type { SessionDeletion } from "./session-types"
import type { DateRange, FunnelReport, Overview, OverviewQuery, Registration, ReplayChunk, SessionDetail, SessionsPage, SessionsQuery, Settings, SettingsUpdate, Setup, Timezones, WebAnalytics, WebQuery } from "./types"

/** Relative to the page, like the built assets (vite base "./"), so the pages work under any path. */
const BASE = "api/"

/** What a page says when cake doesn't answer at all. */
export const UNREACHABLE = `Can't reach ${PRODUCT_NAME}. Make sure it's running, and then try again.`

/** A request that failed. status 0 = cake could not be reached; message = what to show. */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/** "?a=1&b=2" from the parameters that are set; one set to "" goes as "key=" (a table row's empty key: no referrer). */
function query(params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter((p): p is [string, string] => p[1] !== undefined))
  const s = q.toString()
  return s ? `?${s}` : ""
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(BASE + path, { ...init, headers: { Accept: "application/json", ...init.headers } })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new ApiError(UNREACHABLE, 0)
  }
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ApiError(`${PRODUCT_NAME} returned an unexpected response (HTTP status ${response.status}). Try again.`, response.status)
  }
  if (!response.ok) {
    const said = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : null
    throw new ApiError(said ?? `${PRODUCT_NAME} returned HTTP status ${response.status}. Try again.`, response.status)
  }
  return body as T
}

/** One function per endpoint; web/README.md and ./types.ts describe them. */
export const api = {
  overview: (q: OverviewQuery, signal?: AbortSignal) => request<Overview>("overview" + query(q), { signal }),
  web: (q: WebQuery, signal?: AbortSignal) => request<WebAnalytics>("web" + query(q), { signal }),
  funnel: (range: DateRange, steps: string[], signal?: AbortSignal) => {
    const params = new URLSearchParams({ range })
    for (const path of steps) params.append("step", path)
    return request<FunnelReport>("funnel?" + params.toString(), { signal })
  },
  sessions: (q: SessionsQuery, signal?: AbortSignal) => request<SessionsPage>("sessions" + query(q), { signal }),
  session: (id: string, signal?: AbortSignal) => request<SessionDetail>(`session/${encodeURIComponent(id)}`, { signal }),
  /** tab: one of the session's tabs (SessionTab.id) in a session of more than one; left out for a session of one. */
  replayChunk: (id: string, chunk: number, signal?: AbortSignal, tab?: string) =>
    request<ReplayChunk>(`session/${encodeURIComponent(id)}/replay${query({ chunk: String(chunk), tab })}`, { signal }),
  settings: (signal?: AbortSignal) => request<Settings>("settings", { signal }),
  saveSettings: (update: SettingsUpdate) =>
    request<Settings>("settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) }),
  setup: (signal?: AbortSignal) => request<Setup>("setup", { signal }),
  timezones: (signal?: AbortSignal) => request<Timezones>("timezones", { signal }),
  /** "Delete all data" on the settings page, after its Dialog: every session and its replay (POST /api/delete). */
  deleteEverything: () =>
    request<unknown>("delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }),
  /** Deletes the visit named by the displayed session ID, including every tab and its replay. */
  deleteSession: (id: string) =>
    request<SessionDeletion>("delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessions: [id] }) }),
  registration: (signal?: AbortSignal) => request<Registration>("register", { signal }),
  /** The press of "Register and continue": body is the very text "View registration data" showed (src/lib/registration.ts). */
  register: (body: string) =>
    request<Registration>("register", { method: "POST", headers: { "Content-Type": "application/json" }, body }),
}

type LoadState<T> = { status: "loading" } | { status: "failed"; error: ApiError } | { status: "ready"; data: T }
export type ApiState<T> = LoadState<T> & { retry: () => void }

/** Calls `load` on mount and whenever `deps` change (list what `load` reads, as for useEffect). While new data loads
 *  the old data stays on screen, so a filter change doesn't blank the page; an answer that arrives after a newer
 *  request, or after the page is gone, is dropped. */
export function useApi<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList): ApiState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  // `load` is a new function on every render; `deps` says when it actually asks for something else.
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ status: "ready", data }) },
      (error: unknown) => { if (!controller.signal.aborted) setState({ status: "failed", error: asApiError(error) }) },
    )
    return () => controller.abort()
  }, [...deps, attempt])
  const retry = () => { setState({ status: "loading" }); setAttempt((n) => n + 1) }
  return { ...state, retry }
}

export const asApiError = (error: unknown) =>
  error instanceof ApiError ? error : new ApiError(error instanceof Error ? error.message : String(error), 0)
