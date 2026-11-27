// cake's /api answered from src/data/fixtures/, for the screenshot, visual and dev servers only. The release
// has no fixtures: there cake (Python) answers /api. Same routes, parameters and error bodies as src/data/types.ts:
// the session list filters its sample rows the way cake filters the database (except by date: the samples carry
// formatted times only), POST /api/settings is checked against its schema and kept in memory until the server stops,
// an unknown session or chunk is a 404, and GET /api/register says registered (fixtures/register.json), so the pages
// show at once (the registration card is shot with register/first-run, shots.mjs PAGE_ANSWERS). A session's sample is
// fixtures/session.json or fixtures/session/<id>.json; its replay chunks are fixtures/replay/<id>/<n>.json
// (recorded by scripts/replay-fixtures.mjs), and a tab's of a session of several tabs (…/replay?tab=<id>, one of the
// sample's tabs) fixtures/replay/<tab id>/<n>.json (scripts/tab-sample.mjs).
// fixtureApi({ set: "library" }) answers from fixtures/library/<endpoint>.json first: cake's own answers on the fixed
// test library at a fixed moment (written from the maintainers' recordings), for the pages shot on real data; other endpoints
// fall back to the samples above.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadSchemas, validate } from "./json-schema.mjs"

const data = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "data")
/** The sample set of cake's answers on the fixed test library (written from the maintainers' recordings). */
export const LIBRARY = "library"
const sample = (name) => path.join(data, "fixtures", `${name}.json`)
const read = (name) => JSON.parse(readFileSync(sample(name), "utf8")) // fresh each time: edits show at once
const MAX_BODY_BYTES = 64 * 1024 // a settings change is a few hundred bytes
const SAMPLE_ID = /^[A-Za-z0-9-]+$/ // sample ids name files, so nothing else may reach a path
const CHUNK = /^\d+$/

/** The sample of a session, or null: fixtures/session.json when it is that session, else fixtures/session/<id>.json. */
function sessionSample(id) {
  const main = read("session")
  if (main.session.id === id) return main
  return SAMPLE_ID.test(id) && existsSync(path.join(data, "fixtures", "session", `${id}.json`)) ? read(`session/${id}`) : null
}

/** Chunk n of a sample session's replay, or null. */
function replaySample(id, n) {
  const file = `replay/${id}/${n}`
  return SAMPLE_ID.test(id) && CHUNK.test(n ?? "") && existsSync(path.join(data, "fixtures", `${file}.json`)) ? read(file) : null
}

/** The session list's filters (src/data/types.ts SessionsQuery) and the field of a row each one reads. */
const FILTERS = { verdict: "verdict", turns: "agent_turns", evidence: "evidence" }

/** A connect-style handler: (req, res, next). Answers /api/*; anything else goes to next(). set: a sample set whose
 *  answers come first (LIBRARY), the plain samples otherwise. */
