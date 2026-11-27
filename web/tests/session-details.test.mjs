// The dashboard's Trends and four tables under Deep dive in Chromium, against the built app and the sample /api/overview,
// /api/web and /api/setup. Trends: the metric picked in its Select (Sessions first, the five main metrics), one line for
// Human and one for Agent, an interval without sessions counted as 0 but without an average, Clarity's words only where
// Clarity defines the metric, by the hour for Last 24 hours. The four tables, one component (Paths, Sources, Devices,
// Geography): the title in the card, a breakdown's Select and All / Agent / Human; each row's sessions (bold), visitors
// and page views of the sessions picked, most first, and with All the Agent sessions' share (bold); a row's hover splits
// each number into Agent and Human; ten rows, then Show all; a value opens its sessions; only the table scrolls at 485.
// Usage: node --test tests/
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { minutes } from "../src/lib/format.ts"
import { WORDS } from "../src/lib/words.ts"
import { openTab, sample, scrolled, startApp } from "./app.mjs"

const WAIT_MS = 15000
let app
before(async () => { app = await startApp() })
after(() => app?.close())

const web = sample("web"), setup = sample("setup")
const RECORDED = { ...setup, recorded: { sessions: 9, site: 9, agent: 4 } }
/** An interval without sessions, as /api/web gives it. */
const NONE = { sessions: 0, visitors: 0, page_views: 0, active_ms: null, pages_per_session: null }
const TABLES = [WORDS.paths, WORDS.web.titles.sources, WORDS.web.titles.devices, WORDS.web.titles.geography]

async function open({ webAnswer, width } = {}) {
  const tab = await openTab(app, { width })
  if (webAnswer) await tab.page.route("**/api/web**", (route) => route.fulfill({ json: webAnswer }))
  await tab.page.route("**/api/setup", (route) => route.fulfill({ json: RECORDED }))
  await tab.page.goto(app.url("#/dashboard"))
  await tab.page.getByRole("region", { name: WORDS.totals }).waitFor({ timeout: WAIT_MS })
  return tab
}

