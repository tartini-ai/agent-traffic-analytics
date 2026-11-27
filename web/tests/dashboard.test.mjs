// The dashboard in Chromium, against the built app and the sample /api/overview, /api/web and /api/setup: under Key metrics the
// Agent block with each agent by name and avatar, Unnamed's the one grey avatar (no split into Agent only and Human +
// agent), and the counts in order of importance (sessions, visitors, page views, active time spent and pages per
// session, each total named by its metric alone); under Deep dive, with no subheadings, Top agents (every agent
// named, however many), Trends and the four tables (their own file), each as wide as the cards above; Reference last
// (three verdicts, Agent's two kinds inside Agent, which visits are counted under it), no Disk section and no coverage
// note but the disk budget's warnings, the top block before the first Agent session, and the dashboard while only the
// demo shop's sessions are listed. The date ranges: Last 24 hours first, Last 7 days by default (an old link's Today
// too), and what the Agent block compares each one with. Usage: node --test tests/
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, test } from "node:test"
import { mbToBytes, minutes } from "../src/lib/format.ts"
import { CLARITY, WORDS } from "../src/lib/words.ts"
import { avatarLooks, openTab, sample, scrolled, startApp, unsureGrey } from "./app.mjs"

const WAIT_MS = 15000
let app
before(async () => { app = await startApp() })
after(() => app?.close())

const overview = sample("overview"), web = sample("web"), setup = sample("setup")
const judging = JSON.parse(readFileSync(new URL("../../agentcake/data/judging.en.json", import.meta.url), "utf8"))
const UNNAMED = judging.names.unnamed.label
const PRODUCT = JSON.parse(readFileSync(new URL("../../agentcake/data/product.json", import.meta.url), "utf8")).name
/** The owner's words (2026-11-15): the dashboard's last part, the session categories, and the agents chart. */
const REFERENCE = "Reference", TOP_AGENTS = "Top agents"
const RECORDED = { ...setup, recorded: { sessions: 9, site: 9, agent: 4 } }
/** Only sessions an earlier AgentCake's demo shop recorded: listed, but the website isn't connected. */
const DEMO_ONLY = { ...setup, recorded: { sessions: 1, site: 0, agent: 0 } }
/** The sample answer with no Agent session in its range. */
const NO_AGENTS = { ...overview, counts: { ...overview.counts, agent: 0, agent_only: 0, human_agent: 0 }, latest_agent: [], agents_seen: [] }

/** setupAnswer: /api/setup's answer, by default one with the website's sessions recorded (with nothing recorded the
 *  dashboard is the onboarding); webAnswer: /api/web's, by default the sample; query: the dashboard's address after
 *  its path ("?range=24h"). */
async function open({ answer, webAnswer, setupAnswer = RECORDED, width, query = "", style } = {}) {
  const tab = await openTab(app, { width, style })
  if (answer) await tab.page.route("**/api/overview**", (route) => route.fulfill({ json: answer }))
  if (webAnswer) await tab.page.route("**/api/web**", (route) => route.fulfill({ json: webAnswer }))
  await tab.page.route("**/api/setup", (route) => route.fulfill({ json: setupAnswer }))
  await tab.page.goto(app.url(`#/dashboard${query}`))
  if (setupAnswer.recorded.sessions > 0) await tab.page.getByRole("region", { name: WORDS.totals }).waitFor({ timeout: WAIT_MS })
  return tab
}

const cardTexts = (locator) => locator.locator('[data-slot="card"]').evaluateAll((cards) => cards.map((card) => card.innerText.replace(/\s+/g, " ").trim()))
const boxes = (locator) => locator.evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }))
/** The texts of the number cards under Key metrics, in order. */
const totals = (page) => cardTexts(page.getByRole("region", { name: WORDS.totals }))

