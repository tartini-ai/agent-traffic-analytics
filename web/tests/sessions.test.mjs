// The session list (Session replay) in Chromium, against the built app and the sample list: the verdict chips are All
// (picked by default), Agent, Human and Bot, each verdict in its badge's colours by one rule; Agent rows stand out and
// bot rows are muted, under Agent the split (Agent only, Human + agent) combines with the agent's name (a link to one
// name shows that agent), the count names one session in the singular, and the agent and date filters reach the API
// (an old link's Today opens the default range, Last 7 days).
// Usage: node --test tests/
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, before, test } from "node:test"
import { WORDS } from "../src/lib/words.ts"
import { avatarLooks, openTab, sample, startApp, unsureGrey } from "./app.mjs"

const judging = JSON.parse(readFileSync(new URL("../../agentcake/data/judging.en.json", import.meta.url), "utf8"))

const WAIT_MS = 15000
let app
before(async () => { app = await startApp() })
after(() => app?.close())

const list = sample("sessions")
const ids = (page) => page.$$eval('a[href^="#/sessions/"]', (rows) => rows.map((row) => row.getAttribute("href").split("?", 1)[0].split("/").pop()))
const rowById = (page, id) => page.locator(`a[href="#/sessions/${id}"], a[href^="#/sessions/${id}?"]`)
const sessionsAsked = (requests) => requests.map((u) => new URL(u)).filter((u) => u.pathname === "/api/sessions").map((u) => Object.fromEntries(u.searchParams))

async function open(query = "", style) {
  const tab = await openTab(app, { style })
  await tab.page.goto(app.url(`#/sessions${query}`))
  await tab.page.waitForSelector('[aria-label="Session type"]', { timeout: WAIT_MS })
  return tab
}

test("the page is Session replay, and the chips are All, picked by default, then Agent, Human and Bot, each with its count", async () => {
  const tab = await open()
  try {
    await tab.page.getByRole("heading", { name: WORDS.sessionsPage, level: 1 }).waitFor({ timeout: WAIT_MS })
    const chips = tab.page.locator('[aria-label="Session type"] > *')
    const { verdicts } = judging
    assert.deepEqual((await chips.allInnerTexts()).map((t) => t.replace(/\s+/g, " ")), [`All ${list.counts.all}`, `${verdicts.agent.label} ${list.counts.agent}`,
      `${verdicts.human.label} ${list.counts.human}`, `${verdicts.bot.label} ${list.counts.bot}`])
    assert.deepEqual(await chips.evaluateAll((els) => els.map((el) => el.dataset.state)), ["on", "off", "off", "off"])
    assert.equal(await tab.page.getByRole("link", { name: WORDS.sessionsPage }).count(), 1, "the top bar names the page the same way")
  } finally { await tab.close() }
})

test("the chips and the count above the list write a thousand or more with a comma between thousands", async () => {
  const counts = { all: 12345, human: 7000, agent: 4321, bot: 1024, agent_only: 4000, human_agent: 321, thin: 1500 }
  const tab = await openTab(app)
  try {
    await tab.page.route("**/api/sessions**", (route) => route.fulfill({ json: { ...list, counts, total: counts.all } }))
    await tab.page.goto(app.url("#/sessions"))
    await tab.page.waitForSelector('[aria-label="Session type"]', { timeout: WAIT_MS })
    const { verdicts } = judging
    assert.deepEqual((await tab.page.locator('[aria-label="Session type"] > *').allInnerTexts()).map((t) => t.replace(/\s+/g, " ")),
      ["All 12,345", `${verdicts.agent.label} 4,321`, `${verdicts.human.label} 7,000`, `${verdicts.bot.label} 1,024`])
    assert.ok((await tab.page.locator("main").innerText()).includes("12,345 sessions, sorted from newest to oldest"))
  } finally { await tab.close() }
})

test("the title has no description under it: the Bot chip and the rows themselves say what the list holds", async () => {
  const tab = await open()
  try {
    const header = tab.page.getByRole("heading", { name: WORDS.sessionsPage, level: 1 }).locator("xpath=..")
    assert.equal(await header.locator("p").count(), 0)
  } finally { await tab.close() }
})