const trendsCard = (page) => page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${WORDS.trends}$`) }) })
const cellTexts = (rows) => rows.evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((cell) => cell.textContent.trim())))
const table = (page, title) => page.getByRole("region", { name: title, exact: true })
async function pick(page, combobox, option) {
  await combobox.click()
  await page.getByRole("option", { name: option, exact: true }).click()
}
const share = (row) => `${Math.round((100 * row.agent) / (row.agent + row.human))}%`
/** The rows of a kind, most of its sessions first (ties as the API sent them), as the table orders them. */
const ofKind = (rows, sessions) => rows.filter((row) => sessions(row) > 0).sort((a, b) => sessions(b) - sessions(a))

test("Trends opens on Sessions; its Select lists the five main metrics, named as their total cards are; a line each for Human and Agent", async () => {
  const tab = await open()
  try {
    const card = trendsCard(tab.page)
    const metric = card.getByRole("combobox", { name: WORDS.metric })
    assert.equal((await metric.innerText()).trim(), "Sessions")
    await metric.click()
    assert.deepEqual(await tab.page.getByRole("option").allInnerTexts(), ["Sessions", "Visitors", "Page views", "Active time spent", "Pages per session"])
    await tab.page.keyboard.press("Escape")
    assert.equal(await card.locator(".recharts-line-curve").count(), 2, "one line for Human, one for Agent")
    assert.match(await card.innerText(), /Human[\s\S]*Agent/, "a legend")
  } finally { await tab.close() }
})

test("Trends has no information icon beside its metric, which its total card explains; its title's icon says what the chart shows", async () => {
  const tab = await open()
  try {
    const card = trendsCard(tab.page)
    const metric = card.getByRole("combobox", { name: WORDS.metric })
    for (const name of ["Sessions", "Visitors", "Page views", "Active time spent", "Pages per session"]) {
      if (name !== "Sessions") await pick(tab.page, metric, name)
      assert.equal(await card.getByRole("button", { name: `About ${name}`, exact: true }).count(), 0, name)
    }
    const help = card.getByRole("button", { name: `About ${WORDS.trends} ${WORDS.chart}`, exact: true })
    await help.scrollIntoViewIfNeeded() // a scroll closes a tooltip, so the page is still before the focus
    await scrolled(tab.page)
    await help.focus() // a tooltip opens on focus, as for a keyboard user
    await tab.page.getByRole("tooltip").filter({ hasText: WORDS.about.trends[0] }).waitFor({ timeout: WAIT_MS })
  } finally { await tab.close() }
})

test("Trends counts an interval without sessions as 0 but gives it no average; its table says so", async () => {
  const points = web.trends.points.map((p, i) => (i === 1 ? { key: p.key, label: p.label, agent: NONE, human: NONE } : p))
  const [first] = points
  assert.ok(first.human.active_ms && first.agent.active_ms, "the sample's first day has both")
  const tab = await open({ webAnswer: { ...web, trends: { ...web.trends, points } } })
  try {
    const card = trendsCard(tab.page)
    await card.getByRole("button", { name: WORDS.showAsTable }).click()
    const grid = card.locator("table")
    assert.deepEqual((await grid.locator("thead th").allInnerTexts()).map((t) => t.trim()), [WORDS.intervals.day, "Human", "Agent"])
    let rows = await cellTexts(grid.locator("tbody tr"))
    assert.deepEqual(rows[1], [points[1].label, "0", "0"])
    assert.deepEqual(rows[0], [first.label, String(first.human.sessions), String(first.agent.sessions)])
    await pick(tab.page, card.getByRole("combobox", { name: WORDS.metric }), "Active time spent")
    rows = await cellTexts(grid.locator("tbody tr"))
    assert.deepEqual(rows[1], [points[1].label, "—", "—"], "no average, not 0 min")
    assert.deepEqual(rows[0], [first.label, `${minutes(first.human.active_ms)} min`, `${minutes(first.agent.active_ms)} min`])
    await pick(tab.page, card.getByRole("combobox", { name: WORDS.metric }), "Pages per session")
    rows = await cellTexts(grid.locator("tbody tr"))
    assert.deepEqual(rows[0], [first.label, first.human.pages_per_session.toFixed(1), first.agent.pages_per_session.toFixed(1)])
  } finally { await tab.close() }
})

test("Last 24 hours' Trends come by the hour, each with its day", async () => {
  const labels = ["Nov 11, 22:00", "Nov 11, 23:00", "Nov 12, 00:00", "Nov 12, 22:00"]
  const keys = ["2026-11-11 22", "2026-11-11 23", "2026-11-12 00", "2026-11-12 22"]
  const hours = labels.map((label, i) => ({ key: keys[i], label, agent: { ...NONE, sessions: i }, human: { ...NONE, sessions: i + 1 } }))
  const tab = await open({ webAnswer: { ...web, trends: { interval: "hour", every: 3, points: hours } } })
  try {
    const card = trendsCard(tab.page)
    await card.getByRole("button", { name: WORDS.showAsTable }).click()
    assert.equal((await card.locator("thead th").first().innerText()).trim(), WORDS.intervals.hour)
    assert.deepEqual((await cellTexts(card.locator("tbody tr"))).map((row) => row[0]), labels)
  } finally { await tab.close() }
})

test("the four tables are one component: the title in the card, a breakdown's Select, All / Agent / Human; no All pages link", async () => {
  const tab = await open()
  try {
    const opensWith = { [WORDS.paths]: null, [WORDS.web.titles.sources]: "Channel", [WORDS.web.titles.devices]: "Device type", [WORDS.web.titles.geography]: "Country" }
    for (const title of TABLES) {
      const region = table(tab.page, title)
      assert.equal((await region.locator('[data-slot="card-title"]').innerText()).trim(), title, `${title}: the card's own title`)
      assert.deepEqual(await region.getByRole("radio").allInnerTexts(), ["All", "Agent", "Human"], title)
      assert.equal(await region.getByRole("radio", { name: "All" }).getAttribute("aria-checked"), "true", `${title} opens on All`)
      const breakdown = region.getByRole("combobox")
      assert.equal(await breakdown.count(), opensWith[title] ? 1 : 0, title)
      if (opensWith[title]) assert.equal((await breakdown.innerText()).trim(), opensWith[title])
      assert.ok((await region.innerText()).includes(WORDS.web.botsNote), `${title}: bots aren't counted`)
    }
    assert.equal(await tab.page.getByRole("link", { name: "All pages" }).count(), 0)
  } finally { await tab.close() }
})