test("the Agent block counts Agent sessions and lists each agent by name, without splitting them into two kinds", async () => {
  const tab = await open()
  try {
    const block = tab.page.locator('[aria-labelledby="spot-title"]')
    const text = (await block.innerText()).replace(/\s+/g, " ")
    assert.ok(text.includes(String(overview.counts.agent)))
    for (const group of ["agent_only", "human_agent"]) assert.ok(!text.includes(judging.turns[group].label), group)
    assert.equal(await block.locator('a[href*="turns="]').count(), 0, "no link to a split")
    const names = (await block.getByRole("list", { name: "Agents by name" }).locator("li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())
    assert.deepEqual(names, overview.agents_seen.map((a) => `${a.sessions} ${a.name ?? UNNAMED}`))
    assert.doesNotMatch(text, /AI in a real browser|Automated browser/, "no kinds of agent")
  } finally { await tab.close() }
})

test("every agent by name has its avatar, Unnamed too: the one grey avatar, Bot's and Unknown's grey, one shape wherever it shows", async () => {
  assert.ok(overview.agents_seen.some((a) => !a.name) && overview.latest_agent.some((s) => !s.agent), "the sample has Unnamed in both places")
  const tab = await open()
  try {
    const grey = await unsureGrey(tab.page)
    const block = tab.page.locator('[aria-labelledby="spot-title"]')
    const listed = tab.page.getByRole("list", { name: "Agents by name" }).locator("li")
    const looks = await Promise.all(overview.agents_seen.map(async (_, i) => avatarLooks(listed.nth(i))))
    assert.ok(looks.every((avatars) => avatars.length === 1), `one avatar before each name: ${JSON.stringify(looks)}`)
    const unnamed = looks[overview.agents_seen.findIndex((a) => !a.name)][0]
    assert.equal(unnamed.fill, grey, "Unnamed's avatar is the grey Bot and Unknown use")
    for (const [i, a] of overview.agents_seen.entries()) if (a.name) assert.notEqual(looks[i][0].fill, grey, `${a.name} is never grey`)
    const latest = block.locator('a[href^="#/sessions/"]')
    const rows = await Promise.all(overview.latest_agent.map(async (s, i) => ({ s, avatars: await avatarLooks(latest.nth(i)) })))
    for (const { s, avatars } of rows) {
      assert.equal(avatars.length, 1, `the latest row of ${s.agent ?? UNNAMED} has one avatar`)
      if (!s.agent) assert.deepEqual(avatars[0], unnamed, "the latest Unnamed row: the same grey avatar")
    }
    const axis = tab.page.locator('[data-slot="card"]').filter({ has: tab.page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${WORDS.agentsChart}$`) }) })
    const tick = axis.locator("foreignObject").getByText(UNNAMED, { exact: true }).locator("xpath=ancestor::*[local-name()='g'][1]")
    assert.deepEqual(await avatarLooks(tick), [unnamed], "Top agents names Unnamed with the same grey avatar")
  } finally { await tab.close() }
})

test("Key metrics counts by importance, four to a row: sessions, visitors, page views, active time and pages per session, in total and by verdict", async () => {
  for (const width of [1280, 485]) {
    const tab = await open({ width })
    try {
      const { counts, page_views: views, pages_per_session: pages } = overview, { verdicts } = judging
      const cards = tab.page.getByRole("region", { name: WORDS.totals }).locator('[data-slot="card"]')
      const texts = await cardTexts(tab.page.getByRole("region", { name: WORDS.totals }))
      const of = (v, unit) => `${verdicts[v].label} ${unit}`
      const kinds = ["agent", "human", "bot"]
      const time = (t) => `${minutes(t.active_ms)} min ${WORDS.outOfTotalTime(minutes(t.total_ms))}`
      assert.deepEqual(texts, [
        `Sessions ${counts.all}`, `${of("agent", "sessions")} ${counts.agent}`,
        `${of("human", "sessions")} ${counts.human} ${counts.thin} ${WORDS.withThinEvidence}`, `${of("bot", "sessions")} ${counts.bot}`,
        `Visitors ${web.visitors.all}`, ...kinds.map((v) => `${of(v, "visitors")} ${web.visitors[v]}`),
        `Page views ${views.all}`, ...kinds.map((v) => `${of(v, "page views")} ${views[v]}`),
        `Active time spent ${time(web.active_time.all)}`, ...kinds.map((v) => `${of(v, "active time spent")} ${time(web.active_time[v])}`),
        `Pages per session ${pages.all.toFixed(1)}`, ...kinds.map((v) => `${of(v, "pages per session")} ${pages[v].toFixed(1)}`),
      ], `at ${width}`)
      assert.equal(views.agent + views.human + views.bot, views.all, "the sample's page views add up")
      const heading = await tab.page.getByRole("heading", { name: WORDS.deepDive, level: 2 }).boundingBox()
      assert.ok((await tab.page.getByRole("region", { name: WORDS.totals }).boundingBox()).y < heading.y, `every number is under Key metrics, before Deep dive, at ${width}`)
      const sizes = await boxes(cards)
      assert.equal(new Set(sizes.map((b) => `${b.w} ${b.h}`)).size, 1, `all 20 cards one size at ${width}: ${JSON.stringify(sizes)}`)
      const lefts = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)))
      const columns = width === 1280 ? 4 : 2
      for (let i = columns; i < lefts.length; i++) assert.equal(lefts[i], lefts[i % columns], `card ${i} lines up with its column at ${width}`)
      const muted = await cards.evaluateAll((els) => els.map((el) => el.classList.contains("opacity-70")))
      assert.deepEqual(muted.map((m, i) => m === (i % 4 === 3)), Array(20).fill(true), "every Bot card is muted")
      assert.ok(!(await tab.page.locator("main").innerText()).includes("Unknown sessions"), "no Unknown number")
      assert.deepEqual(await tab.page.getByRole("heading", { level: 2 }).allInnerTexts(), [WORDS.keyMetrics, WORDS.deepDive, REFERENCE],
        "three parts, one heading level: Key metrics, Deep dive, Reference")
      assert.deepEqual(await tab.page.locator("main").locator("h2, h3").allInnerTexts(), [WORDS.keyMetrics, WORDS.actedForHuman, WORDS.deepDive, REFERENCE],
        "the top block's title under Key metrics; no subheadings under Deep dive: a card's title is the card's own")
    } finally { await tab.close() }
  }
})

/** The sample answers with counts of a thousand or more: the totals add up as the API's do, and Trends' sessions are a
 *  thousand times the sample's, so its axis goes past a thousand too. */
const THOUSANDS = {
  ...overview,
  counts: { all: 12345, human: 7000, agent: 4321, bot: 1024, agent_only: 4000, human_agent: 321, thin: 1500 },
  agent_earlier: 1234,
  agents_seen: [{ name: "Claude in Chrome", sessions: 2500 }, { name: null, sessions: 1821 }],
  page_views: { all: 19000, human: 10000, agent: 8000, bot: 1000 },
}
const TIMES = 1000
const THOUSANDS_WEB = {
  ...web,
  visitors: { all: 4730, agent: 1170, human: 3000, bot: 1001, without: 0 },
  page_views: { all: 19000, agent: 8000, human: 10000, bot: 1000 },
  agents: [{ ...web.agents[0], sessions: 2500, visitors: 1100, page_views: 9000 }],
  trends: { ...web.trends, points: web.trends.points.map((p) => ({ ...p, human: { ...p.human, sessions: p.human.sessions * TIMES },
    agent: { ...p.agent, sessions: p.agent.sessions * TIMES } })) },
}

test("a count of a thousand or more has a comma between thousands on the cards, in the Agent block, on Top agents and on Trends' axis", async () => {
  const tab = await open({ answer: THOUSANDS, webAnswer: THOUSANDS_WEB })
  try {
    const of = (v, unit) => `${judging.verdicts[v].label} ${unit}`
    const texts = await totals(tab.page)
    for (const card of ["Sessions 12,345", `${of("agent", "sessions")} 4,321`, `${of("human", "sessions")} 7,000 1,500 ${WORDS.withThinEvidence}`,
      `${of("bot", "sessions")} 1,024`, "Visitors 4,730", `${of("agent", "visitors")} 1,170`, `${of("human", "visitors")} 3,000`,
      `${of("bot", "visitors")} 1,001`, "Page views 19,000", `${of("agent", "page views")} 8,000`, `${of("human", "page views")} 10,000`,
      `${of("bot", "page views")} 1,000`]) assert.ok(texts.includes(card), `${card} in ${JSON.stringify(texts)}`)
    const spotlight = (await tab.page.locator('[aria-labelledby="spot-title"]').innerText()).replace(/\s+/g, " ")
    for (const shown of ["4,321", "+3,087", "vs. 1,234 prior", "2,500 Claude in Chrome", `1,821 ${UNNAMED}`]) {
      assert.ok(spotlight.includes(shown), `${shown} in the Agent block: ${spotlight}`)
    }
    const chart = (title) => tab.page.locator('[data-slot="card"]').filter({ has: tab.page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${title}$`) }) })
    await chart(TOP_AGENTS).locator(".recharts-label-list text").first().waitFor({ timeout: WAIT_MS })
    assert.deepEqual(await chart(TOP_AGENTS).locator(".recharts-label-list text").allTextContents(), ["2,500"])
    const ticks = chart(WORDS.trends).locator(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value")
    await ticks.first().waitFor({ timeout: WAIT_MS })
    const axis = await ticks.allTextContents()
    assert.ok(axis.some((tick) => /^\d{1,3}(,\d{3})+$/.test(tick)), `Trends' axis passes a thousand: ${axis}`)
    assert.deepEqual(axis.filter((tick) => /\d{4}/.test(tick)), [], "no tick of a thousand or more without its comma")
    assert.deepEqual((await tab.page.locator("main").innerText()).match(/(?<![\d,.])\d{4,}(?![\d,])/g), null,
      "no count of a thousand or more without its comma anywhere on the dashboard")
  } finally { await tab.close() }
})