test("in Cake, each verdict chip has its badge's colours, by one rule picked or not; All is neutral", async () => {
  const tab = await open("", "cake")
  try {
    const looks = async () => {
      // found and read in one evaluation: the list mounts again when the picked filter's sessions arrive, and a chip
      // found in one step (evaluateAll) can be gone, its computed colours empty, by the next
      const chips = await tab.page.evaluate(() => [...document.querySelectorAll('[aria-label="Session type"] > *')].map((el) => {
        const style = getComputedStyle(el)
        return { variant: el.dataset.variant, background: style.backgroundColor, color: style.color }
      }))
      // the badge's colours straight from its tokens (a Bot's are unsure's), never through utility classes: the CSS
      // that ships has only the classes the pages use
      const badges = await tab.page.evaluate(() => Object.fromEntries(["human", "agent", "bot"].map((v) => {
        const token = v === "bot" ? "unsure" : v
        const probe = document.createElement("span")
        probe.style.backgroundColor = `var(--${token}-soft)`
        probe.style.color = `var(--${token}-foreground)`
        document.body.append(probe)
        const style = getComputedStyle(probe), out = { background: style.backgroundColor, color: style.color, strong: "" }
        probe.style.backgroundColor = `var(--${token}-foreground)`
        out.strong = getComputedStyle(probe).backgroundColor
        probe.remove()
        return [v, out]
      })))
      return { chips, badges }
    }
    let { chips, badges } = await looks()
    assert.deepEqual(chips.map((c) => c.variant), ["outline", "agent", "human", "bot"])
    for (const chip of chips.slice(1)) assert.deepEqual([chip.background, chip.color], [badges[chip.variant].background, badges[chip.variant].color], chip.variant)
    for (const [index, verdict] of [[1, "agent"], [2, "human"], [3, "bot"]]) {
      await tab.page.locator('[aria-label="Session type"] > *').nth(index).click()
      await tab.page.waitForURL(new RegExp(`filter=${verdict}`))
      // the chip eases into its picked colours: wait for them to settle rather than read them mid-way
      await tab.page.waitForFunction(([i, want]) => getComputedStyle(document.querySelectorAll('[aria-label="Session type"] > *')[i]).backgroundColor === want,
        [index, badges[verdict].strong], { timeout: WAIT_MS })
      ;({ chips } = await looks())
      assert.equal(chips[index].background, badges[verdict].strong, `${verdict} picked: its text colour as the background`)
    }
  } finally { await tab.close() }
})

test("in Cake, the filter bar is one height: its dropdowns are pills as tall as the verdict chips, and the small chips under them are pills", async () => {
  const tab = await open("?filter=agent", "cake")
  try {
    const shapes = (selector) => tab.page.locator(selector).evaluateAll((els) => els.map((el) => {
      const box = el.getBoundingClientRect()
      return { height: Math.round(box.height), pill: parseFloat(getComputedStyle(el).borderTopLeftRadius) >= box.height / 2 }
    }))
    assert.deepEqual(await shapes('[data-slot="select-trigger"]'), Array(2).fill({ height: 32, pill: true }), "the agent and date dropdowns")
    assert.deepEqual(await shapes('[aria-label="Session type"] > *'), Array(4).fill({ height: 32, pill: true }), "All, Agent, Human and Bot")
    assert.ok((await shapes('[aria-label="Human involvement"] > *')).every((chip) => chip.pill), "the small chips are pills too")
  } finally { await tab.close() }
})

test("one session is counted in the singular", async () => {
  const tab = await openTab(app)
  try {
    await tab.page.route("**/api/sessions**", (route) => route.fulfill({ json: { ...list, results: list.results.slice(0, 1), total: 1, next: null } }))
    await tab.page.goto(app.url("#/sessions"))
    await tab.page.getByText("1 session, sorted from newest to oldest", { exact: true }).waitFor({ timeout: WAIT_MS })
  } finally { await tab.close() }
})

test("Agent keeps the Agent rows, every one highlighted", async () => {
  const tab = await open()
  try {
    const chips = tab.page.locator('[aria-label="Session type"] > *')
    await chips.nth(1).click()
    await tab.page.waitForURL(/filter=agent/)
    await tab.page.waitForFunction((n) => document.querySelectorAll('a[href^="#/sessions/"]').length === n, list.results.filter((s) => s.verdict === "agent").length)
    const rows = await tab.page.$$eval('a[href^="#/sessions/"]', (els) => els.map((el) => el.dataset.highlight))
    assert.ok(rows.every((h) => h === "true"), "every Agent row is highlighted")
  } finally { await tab.close() }
})