test("a table shows each row's sessions (bold), visitors and page views of all its sessions, and the Agent sessions' share (bold), most sessions first", async () => {
  for (const width of [1280, 485]) {
    const tab = await open({ width })
    try {
      const region = table(tab.page, WORDS.paths)
      assert.deepEqual((await region.locator("thead th").allInnerTexts()).map((t) => t.trim()), [WORDS.path, "Sessions", "Visitors", "Page views", WORDS.web.agentShare])
      const expected = ofKind(web.paths, (p) => p.agent + p.human).map((p) => [p.path, String(p.agent + p.human), String(p.visitors ?? "—"), String(p.page_views), share(p)])
      assert.deepEqual(await cellTexts(region.locator("tbody tr")), expected, `at ${width}`)
      const weights = await region.locator("tbody tr").first().locator("td").evaluateAll((tds) => tds.map((td) => Number(getComputedStyle(td).fontWeight)))
      assert.ok(weights[1] >= 700 && weights[4] >= 700, `sessions and the share are bold: ${weights}`)
      assert.ok(weights[2] < 700 && weights[3] < 700, `visitors and page views are not: ${weights}`)
      const [scroll, client] = await tab.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      assert.ok(scroll <= client, `the page doesn't scroll sideways at ${width}`)
      if (width === 485) {
        const [inside, box] = await region.locator('[data-slot="table-container"]').evaluate((el) => [el.scrollWidth, el.clientWidth])
        assert.ok(inside > box, "the table scrolls inside its card")
      }
    } finally { await tab.close() }
  }
})

test("Agent or Human counts only those sessions, ordered by them, without the share", async () => {
  const tab = await open()
  try {
    const region = table(tab.page, WORDS.web.titles.sources)
    const rows = web.tables.sources.find((d) => d.dimension === "channel").rows
    for (const [kind, sessions, visitors, views] of [["Agent", "agent", "agent_visitors", "agent_page_views"], ["Human", "human", "human_visitors", "human_page_views"]]) {
      await region.getByRole("radio", { name: kind }).click()
      assert.deepEqual((await region.locator("thead th").allInnerTexts()).map((t) => t.trim()), ["Channel", "Sessions", "Visitors", "Page views"], kind)
      const expected = ofKind(rows, (r) => r[sessions]).map((r) => [r.value, String(r[sessions]), String(r[visitors] ?? "—"), String(r[views])])
      assert.deepEqual(await cellTexts(region.locator("tbody tr")), expected, kind)
    }
  } finally { await tab.close() }
})

test("hovering a row splits each of its numbers into Agent and Human", async () => {
  const tab = await open()
  try {
    const top = ofKind(web.paths, (p) => p.agent + p.human)[0]
    await table(tab.page, WORDS.paths).locator("tbody tr").first().hover()
    const tip = tab.page.getByRole("tooltip").filter({ hasText: "Page views:" })
    await tip.waitFor({ timeout: WAIT_MS })
    const text = (await tip.innerText()).replace(/\s+/g, " ")
    for (const line of [`Sessions: ${top.agent} Agent, ${top.human} Human`, `Visitors: ${top.agent_visitors} Agent, ${top.human_visitors} Human`,
      `Page views: ${top.agent_page_views} Agent, ${top.human_page_views} Human`]) assert.ok(text.includes(line), `${line} in ${text}`)
  } finally { await tab.close() }
})

test("a table writes a count of a thousand or more with a comma between thousands, in its rows and in a row's hover", async () => {
  const top = { ...web.paths[0], agent: 1200, human: 2000, visitors: 2600, agent_visitors: 1000, human_visitors: 1600, page_views: 4700,
    agent_page_views: 1500, human_page_views: 3200 }
  const tab = await open({ webAnswer: { ...web, paths: [top, ...web.paths.slice(1)] } })
  try {
    const first = table(tab.page, WORDS.paths).locator("tbody tr").first()
    await first.waitFor({ timeout: WAIT_MS })
    assert.deepEqual((await first.locator("td").allInnerTexts()).slice(1, 4), ["3,200", "2,600", "4,700"])
    await first.hover()
    const tip = tab.page.getByRole("tooltip").filter({ hasText: "Page views:" })
    await tip.waitFor({ timeout: WAIT_MS })
    const text = (await tip.innerText()).replace(/\s+/g, " ")
    for (const line of ["Sessions: 1,200 Agent, 2,000 Human", "Visitors: 1,000 Agent, 1,600 Human", "Page views: 1,500 Agent, 3,200 Human"]) {
      assert.ok(text.includes(line), `${line} in ${text}`)
    }
  } finally { await tab.close() }
})