test("Deep dive's cards come straight under its heading, in order: Top agents, Trends, Paths, Path funnel, Sources, Devices, Geography", async () => {
  const tab = await open()
  try {
    const order = await tab.page.locator("main").evaluate((main) =>
      [...main.querySelectorAll('h2, h3, [data-slot="card-title"]')].map((el) => el.textContent.trim()))
    const deepDive = order.slice(order.indexOf(WORDS.deepDive) + 1, order.indexOf(REFERENCE))
    assert.deepEqual(deepDive, [TOP_AGENTS, WORDS.trends, WORDS.paths, WORDS.funnel.title, ...["sources", "devices", "geography"].map((t) => WORDS.web.titles[t])],
      `no heading between Deep dive and its cards: ${JSON.stringify(order)}`)
  } finally { await tab.close() }
})

test("the Path funnel keeps ordered paths across reloads and applies date range changes", async () => {
  const tab = await open()
  try {
    const { page } = tab
    const funnel = page.getByRole("region", { name: WORDS.funnel.title })
    assert.equal(await funnel.getByRole("table").count(), 0)
    assert.ok(!tab.requests.some((request) => new URL(request).pathname === "/api/funnel"), "wait for defined steps")
    await funnel.getByRole("textbox", { name: "Step 1 path" }).fill("/pricing")
    await funnel.getByRole("textbox", { name: "Step 2 path" }).fill("/signup")
    await funnel.getByRole("textbox", { name: "Step 2 path" }).press("Enter")
    const completion = funnel.getByRole("status").filter({ hasText: "50% completion rate" })
    await completion.waitFor({ timeout: WAIT_MS })
    const rows = funnel.getByRole("row")
    assert.deepEqual(await rows.nth(1).getByRole("cell").allInnerTexts(), ["2 (100%)", "1 (100%)", "1 (100%)"])
    assert.deepEqual(await rows.nth(2).getByRole("cell").allInnerTexts(), ["1 (50%)\n1 dropped off", "1 (100%)\n0 dropped off", "0 (0%)\n1 dropped off"])
    const saved = (url) => new URLSearchParams(new URL(url).hash.split("?")[1]).getAll("step")
    assert.deepEqual(saved(page.url()), ["/pricing", "/signup"])
    await page.reload()
    await completion.waitFor({ timeout: WAIT_MS })
    assert.equal(await funnel.getByRole("textbox", { name: "Step 1 path" }).inputValue(), "/pricing")
    await page.getByRole("combobox", { name: "Date range" }).click()
    const called = page.waitForRequest((request) => {
      const url = new URL(request.url())
      return url.pathname === "/api/funnel" && url.searchParams.get("range") === "24h"
    })
    await page.getByRole("option", { name: "Last 24 hours" }).click()
    assert.deepEqual(new URL((await called).url()).searchParams.getAll("step"), ["/pricing", "/signup"])
    assert.deepEqual(saved(page.url()), ["/pricing", "/signup"])
    await funnel.getByRole("button", { name: "Add step" }).click()
    await funnel.getByRole("textbox", { name: "Step 3 path" }).fill("/docs%20install")
    await funnel.getByRole("button", { name: "Run funnel" }).click()
    await funnel.getByText(WORDS.funnel.none, { exact: true }).waitFor({ timeout: WAIT_MS })
    assert.deepEqual(saved(page.url()), ["/pricing", "/signup", "/docs%20install"])
    await funnel.getByRole("button", { name: "Remove step 3" }).click()
    await funnel.getByRole("button", { name: "Run funnel" }).click()
    await completion.waitFor({ timeout: WAIT_MS })
  } finally { await tab.close() }
})