test("each Agent row's Crumb is named for screen readers and says what it marks in the tooltip on hover, never in an SVG title", async () => {
  const tab = await open("?filter=agent")
  try {
    const agents = list.results.filter((s) => s.verdict === "agent").length
    await tab.page.waitForFunction((n) => document.querySelectorAll('a[href^="#/sessions/"]').length === n, agents)
    const marks = await tab.page.$$eval("a[data-highlight] svg.crumb:not(.avatar)", (els) => els.map((el) => ({
      title: el.querySelector(":scope > title")?.textContent ?? null, ariaLabel: el.getAttribute("aria-label"),
    })))
    assert.deepEqual(marks, Array(agents).fill({ title: null, ariaLabel: WORDS.rowMarker }), "an SVG <title> would open the browser's own box")
    assert.equal(await tab.page.getByRole("img", { name: WORDS.rowMarker }).count(), agents, "screen readers read it as its name")
    await tab.page.locator("a[data-highlight] svg.crumb:not(.avatar)").first().hover()
    await tab.page.locator('[data-slot="tooltip-content"]').filter({ hasText: WORDS.rowMarker }).waitFor({ timeout: WAIT_MS })
  } finally { await tab.close() }
})

test("under Agent, the split and the agent's name combine and reach /api/sessions; no kind of agent", async () => {
  const tab = await open("?filter=agent")
  try {
    assert.equal(await tab.page.locator('[aria-label="Kind of agent"]').count(), 0)
    const asked = tab.page.waitForRequest((r) => {
      const u = new URL(r.url())
      return u.pathname === "/api/sessions" && u.searchParams.get("turns") === "human_agent" && u.searchParams.get("agent") === "Claude in Chrome"
    }, { timeout: WAIT_MS })
    await tab.page.locator('[aria-label="Human involvement"]').getByText(judging.turns.human_agent.label).click()
    await tab.page.waitForURL(/turns=human_agent/)
    await tab.page.getByRole("combobox", { name: "Agent" }).click()
    await tab.page.getByRole("option", { name: "Claude in Chrome" }).click()
    await asked
    const want = list.results.filter((s) => s.agent_turns === "human_agent" && s.agent === "Claude in Chrome").map((s) => s.id)
    await tab.page.waitForFunction((n) => document.querySelectorAll('a[href^="#/sessions/"]').length === n, want.length)
    assert.deepEqual(await ids(tab.page), want)
  } finally { await tab.close() }
})

test("under Human, the thin evidence filter keeps the sessions cake couldn't tell, each marked", async () => {
  const tab = await open("?filter=human")
  try {
    const asked = tab.page.waitForRequest((r) => {
      const u = new URL(r.url())
      return u.pathname === "/api/sessions" && u.searchParams.get("verdict") === "human" && u.searchParams.get("evidence") === "thin"
    }, { timeout: WAIT_MS })
    await tab.page.locator('[aria-label="Evidence"]').getByText(judging.evidence.thin.label).click()
    await tab.page.waitForURL(/evidence=thin/)
    await asked
    const want = list.results.filter((s) => s.verdict === "human" && s.evidence === "thin").map((s) => s.id)
    await tab.page.waitForFunction((n) => document.querySelectorAll('a[href^="#/sessions/"]').length === n, want.length)
    assert.deepEqual(await ids(tab.page), want)
    for (const row of await tab.page.$$('a[href^="#/sessions/"]')) assert.match(await row.innerText(), new RegExp(judging.evidence.thin.label))
  } finally { await tab.close() }
})