test("ten rows, then Show all N opens the rest in place, and Show fewer closes them", async () => {
  const paths = Array.from({ length: 12 }, (_, i) => ({ path: `/p${i}`, agent: 12 - i, human: i, visitors: 12, agent_visitors: 6, human_visitors: 6,
    page_views: 20, agent_page_views: 10, human_page_views: 10 }))
  const tab = await open({ webAnswer: { ...web, paths, shown: 10 } })
  try {
    const region = table(tab.page, WORDS.paths)
    assert.equal(await region.locator("tbody tr").count(), 10)
    await region.getByRole("button", { name: WORDS.web.showAll(12) }).click()
    assert.equal(await region.locator("tbody tr").count(), 12)
    await region.getByRole("button", { name: WORDS.web.showFewer }).click()
    assert.equal(await region.locator("tbody tr").count(), 10)
  } finally { await tab.close() }
})

test("a Paths link opens only matching sessions and keeps the date, verdict and removable path after reload", async () => {
  const path = "/demo/checkout"
  const row = { ...web.paths[0], path, agent: 3, human: 1 }
  const tab = await open({ webAnswer: { ...web, paths: [row] } })
  try {
    await pick(tab.page, tab.page.getByRole("combobox", { name: "Date range" }), "Last 30 days")
    const region = table(tab.page, WORDS.paths)
    const link = region.getByRole("link", { name: WORDS.web.watchPath(path) })
    for (const [label, filter] of [["Human", "human"], ["All", null], ["Agent", "agent"]]) {
      await region.getByRole("radio", { name: label }).click()
      const query = new URLSearchParams((await link.getAttribute("href")).split("?")[1])
      assert.deepEqual([query.get("path"), query.get("range"), query.get("filter")], [path, "30d", filter])
    }
    const filtered = () => tab.page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === "/api/sessions" && url.searchParams.get("path") === path &&
        url.searchParams.get("range") === "30d" && url.searchParams.get("verdict") === "agent"
    }, { timeout: WAIT_MS })
    const requested = filtered()
    await link.press("Enter")
    assert.ok((await requested).ok())
    const chip = tab.page.getByText(WORDS.web.visitedPath(path), { exact: true })
    const summary = tab.page.getByText("3 sessions, sorted from newest to oldest", { exact: true })
    await chip.waitFor({ timeout: WAIT_MS })
    await summary.waitFor({ timeout: WAIT_MS })
    assert.deepEqual(await tab.page.locator('a[href^="#/sessions/"]').evaluateAll((links) =>
      links.map((item) => item.getAttribute("href").split("?")[0])), ["#/sessions/7f3a-c1", "#/sessions/6e0f-13", "#/sessions/4c2d-71"])
    const reload = filtered()
    await tab.page.reload()
    assert.ok((await reload).ok())
    await chip.waitFor({ timeout: WAIT_MS })
    await summary.waitFor({ timeout: WAIT_MS })
    await tab.page.getByRole("button", { name: WORDS.web.removePathFilter }).click()
    await chip.waitFor({ state: "detached", timeout: WAIT_MS })
    const query = new URLSearchParams(new URL(tab.page.url()).hash.split("?")[1])
    assert.deepEqual(Object.fromEntries(query), { range: "30d", filter: "agent" })
  } finally { await tab.close() }
})

test("a percent-encoded path survives navigation at phone width", async () => {
  const path = `/demo/${"long-path".repeat(12)}%2Fdetails`
  const tab = await open({ width: 485, webAnswer: { ...web, paths: [{ ...web.paths[0], path }] } })
  try {
    const link = table(tab.page, WORDS.paths).getByRole("link", { name: WORDS.web.watchPath(path) })
    const result = tab.page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === "/api/sessions" && url.searchParams.get("path") === path
    }, { timeout: WAIT_MS })
    await link.press("Enter")
    assert.ok((await result).ok())
    await tab.page.getByText(WORDS.web.visitedPath(path), { exact: true }).waitFor({ timeout: WAIT_MS })
    const [scroll, width] = await tab.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    assert.ok(scroll <= width, "the path filter fits at phone width")
  } finally { await tab.close() }
})