test("only the total cards say what their metric means, in Clarity's words where Clarity defines it; Visitors in two sentences", async () => {
  const tab = await open()
  try {
    const region = tab.page.getByRole("region", { name: WORDS.totals })
    const helps = await region.getByRole("button", { name: /^About / }).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))
    assert.deepEqual(helps, ["About Sessions", "About Visitors", "About Page views", "About Active time spent", "About Pages per session"])
    for (const [name, lines] of [["About Sessions", CLARITY.sessions], ["About Visitors", [WORDS.about.visitors, WORDS.visitorsAre]],
      ["About Active time spent", CLARITY.activeTime]]) {
      await tab.page.keyboard.press("Escape")
      await region.getByRole("button", { name, exact: true }).focus()  // a tooltip opens on focus, as for a keyboard user
      const tip = tab.page.locator('[data-slot="tooltip-content"]').filter({ hasText: lines[0] })
      await tip.waitFor({ timeout: WAIT_MS })
      assert.deepEqual(await tip.locator("p").allInnerTexts(), lines, name)
    }
    assert.ok(!CLARITY.sessions.join(" ").includes("bot"), "Clarity's sentence on bots is left out: AgentCake counts them")
  } finally { await tab.close() }
})

test("the Agent block and every Deep dive card say what they show behind an information icon", async () => {
  const tab = await open()
  try {
    const main = tab.page.locator("main")
    const names = await main.getByRole("button", { name: /^About / }).evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")))
    for (const name of [`About ${WORDS.agentSessions}`, `About ${WORDS.agentsChart} ${WORDS.chart}`, `About ${WORDS.trends} ${WORDS.chart}`,
      `About ${WORDS.paths}`, `About ${WORDS.funnel.title}`, ...["sources", "devices", "geography"].map((t) => `About ${WORDS.web.titles[t]}`)]) assert.ok(names.includes(name), `${name} in ${JSON.stringify(names)}`)
    const paths = main.getByRole("button", { name: `About ${WORDS.paths}`, exact: true })
    await paths.scrollIntoViewIfNeeded()
    await scrolled(tab.page)
    await paths.focus()
    const tip = tab.page.getByRole("tooltip").filter({ hasText: WORDS.about.paths })
    await tip.waitFor({ timeout: WAIT_MS })
    assert.ok((await tip.innerText()).includes(WORDS.about.agentShare), "the table's tip says what its Agent sessions % column shows")
  } finally { await tab.close() }
})

test("every Deep dive card's title has its icon before it, as Top agents and Trends always had", async () => {
  const tab = await open()
  try {
    const titles = [TOP_AGENTS, WORDS.trends, WORDS.paths, ...["sources", "devices", "geography"].map((t) => WORDS.web.titles[t])]
    const icons = await tab.page.locator('[data-slot="card-title"]').evaluateAll((els, names) => els
      .filter((el) => names.includes(el.textContent.trim()))
      .map((el) => [el.textContent.trim(), el.firstElementChild?.tagName.toLowerCase() === "svg" && el.firstElementChild.getAttribute("aria-hidden") === "true"]), titles)
    assert.deepEqual(icons, titles.map((t) => [t, true]))
  } finally { await tab.close() }
})

test("in Cake, every dropdown is a pill 32 px tall, and the All / Agent / Human chips beside a table's dropdown are too", async () => {
  const tab = await open({ style: "cake" })
  try {
    const shapes = (selector) => tab.page.locator(selector).evaluateAll((els) => els.map((el) => {
      const box = el.getBoundingClientRect()
      return { height: Math.round(box.height), pill: parseFloat(getComputedStyle(el).borderTopLeftRadius) >= box.height / 2 }
    }))
    const dropdowns = await shapes('[data-slot="select-trigger"]')
    assert.equal(dropdowns.length, 6, "the date range, the two charts' metrics and the three tables' breakdowns")
    assert.deepEqual(dropdowns, Array(6).fill({ height: 32, pill: true }))
    const chips = await shapes('section [role="radiogroup"] [role="radio"]')
    assert.equal(chips.length, 12, "All, Agent and Human on each of the four tables")
    assert.deepEqual(chips, Array(12).fill({ height: 32, pill: true }))
  } finally { await tab.close() }
})