export function fixtureApi({ set } = {}) {
  let settings = null // the sample settings after POSTs; null = as in the file
  const answer = (name) => read(set && existsSync(sample(`${set}/${name}`)) ? `${set}/${name}` : name)
  return async function handle(req, res, next) {
    const url = new URL(req.url, "http://fixtures")
    if (!url.pathname.startsWith("/api/")) return next?.()
    const send = (status, body) => {
      res.statusCode = status
      res.setHeader("content-type", "application/json; charset=utf-8")
      res.end(JSON.stringify(body))
    }
    try {
      const [resource, id, part, ...extra] = url.pathname.slice("/api/".length).split("/").map(decodeURIComponent)
      const route = `${req.method} ${resource}${id === undefined ? "" : "/:id"}${part === undefined ? "" : `/${part}`}${extra.length ? "/…" : ""}`
      switch (route) {
        case "GET overview": return send(200, answer("overview"))
        case "GET web": return send(200, answer("web"))
        case "GET funnel": return send(200, funnelReport(answer("funnel"), url.searchParams.getAll("step")))
        case "GET sessions": return send(200, sessionsPage(answer("sessions"), url.searchParams))
        case "GET session/:id": {
          const detail = sessionSample(id)
          return detail ? send(200, detail) : send(404, { error: "There's no session with this ID. It may have been deleted. Go back to the session list." })
        }
        case "GET session/:id/replay": {
          const detail = sessionSample(id), tab = url.searchParams.get("tab")
          const source = tab === null ? id : detail?.tabs?.some((t) => t.id === tab) ? tab : null
          const chunk = detail && source && replaySample(source, url.searchParams.get("chunk"))
          return chunk ? send(200, chunk) : send(404, { error: "This part of the replay doesn't exist. Reload the page." })
        }
        case "GET settings": return send(200, settings ?? read("settings"))
        case "POST settings": {
          const result = changeSettings(settings ?? read("settings"), await readJson(req))
          if (result.error) return send(400, { error: result.error })
          settings = result.settings
          return send(200, settings)
        }
        case "GET setup": return send(200, answer("setup"))
        case "GET timezones": return send(200, read("timezones"))
        case "GET register": return send(200, answer("register"))
        case "GET health": return send(200, read("health"))
        default: return send(404, { error: `No such address: ${req.method} ${url.pathname}` })
      }
    } catch (error) {
      return send(400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function funnelReport(example, paths) {
  if (paths.length < 2 || paths.some((path) => !path.startsWith("/") || /[?#]/.test(path)))
    throw new Error("Enter two or more page paths that start with / and leave out any query string or fragment.")
  if (paths.length === example.steps.length && paths.every((path, i) => path === example.steps[i].path)) return example
  return { steps: paths.map((path) => ({ path, agent: 0, human: 0 })) }
}

/** The sample list, filtered by verdict, turns, agent and any visited paths available in the sample details. A
 *  cursor asks for the next page, which the sample doesn't have. */
function sessionsPage(page, params) {
  if (params.get("cursor")) return { ...page, results: [], next: null }
  const agent = params.get("agent"), pathname = params.get("path")
  const picked = Object.entries(FILTERS).flatMap(([param, field]) => {
    const value = params.get(param)
    if (!value || (param === "verdict" && value === "all")) return []
    if (!(value in page.counts)) throw new Error(`${param} must be one of ${Object.keys(page.counts).join(", ")}`)
    return [[field, value]]
  })
  const names = (s) => (s.agents ?? [s]).map((a) => a.agent ?? a.name) // a session two agents acted in matches either
  const scoped = pathname ? page.results.filter((s) => s.verdict !== "bot" &&
    sessionSample(s.id)?.pages.some((view) => view.path.split("?")[0] === pathname)) : page.results
  const listed = agent ? scoped.filter((s) => names(s).includes(agent)) : scoped
  const results = listed.filter((s) => picked.every(([field, value]) => s[field] === value))
  if (pathname) {
    const counts = Object.fromEntries(Object.keys(page.counts).map((group) => [group,
      listed.filter((s) => group === "all" || [s.verdict, s.agent_turns, s.evidence].includes(group)).length]))
    const agent_names = [...new Set(scoped.filter((s) => s.verdict === "agent").flatMap(names).filter(Boolean))]
    return { ...page, counts, agent_names, results, total: results.length, next: null }
  }
  // the sample holds one page of a longer list: its counts say how many one filter keeps, the rows how many two keep
  const total = agent || picked.length > 1 ? results.length : picked.length ? page.counts[picked[0][1]] : page.total
  return { ...page, results, total }
}

/** Settings after a POST body, or the error cake would answer. */
function changeSettings(current, update) {
  const schemas = loadSchemas(path.join(data, "schema"))
  const problems = validate(update, schemas.get("settings-update.schema.json"), "settings-update.schema.json", schemas)
  if (problems.length) return { error: `Can't save these settings: ${problems.join("; ")}` }
  if ("retention_days" in update && !current.retention_choices.includes(update.retention_days)) return { error: `retention_days must be one of ${current.retention_choices.join(", ")}` }
  if ("budget_mb" in update && !current.budget_choices_mb.includes(update.budget_mb)) return { error: `budget_mb must be one of ${current.budget_choices_mb.join(", ")}` }
  if (update.timezone && !read("timezones").zones.some((zone) => zone.name === update.timezone)) return { error: `timezone must be an IANA time zone name, such as America/Los_Angeles or UTC, or empty` }
  const site_domain = "site_domain" in update ? update.site_domain.replace(/^https?:\/\//, "").replace(/\/+$/, "") : current.site_domain
  return { settings: { ...current, ...update, site_domain } }
}

function readJson(req) {
  if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) return Promise.reject(new Error("The request must use the application/json content type."))
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) { reject(new Error("The request is too large.")); req.destroy() }
    })
    req.on("end", () => { try { resolve(JSON.parse(body)) } catch { reject(new Error("That request isn't JSON.")) } })
    req.on("error", reject)
  })
}