test("a value opens Session replay narrowed to its sessions; a region reads Country – name, a country's own Not set Country – Not set; DB-IP's credit sits under the places", async () => {
  const tab = await open()
  try {
    const sources = table(tab.page, WORDS.web.titles.sources)
    const top = ofKind(web.tables.sources.find((d) => d.dimension === "channel").rows, (r) => r.agent + r.human)[0]
    const href = await sources.getByRole("link", { name: WORDS.web.watch(top.value) }).getAttribute("href")
    const query = new URLSearchParams(href.split("?")[1])
    assert.deepEqual([query.get("dimension"), query.get("key"), query.get("label")], ["channel", top.key, top.value])
    const geography = table(tab.page, WORDS.web.titles.geography)
    const credit = geography.getByRole("link", { name: web.place.attribution.text })
    assert.equal(await credit.getAttribute("href"), web.place.attribution.url, "the credit DB-IP asks for, under Country")
    await pick(tab.page, geography.getByRole("combobox"), WORDS.web.dimensions.region)
    const named = (code) => new Intl.DisplayNames(["en"], { type: "region" }).of(code)
    const rows = ofKind(web.tables.geography.find((d) => d.dimension === "region").rows, (r) => r.agent + r.human)
    assert.equal((await geography.locator("tbody tr").first().locator("td").first().innerText()).trim(), `${named(rows[0].country)} – ${rows[0].value}`)
    const unset = rows.find((r) => r.value === null)
    const label = `${named(unset.country)} – ${WORDS.web.notSet}`
    const link = new URLSearchParams((await geography.getByRole("link", { name: WORDS.web.watch(label) }).getAttribute("href")).split("?")[1])
    assert.deepEqual([link.get("dimension"), link.get("key"), link.get("label")], ["region", unset.key, label], "a country's own Not set opens its sessions")
    assert.equal(await credit.count(), 1, "and under Region")
  } finally { await tab.close() }
})

test("on this computer the places say they need a server; on a server without the city database the table shows the rows it has, with no hint, no command and no credit", async () => {
  const empty = web.tables.geography.map((d) => (["country", "region", "city"].includes(d.dimension) ? { ...d, rows: [] } : d))
  const local = await open({ webAnswer: { ...web, place: { ...web.place, source: "none", attribution: null }, tables: { ...web.tables, geography: empty } } })
  try {
    const geography = table(local.page, WORDS.web.titles.geography)
    assert.match(await geography.innerText(), /Country, region, and city data is available only when .+ runs on a server\./)
    assert.equal(await geography.getByRole("alert").count(), 0)
  } finally { await local.close() }
  // AgentCake downloads the city database by itself, monthly (the settings page and doctor say how and when): the card
  // names no command while it is missing
  const noRegion = web.tables.geography.map((d) => (d.dimension === "region" ? { ...d, rows: [] } : d))
  const missing = await open({ webAnswer: { ...web, place: { ...web.place, source: "missing", attribution: null }, tables: { ...web.tables, geography: noRegion } } })
  try {
    const geography = table(missing.page, WORDS.web.titles.geography)
    for (const dimension of [WORDS.web.dimensions.country, WORDS.web.dimensions.region]) {
      if (dimension !== WORDS.web.dimensions.country) await pick(missing.page, geography.getByRole("combobox"), dimension)
      assert.equal(await geography.locator("tbody tr").count() > 0, dimension === WORDS.web.dimensions.country, `${dimension}: rows, or none`)
      assert.ok(!(await geography.innerText()).includes(web.place.update_command), `${dimension}: no command`)
      assert.equal(await geography.locator("code").count(), 0, `${dimension}: nothing set as code`)
      assert.equal(await geography.locator("p", { hasText: WORDS.web.botsNote }).count(), 1, `${dimension}: the Script bot sentence stays`)
      assert.equal(await geography.getByRole("alert").count(), 0, `${dimension}: no alert`)
      assert.equal(await geography.locator("pre").count(), 0, `${dimension}: no command block`)
      assert.equal(await geography.getByRole("button", { name: "Copy" }).count(), 0, `${dimension}: no Copy button`)
    }
    assert.equal(await geography.getByRole("link", { name: web.place.attribution.text }).count(), 0, "no credit without its data")
  } finally { await missing.close() }
})