test("with only the demo shop's sessions, the dashboard says the website isn't connected, links to the four steps and says whose sessions they are", async () => {
  const tab = await open({ setupAnswer: DEMO_ONLY })
  try {
    const alert = tab.page.getByRole("alert").filter({ hasText: WORDS.notConnectedTitle })
    assert.ok((await alert.innerText()).includes(WORDS.notConnectedDemo))
    const connect = alert.getByRole("link", { name: WORDS.connectWebsite })
    assert.equal(await connect.getAttribute("href"), "#/")
    assert.ok((await totals(tab.page))[0].endsWith(WORDS.allFromDemoShop))
    await connect.click()
    await tab.page.waitForURL(/#\/$/, { timeout: WAIT_MS })
  } finally { await tab.close() }
})

test("once the website has sent a session, the dashboard doesn't say it isn't connected", async () => {
  const tab = await open()
  try {
    assert.equal(await tab.page.getByText(WORDS.notConnectedTitle).count(), 0)
    assert.equal((await totals(tab.page))[0], `Sessions ${overview.counts.all}`)
  } finally { await tab.close() }
})

test("a group with no session in the range shows a dash and says why, not a number", async () => {
  const answer = { ...overview, pages_per_session: { ...overview.pages_per_session, agent: null } }
  const tab = await open({ answer })
  try {
    const texts = await cardTexts(tab.page.getByRole("region", { name: WORDS.totals }))
    assert.equal(texts[17], `${judging.verdicts.agent.label} pages per session — ${WORDS.noSessionsInRange}`)
  } finally { await tab.close() }
})

test("the dashboard has no Disk section and no coverage note; the budget warning shows from warn_at_pct, and why replays stop", async () => {
  const { storage } = overview, budget = mbToBytes(storage.budget_mb)
  let tab = await open()
  try {
    const main = await tab.page.locator("main").innerText()
    assert.equal(await tab.page.getByRole("region", { name: "Disk" }).count(), 0)
    assert.equal(await tab.page.getByRole("progressbar").count(), 0, "no disk bar")
    assert.ok(!/What AgentCake records|Decision method|Disk budget used|will reach the disk budget/.test(main), "no disk numbers, no coverage note")
  } finally { await tab.close() }
  const nearlyFull = Math.ceil((budget * (storage.warn_at_pct + 5)) / 100)
  for (const autoFree of [true, false]) {
    tab = await open({ answer: { ...overview, storage: { ...storage, used_bytes: nearlyFull, auto_free: autoFree } } })
    try {
      const warning = tab.page.getByRole("alert").filter({ hasText: "Disk budget used" })
      assert.match(await warning.innerText(), new RegExp(`Disk budget used: ${storage.warn_at_pct + 5}%\\.`))
      assert.match(await warning.innerText(), autoFree ? new RegExp(`When less than ${100 - storage.free_to_pct}% is left, .+ deletes the oldest replays across all session types\\. Visits and classifications are always kept\\.`) : /new replays aren't stored unless Automatic cleanup is on in Settings/)
    } finally { await tab.close() }
  }
  const disk = { ...storage.disk, free: storage.disk.min_free - 1, low: true }
  tab = await open({ answer: { ...overview, storage: { ...storage, disk, replays_stopped: "disk" } } })
  try {
    assert.match(await tab.page.getByRole("alert").filter({ hasText: "of disk space is free" }).innerText(), /New replays are paused/)
  } finally { await tab.close() }
})

test("with nothing recorded, the dashboard shows how to connect the website, not a separate block", async () => {
  assert.equal(setup.recorded.sessions, 0)
  const tab = await open({ answer: NO_AGENTS, setupAnswer: setup })
  try {
    await tab.page.getByRole("heading", { name: "Connect your website", level: 1 }).waitFor({ timeout: WAIT_MS })
    assert.equal(await tab.page.getByRole("heading", { name: "Dashboard", level: 1 }).count(), 0)
    assert.equal(await tab.page.getByRole("combobox", { name: "Source", exact: true }).count(), 0)
  } finally { await tab.close() }
})

test("before the first Agent session the top block says none came yet, without a task or examples", async () => {
  const tab = await open({ answer: NO_AGENTS, setupAnswer: { ...setup, recorded: { sessions: 3, site: 3, agent: 0 } } })
  try {
    await tab.page.getByText("No agent visits yet").waitFor({ timeout: WAIT_MS })
    assert.ok(await tab.page.getByText("When an AI agent visits your website, its session appears in Agent sessions.").isVisible())
    assert.equal(await tab.page.getByText("Sample data", { exact: true }).count(), 0)
    assert.equal(await tab.page.getByRole("combobox", { name: "Source", exact: true }).count(), 0, "no source filter")
  } finally { await tab.close() }
})

test("with Agent sessions only outside the filters, the top block keeps its numbers", async () => {
  const tab = await open({ answer: NO_AGENTS, setupAnswer: { ...setup, recorded: { sessions: 9, site: 9, agent: 4 } } })
  try {
    await tab.page.getByRole("heading", { name: "Sessions where an AI agent acted on behalf of a human" }).waitFor({ timeout: WAIT_MS })
    assert.equal(await tab.page.getByText("No agent visits yet").count(), 0)
  } finally { await tab.close() }
})

test("each chart takes a whole row, wide and at 485, and says when it has nothing to draw", async () => {
  for (const width of [1280, 485]) {
    const tab = await open({ width })
    try {
      const cards = tab.page.locator('[data-slot="card"]').filter({ has: tab.page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^(${WORDS.trends}|${WORDS.agentsChart})$`) }) })
      const sizes = await cards.evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) } }))
      const paths = await tab.page.getByRole("region", { name: WORDS.paths }).locator('[data-slot="card"]').evaluate((el) => Math.round(el.getBoundingClientRect().width))
      assert.equal(sizes.length, 2)
      assert.ok(sizes[1].y > sizes[0].y && sizes[0].x === sizes[1].x && sizes[0].w === sizes[1].w && sizes[0].w === paths,
        `one under the other, as wide as Paths: ${JSON.stringify(sizes)} ${paths}`)
    } finally { await tab.close() }
  }
  const none = { sessions: 0, visitors: 0, page_views: 0, active_ms: null, pages_per_session: null }
  const noDays = { ...web, agents: [], trends: { ...web.trends, points: web.trends.points.map((p) => ({ key: p.key, label: p.label, human: none, agent: none })) } }
  const tab = await open({ answer: NO_AGENTS, webAnswer: noDays })
  try {
    const main = tab.page.locator("main")
    assert.ok(await main.getByText(WORDS.noAgentSessionsInRange).isVisible())
    assert.ok(await main.getByText(WORDS.noSessionsInRange, { exact: true }).first().isVisible())
    assert.equal(await main.locator(".recharts-surface").count(), 0, "no empty chart drawn")
  } finally { await tab.close() }
})

test("Top agents names every agent, ten too, each in a row of its own; a long name ends with … and shows whole on hover", async () => {
  const names = ["Claude in Chrome", "ChatGPT", "ChatGPT for Chrome", "Cursor in-app browser", "Grok Bot", "Muse", "Manus",
    "Playwright", "Codex in-app browser", "An agent whose name is far too long for two lines on the axis of this chart"]
  const agents = names.map((name, i) => ({ name, sessions: 30 - i, visitors: 30 - i, page_views: 60 - i, active_ms: 60000, pages_per_session: 2 }))
  for (const width of [1280, 485]) {
    const tab = await open({ webAnswer: { ...web, agents }, width })
    try {
      const card = tab.page.locator('[data-slot="card"]').filter({ has: tab.page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${WORDS.agentsChart}$`) }) })
      const ticks = card.locator("foreignObject > div")
      await ticks.first().waitFor({ timeout: WAIT_MS })
      assert.deepEqual(await ticks.evaluateAll((els) => els.map((el) => el.textContent)), names, `every name, in order, at ${width}`)
      for (const name of names) assert.ok(await card.locator("foreignObject").getByText(name, { exact: true }).isVisible(), `${name} at ${width}`)
      const rows = await ticks.evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom } }))
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i].top >= rows[i - 1].bottom, `name ${i + 1} under name ${i}, not over it, at ${width}`)
      const long = card.locator("foreignObject").getByText(names.at(-1), { exact: true })
      assert.ok(await long.evaluate((el) => el.scrollHeight > el.clientHeight), `the long name is cut off at ${width}`)
      await long.hover()
      await tab.page.locator('[data-slot="tooltip-content"]').filter({ hasText: names.at(-1) }).waitFor({ timeout: WAIT_MS })
    } finally { await tab.close() }
  }
})