test("bot rows are muted and say there is no human behind them", async () => {
  const tab = await open("?filter=bot")
  try {
    const bots = list.results.filter((s) => s.verdict === "bot").map((s) => s.id)
    await tab.page.waitForFunction((n) => document.querySelectorAll('a[href^="#/sessions/"]').length === n, bots.length)
    assert.deepEqual(await ids(tab.page), bots)
    for (const row of await tab.page.$$('a[href^="#/sessions/"]')) {
      assert.match(await row.innerText(), /Script bot sessions are counted but don't show a timeline\./)
      assert.equal(await row.getAttribute("data-highlight"), null)
    }
  } finally { await tab.close() }
})

test("a link to one agent's name shows that agent's sessions, with the Agent filter on", async () => {
  const tab = await open(`?filter=agent&agent=${encodeURIComponent("Muse")}`)
  try {
    assert.equal(await tab.page.locator('[aria-label="Session type"] > *').nth(1).getAttribute("data-state"), "on")
    await tab.page.waitForFunction(() => document.querySelectorAll('a[href^="#/sessions/"]').length === 1)
    assert.deepEqual(await ids(tab.page), list.results.filter((s) => s.agent === "Muse").map((s) => s.id))
  } finally { await tab.close() }
})

test("an unnamed agent's row says Unnamed in its tag with the one grey avatar; a named one gives how sure its name is inside its name's tag", async () => {
  const tab = await open("?filter=agent")
  try {
    const unnamed = list.results.find((s) => s.verdict === "agent" && !s.agent)
    const named = list.results.find((s) => s.verdict === "agent" && s.agent && s.certainty)
    const row = rowById(tab.page, unnamed.id)
    await row.waitFor({ timeout: WAIT_MS })
    const tag = row.locator("[data-slot=badge]").filter({ hasText: new RegExp(`^${judging.names.unnamed.label}$`) })
    const avatars = await avatarLooks(tag)
    assert.equal(avatars.length, 1, "Unnamed's tag holds its avatar, as a named agent's does")
    assert.equal(avatars[0].fill, await unsureGrey(tab.page), "the grey Bot and Unknown use")
    assert.equal(await row.locator("svg.avatar").count(), 1)
    assert.match(await rowById(tab.page, named.id).locator("[data-slot=badge]").filter({ hasText: named.agent }).innerText(),
      new RegExp(`${named.agent}\\s*·\\s*${judging.names[named.certainty].label.toLowerCase()}`))
  } finally { await tab.close() }
})

test("the agent and date filters reach /api/sessions and narrow the rows; there is no source filter", async () => {
  const tab = await open()
  try {
    await tab.page.getByRole("combobox", { name: "Agent" }).click()
    await tab.page.getByRole("option", { name: "Muse" }).click()
    await tab.page.waitForFunction(() => document.querySelectorAll('a[href^="#/sessions/"]').length === 1)
    assert.deepEqual(await ids(tab.page), list.results.filter((s) => s.agent === "Muse").map((s) => s.id))
    // The list already has one row, so wait for the request itself: on a busy machine it can come after the URL changes.
    const askedLastDay = tab.page.waitForRequest((r) => {
      const u = new URL(r.url())
      return u.pathname === "/api/sessions" && u.searchParams.get("agent") === "Muse" && u.searchParams.get("range") === "24h"
    }, { timeout: WAIT_MS })
    await tab.page.getByRole("combobox", { name: "Date range" }).click()
    assert.deepEqual(await tab.page.getByRole("option").allInnerTexts(), ["Last 24 hours", "Last 7 days", "Last 30 days", "All time"])
    await tab.page.getByRole("option", { name: "Last 24 hours" }).click()
    await tab.page.waitForURL(/range=24h/)
    await askedLastDay
    await tab.page.waitForFunction(() => document.querySelectorAll('a[href^="#/sessions/"]').length === 1)
    assert.ok(sessionsAsked(tab.requests).some((q) => q.agent === "Muse" && q.range === "24h"))
    assert.equal(await tab.page.getByRole("combobox", { name: "Source" }).count(), 0)
  } finally { await tab.close() }
})

test("an old link to Today opens the session list on the default range, Last 7 days", async () => {
  const tab = await open("?range=today")
  try {
    assert.equal((await tab.page.getByRole("combobox", { name: "Date range" }).innerText()).trim(), "Last 7 days")
    const asked = sessionsAsked(tab.requests)
    assert.ok(asked.length > 0 && asked.every((q) => q.range === "7d"), JSON.stringify(asked))
  } finally { await tab.close() }
})

test("a table row's empty key (a referring domain without a referrer) reaches /api/sessions as key=, not as no key", async () => {
  const tab = await open(`?${new URLSearchParams({ dimension: "referring_domain", key: "", label: WORDS.web.direct })}`)
  try {
    await tab.page.getByText(`${WORDS.web.dimensions.referring_domain}: ${WORDS.web.direct}`).waitFor({ timeout: WAIT_MS })
    assert.ok(sessionsAsked(tab.requests).some((q) => q.dimension === "referring_domain" && q.key === ""))
  } finally { await tab.close() }
})