test("with Agent or Human picked, a value opens Session replay narrowed to that kind of its sessions too", async () => {
  const tab = await open()
  try {
    const sources = table(tab.page, WORDS.web.titles.sources)
    const rows = web.tables.sources.find((d) => d.dimension === "channel").rows
    for (const [kind, filter, sessions] of [["Agent", "agent", "agent"], ["Human", "human", "human"], ["All", null, null]]) {
      await sources.getByRole("radio", { name: kind }).click()
      const top = ofKind(rows, (r) => (sessions ? r[sessions] : r.agent + r.human))[0]
      const href = await sources.getByRole("link", { name: WORDS.web.watch(top.value) }).getAttribute("href")
      assert.equal(new URLSearchParams(href.split("?")[1]).get("filter"), filter, kind)
    }
  } finally { await tab.close() }
})

test("a breakdown's Not set and No referrer rows are two rows of their own", async () => {
  const row = { country: null, agent: 1, human: 1, visitors: 2, agent_visitors: 1, human_visitors: 1, page_views: 2, agent_page_views: 1, human_page_views: 1 }
  const sources = web.tables.sources.map((d) => (d.dimension === "referring_domain"
    ? { ...d, rows: [{ ...row, key: null, value: null }, { ...row, key: "", value: "" }] } : d))
  const tab = await open({ webAnswer: { ...web, tables: { ...web.tables, sources } } })
  const warnings = []
  tab.page.on("console", (message) => { if (/same key/i.test(message.text())) warnings.push(message.text()) })
  try {
    const region = table(tab.page, WORDS.web.titles.sources)
    await pick(tab.page, region.getByRole("combobox", { name: `${WORDS.web.titles.sources}: ${WORDS.web.breakdown}` }), WORDS.web.dimensions.referring_domain)
    assert.deepEqual((await cellTexts(region.locator("tbody tr"))).map((cells) => cells[0]).sort(), [WORDS.web.direct, WORDS.web.notSet].sort())
    assert.deepEqual(warnings, [], "each row has a React key of its own")
  } finally { await tab.close() }
})

/** n points from `first` (ms), a step apart, keyed and labelled as /api/web gives them (hours: "Nov 15, 07:00"; days:
 *  "Nov 15", with the year when they cross a new year). */
function trendPoints(n, first, hourly) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const pad = (v) => String(v).padStart(2, "0")
  const times = Array.from({ length: n }, (_, i) => new Date(first + i * (hourly ? 3_600_000 : 86_400_000)))
  const years = new Set(times.map((t) => t.getUTCFullYear())).size > 1
  return times.map((t, i) => {
    const day = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, name = `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`
    return { key: hourly ? `${day} ${pad(t.getUTCHours())}` : day,
      label: hourly ? `${name}, ${pad(t.getUTCHours())}:00` : `${name}${years ? `, ${t.getUTCFullYear()}` : ""}`,
      agent: { ...NONE, sessions: i % 5 }, human: { ...NONE, sessions: (i * 7) % 11 } }
  })
}

/** The time axis's labels as drawn, left to right: their texts and boxes. */
const axisLabels = (card) => card.locator(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value").evaluateAll((els) => els
  .map((el) => { const box = el.getBoundingClientRect(); return { text: el.textContent.trim(), left: box.left, right: box.right } })
  .sort((a, b) => a.left - b.left))