test("Top agents leaves its bars room on a narrow screen: the names take what they need, the values fit inside the card", async () => {
  for (const width of [1280, 390]) {
    const tab = await open({ width })
    try {
      const card = tab.page.locator('[data-slot="card"]').filter({ has: tab.page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${WORDS.agentsChart}$`) }) })
      await card.locator(".recharts-bar-rectangle path").first().waitFor({ timeout: WAIT_MS })
      const chart = await card.locator('[data-slot="chart"]').evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width } })
      const longestBar = Math.max(...await card.locator(".recharts-bar-rectangle path").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width)))
      assert.ok(longestBar >= chart.width * 0.4, `the longest bar takes ${Math.round(longestBar)} of ${Math.round(chart.width)} px at ${width}`)
      const valueEnds = await card.locator(".recharts-label-list text").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right))
      for (const end of valueEnds) assert.ok(end <= chart.right + 1, `a value ends inside the chart at ${width}`)
      for (const name of web.agents.map((a) => a.name ?? UNNAMED)) assert.ok(await card.locator("foreignObject").getByText(name, { exact: true }).isVisible(), `${name} at ${width}`)
    } finally { await tab.close() }
  }
})

test("Top agents picks its metric as Trends does, and each bar is its agent's number for it, most first, as the cards write it", async () => {
  const by = (...rows) => rows.map(([name, shown]) => [name ?? UNNAMED, shown])
  const expected = {  // the sample's agents (fixtures/web.json), each metric ordering them its own way
    "Sessions": by(["Claude in Chrome", "17"], [null, "9"], ["Muse", "7"], ["ChatGPT", "6"], ["Grok Bot", "5"], ["Codex in-app browser", "3"]),
    "Visitors": by(["Claude in Chrome", "5"], ["ChatGPT", "4"], ["Muse", "3"], [null, "2"], ["Grok Bot", "1"], ["Codex in-app browser", "—"]),
    "Page views": by(["Claude in Chrome", "70"], ["Muse", "42"], ["Codex in-app browser", "36"], ["ChatGPT", "33"], [null, "21"], ["Grok Bot", "12"]),
    "Active time spent": by(["Muse", "4.2 min"], ["Claude in Chrome", "2.4 min"], ["ChatGPT", "1.6 min"], ["Grok Bot", "0.8 min"], [null, "0.5 min"], ["Codex in-app browser", "—"]),
    "Pages per session": by(["Codex in-app browser", "12.0"], ["Muse", "6.0"], ["ChatGPT", "5.5"], ["Claude in Chrome", "4.1"], ["Grok Bot", "2.4"], [null, "2.3"]),
  }
  const tab = await open()
  try {
    const card = tab.page.locator('[data-slot="card"]').filter({ has: tab.page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${WORDS.agentsChart}$`) }) })
    const metric = card.getByRole("combobox", { name: `${WORDS.agentsChart}: ${WORDS.metric}` })
    assert.equal((await metric.innerText()).trim(), "Sessions")
    await metric.click()
    assert.deepEqual(await tab.page.getByRole("option").allInnerTexts(), Object.keys(expected), "the five main metrics, as on Trends")
    await tab.page.keyboard.press("Escape")
    for (const [name, rows] of Object.entries(expected)) {
      if (name !== "Sessions") {
        await metric.click()
        await tab.page.getByRole("option", { name, exact: true }).click()
      }
      await tab.page.waitForFunction(([title, first]) => [...document.querySelectorAll('[data-slot="card"]')]
        .find((c) => c.querySelector('[data-slot="card-title"]')?.textContent === title)?.querySelector("foreignObject > div")?.textContent === first,
      [WORDS.agentsChart, rows[0][0]], { timeout: WAIT_MS })
      const names = await card.locator("foreignObject > div").evaluateAll((els) => els.map((el) => el.textContent))
      const values = await card.locator(".recharts-label-list text").allTextContents()
      assert.deepEqual(names.map((n, i) => [n, values[i]]), rows, name)
      assert.equal(await card.getByRole("button", { name: `About ${name}`, exact: true }).count(), 0,
        `no information icon beside the metric: ${name} is explained on its total card`)
    }
  } finally { await tab.close() }
})

test("every full-width block lines up: the Agent block, the number cards, the two chart cards, Paths and the three tables have the same left, right and width", async () => {
  for (const width of [1280, 485]) {
    const tab = await open({ width })
    try {
      const page = tab.page
      const chartCard = (title) => page.locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${title}$`) }) })
      const blocks = {
        agentBlock: page.locator('[aria-labelledby="spot-title"]'),
        keyMetrics: page.getByRole("region", { name: WORDS.totals }),
        trends: chartCard(WORDS.trends), agentsChart: chartCard(WORDS.agentsChart),
        paths: page.getByRole("region", { name: WORDS.paths }).locator('[data-slot="card"]'),
        funnel: page.getByRole("region", { name: WORDS.funnel.title }).locator('[data-slot="card"]'),
        ...Object.fromEntries(["sources", "devices", "geography"].map((table) =>
          [table, page.getByRole("region", { name: WORDS.web.titles[table], exact: true }).locator('[data-slot="card"]')])),
      }
      const edges = {}
      for (const [name, block] of Object.entries(blocks)) {
        const b = await block.boundingBox()
        edges[name] = { left: b.x, right: b.x + b.width, width: b.width }
      }
      const first = edges.keyMetrics
      for (const [name, e] of Object.entries(edges)) {
        for (const side of ["left", "right", "width"]) assert.ok(Math.abs(e[side] - first[side]) <= 1, `${name}'s ${side} at ${width}: ${JSON.stringify(edges)}`)
      }
      const chart = await chartCard(WORDS.agentsChart).locator('[data-slot="chart"]').boundingBox()
      const trends = await chartCard(WORDS.trends).locator('[data-slot="chart"]').boundingBox()
      assert.ok(Math.abs(chart.width - trends.width) <= 1, `the agents chart is as wide as Trends at ${width}: ${chart.width} ${trends.width}`)
    } finally { await tab.close() }
  }
})

test("Last 24 hours is the first date range and All time the last, which shows no comparison", async () => {
  const tab = await open({ answer: { ...overview, agent_earlier: null } })
  try {
    await tab.page.getByRole("combobox", { name: "Date range" }).click()
    assert.deepEqual(await tab.page.getByRole("option").allInnerTexts(), ["Last 24 hours", "Last 7 days", "Last 30 days", "All time"])
    await tab.page.keyboard.press("Escape")
    assert.equal(await tab.page.locator('[aria-labelledby="spot-title"]').getByText(/prior/).count(), 0, "no 0 shown either")
  } finally { await tab.close() }
  const all = await open({ answer: { ...overview, agent_earlier: null }, query: "?range=all" })
  try {
    assert.equal(await all.page.locator('[aria-labelledby="spot-title"]').getByText(/prior/).count(), 0)
  } finally { await all.close() }
})