test("the time axis names every third hour, every day, every third day or each month, doubling the step where they'd touch", async () => {
  const hours = trendPoints(25, Date.UTC(2026, 10, 15, 7), true), week = trendPoints(8, Date.UTC(2026, 10, 9))
  const month = trendPoints(31, Date.UTC(2026, 9, 17)), all = trendPoints(32, Date.UTC(2026, 9, 16))
  const pick = (points, step) => points.filter((_, i) => i % step === 0).map((p) => p.label)
  const cases = [
    // at 485 five labels such as "Nov 15, 07:00" (about 77 px each) need more than the plot's width: every 12 hours
    ["Last 24 hours", { interval: "hour", every: 3, points: hours }, pick(hours, 3), pick(hours, 12)],
    ["Last 7 days", { interval: "day", every: 1, points: week }, pick(week, 1), pick(week, 1)],
    ["Last 30 days", { interval: "day", every: 3, points: month }, pick(month, 3), pick(month, 6)],
    ["All time", { interval: "day", every: "month", points: all }, ["Oct 2026", "Nov 2026"], ["Oct 2026", "Nov 2026"]],
    ["the same days as Last 30 days", { interval: "day", every: 3, points: all }, pick(all, 3), pick(all, 6)],
  ]
  for (const [width, at] of [[1280, 2], [485, 3]]) {
    const tab = await open({ width, webAnswer: { ...web, trends: { interval: "day", every: 1, points: week } } })
    try {
      for (const c of cases) {
        await tab.page.route("**/api/web**", (route) => route.fulfill({ json: { ...web, trends: c[1] } }))
        await tab.page.reload()
        const card = trendsCard(tab.page)
        await card.scrollIntoViewIfNeeded()
        await card.locator(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value").first().waitFor({ timeout: WAIT_MS })
        const labels = await axisLabels(card)
        assert.deepEqual(labels.map((l) => l.text), c[at], `${c[0]} at ${width}`)
        const chart = await card.locator('[data-slot="chart"]').boundingBox()
        assert.ok(labels.at(-1).right <= chart.x + chart.width, `${c[0]} at ${width}: ${labels.at(-1).text} is cut off at the right`)
        for (let i = 1; i < labels.length; i += 1) assert.ok(labels[i].left > labels[i - 1].right, `${c[0]} at ${width}: ${labels[i - 1].text} and ${labels[i].text} touch`)
      }
    } finally { await tab.close() }
  }
})

test("All time over 400 days names months, or quarters on a narrow screen, and the hover still names each day", async () => {
  const points = trendPoints(400, Date.UTC(2025, 9, 14))
  for (const [width, names] of [[1280, ["Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026",
    "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026"]], [485, ["Oct 2025", "Jan 2026", "Apr 2026", "Jul 2026", "Oct 2026"]]]) {
    const tab = await open({ width, webAnswer: { ...web, trends: { interval: "day", every: "month", points } } })
    try {
      const card = trendsCard(tab.page)
      await card.scrollIntoViewIfNeeded()
      await card.locator(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value").first().waitFor({ timeout: WAIT_MS })
      assert.deepEqual((await axisLabels(card)).map((l) => l.text), names, `${width}`)
      const surface = await card.locator(".recharts-surface").first().boundingBox()
      for (const share of [0.25, 0.5, 0.75]) {
        await tab.page.mouse.move(surface.x + surface.width * share, surface.y + surface.height / 2)
        const box = card.locator(".recharts-tooltip-wrapper > div").first()
        await box.waitFor({ state: "visible", timeout: WAIT_MS })
        const [label, ...said] = (await box.innerText()).split("\n").map((t) => t.trim()).filter(Boolean)
        const day = points.find((p) => p.label === label)
        assert.ok(day, `${width}: the hover names one day: ${label}`)
        assert.ok(said.includes(String(day.human.sessions)) && said.includes(String(day.agent.sessions)), `${width}: ${label}'s numbers: ${said}`)
      }
    } finally { await tab.close() }
  }
})

test("Trends' hover writes each value as its table does: active time in minutes, pages per session with one decimal", async () => {
  const tab = await open()
  try {
    const card = trendsCard(tab.page)
    await card.getByRole("button", { name: WORDS.showAsTable }).click()
    for (const name of ["Active time spent", "Pages per session"]) {
      await pick(tab.page, card.getByRole("combobox", { name: WORDS.metric }), name)
      const surface = await card.locator(".recharts-surface").first().boundingBox()
      await tab.page.mouse.move(surface.x + surface.width / 2, surface.y + surface.height / 2)
      const box = card.locator(".recharts-tooltip-wrapper > div").first()
      await box.waitFor({ state: "visible", timeout: WAIT_MS })
      const [interval, ...said] = (await box.innerText()).split("\n").map((t) => t.trim()).filter(Boolean)
      const row = (await cellTexts(card.locator("table tbody tr"))).find((cells) => cells[0] === interval)
      const values = said.filter((t) => !["Human", "Agent"].includes(t))
      assert.ok(row && values.length, `${name}: the hovered interval ${interval} and its values ${said}`)
      for (const value of values) assert.ok(row.slice(1).includes(value), `${name}: ${value} as the table writes it (${row.slice(1)})`)
      await tab.page.mouse.move(0, 0)
    }
  } finally { await tab.close() }
})