test("the Agent block compares every range with its previous period in PostHog's words: the change, and vs. N prior", async () => {
  const delta = overview.counts.agent - overview.agent_earlier
  assert.ok(delta !== 0, "the sample has a change to show")
  for (const query of ["?range=24h", "", "?range=7d", "?range=30d"]) {
    const tab = await open({ query })
    try {
      const block = tab.page.locator('[aria-labelledby="spot-title"]')
      const badge = block.locator('[data-slot="badge"]').filter({ hasText: /^\s*[+−]\d+\s*$/ })
      assert.equal((await badge.innerText()).trim(), `${delta < 0 ? "−" : "+"}${Math.abs(delta)}`, query || "the default range")
      assert.equal(await block.getByText(`vs. ${overview.agent_earlier} prior`, { exact: true }).count(), 1, query || "the default range")
    } finally { await tab.close() }
  }
})

test("a note under Trends names the time zone of its days and hours", async () => {
  for (const zone of [web.time_zone, "UTC+05:45"]) {
    const tab = await open({ webAnswer: { ...web, time_zone: zone } })
    try {
      const card = tab.page.locator('[data-slot="card"]').filter({ has: tab.page.getByText(WORDS.trends, { exact: true }) }).first()
      assert.equal(await card.getByText(`Times in ${zone}`, { exact: true }).count(), 1, zone)
    } finally { await tab.close() }
  }
})

test("an old link to Today opens the default range, Last 7 days, and asks for it", async () => {
  const tab = await open({ query: "?range=today" })
  try {
    assert.equal((await tab.page.getByRole("combobox", { name: "Date range" }).innerText()).trim(), "Last 7 days")
    const asked = tab.requests.map((u) => new URL(u)).filter((u) => ["/api/overview", "/api/web"].includes(u.pathname))
    assert.ok(asked.length >= 2 && asked.every((u) => u.searchParams.get("range") === "7d"), asked.map(String).join(" "))
    assert.ok((await tab.page.locator('[aria-labelledby="spot-title"]').innerText()).includes(`vs. ${overview.agent_earlier} prior`))
  } finally { await tab.close() }
})

test("Reference lists the session categories, the three verdicts with Agent's two kinds inside Agent, and says which visits are counted", async () => {
  const tab = await open({ width: 485 })
  try {
    const table = tab.page.getByLabel(REFERENCE, { exact: true }).locator("table")
    const rows = (await table.locator("tr").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())
    const { verdicts, turns } = judging
    assert.deepEqual(rows, [
      `${verdicts.human.label} ${verdicts.human.about}`, `${verdicts.agent.label} ${verdicts.agent.about}`,
      `${turns.agent_only.label} ${turns.agent_only.about}`, `${turns.human_agent.label} ${turns.human_agent.about}`,
      `${verdicts.bot.label} ${verdicts.bot.about}`,
    ])
    assert.deepEqual(await table.locator('tr[data-inside="agent"]').evaluateAll((els) => els.map((el) => el.dataset.category)), ["agent_only", "human_agent"])
    const badges = await table.locator('[data-slot="badge"]').evaluateAll((els) => els.map((el) => {
      const box = el.getBoundingClientRect(), cell = el.closest("td").getBoundingClientRect(), style = getComputedStyle(el)
      return { left: Math.round(box.left - cell.left), height: Math.round(box.height), border: style.borderStyle, radius: style.borderRadius }
    }))
    const [human, agent, agentOnly, humanAgent, bot] = badges
    assert.equal(new Set([human, agent, bot].map((b) => JSON.stringify(b))).size, 1, `the verdicts: one shape, aligned: ${JSON.stringify(badges)}`)
    assert.ok(agentOnly.left > agent.left && agentOnly.left === humanAgent.left, "Agent's two kinds are indented under it, aligned")
    assert.equal(new Set(badges.map((b) => `${b.height} ${b.border} ${b.radius}`)).size, 1, "one badge shape")
    for (const line of judging.counted.map((l) => l.replaceAll("{name}", PRODUCT))) assert.ok(await tab.page.getByText(line).isVisible(), `which visits are counted, under the table: ${line}`)
    assert.equal(await tab.page.getByText("Each session gets one of these verdicts.").count(), 0)
    const [scroll, client] = await tab.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    assert.ok(scroll <= client, "no horizontal scroll")
  } finally { await tab.close() }
})

test("the dashboard has no list of sessions: the session list is Session replay's", async () => {
  const tab = await open()
  try {
    assert.equal(await tab.page.locator("main").getByText(/Recent session|Latest sessions|See all/).count(), 0)
    assert.equal(await tab.page.locator('main a[href^="#/sessions/"]').count(), 3, "only the top block's latest three Agent sessions")
  } finally { await tab.close() }
})

test("the dashboard's words name visitors Human or Agent and name no other product", async () => {
  const tab = await open()
  try {
    // "user agent" is the HTTP header, not a visitor (DESIGN.md §2; check:ui's rule for the samples)
    assert.doesNotMatch(await tab.page.locator("body").innerText(), /PostHog|\bperson\b|\bpeople\b|\busers?\b(?![ -]agent)/i)
  } finally { await tab.close() }
})
