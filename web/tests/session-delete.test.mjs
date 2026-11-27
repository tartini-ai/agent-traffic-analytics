import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { WORDS } from "../src/lib/words.ts"
import { openTab, sample, startApp } from "./app.mjs"

const W = WORDS.deleteSession
const detail = sample("session")
const tabbed = sample("session/4c2d-71")
const list = sample("sessions")
const clean = { error: null, log_cleared: true }
const deleted = { sessions: [{ found: true }], database: clean, backups: [], log_lines: 0 }
const listHash = "#/sessions?range=7d&filter=agent"
const sessionHash = (id) => "#/sessions/" + id
const deleteButton = (page) => page.getByRole("button", { name: W.action, exact: true })
let app
before(async () => { app = await startApp() })
after(() => app?.close())

async function confirm(page) {
  await deleteButton(page).click()
  const dialog = page.getByRole("dialog", { name: W.title })
  await dialog.waitFor()
  return dialog
}

test("Cancel and Escape leave the session and its replay available without a delete request", async () => {
  const tab = await openTab(app)
  try {
    const { page } = tab
    await page.goto(app.url(sessionHash(detail.session.id)))
    await page.locator('[data-replay="ready"]').waitFor()
    const dialog = await confirm(page)
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await dialog.waitFor({ state: "hidden" })
    await confirm(page)
    await page.keyboard.press("Escape")
    await dialog.waitFor({ state: "hidden" })
    assert.equal(await page.locator('[data-replay="ready"]').count(), 1)
    assert.equal(tab.requests.filter((url) => url.endsWith("/api/delete")).length, 0)
  } finally { await tab.close() }
})

test("Deleting once waits for the server and reloads the filtered list and its totals", async () => {
  const tab = await openTab(app)
  const pending = Promise.withResolvers()
  try {
    const { page } = tab
    const kept = list.results.filter((s) => s.id !== detail.session.id && s.verdict === "agent").slice(0, 2)
    let results = [detail.session, ...kept]
    const posts = [], queries = []
    await page.route("**/api/sessions**", (route) => {
      queries.push(new URL(route.request().url()).search)
      const total = results.length
      return route.fulfill({ json: { ...list, results, next: null, total, counts: { ...list.counts, all: total, agent: total } } })
    })
    await page.route("**/api/delete", async (route) => {
      posts.push([route.request().method(), route.request().postDataJSON()])
      await pending.promise
      results = kept
      return route.fulfill({ json: deleted })
    })
    await page.goto(app.url(listHash))
    await page.getByText("3 sessions, sorted from newest to oldest", { exact: true }).waitFor()
    const detailHash = sessionHash(detail.session.id) + "?range=7d&filter=agent"
    await page.locator(`a[href="${detailHash}"]`).click()
    assert.equal(await page.locator(`a[href="${listHash}"]`).count(), 1, "the back link restores the filters as well")
    const dialog = await confirm(page)
    await deleteButton(dialog).click()
    const busy = dialog.getByRole("button", { name: W.pending })
    await busy.waitFor()
    assert.equal(await busy.isDisabled(), true)
    await busy.dispatchEvent("click")
    await page.keyboard.press("Escape")
    assert.equal(await dialog.isVisible(), true)
    assert.equal(queries.length, 1, "the list waits for confirmed success")
    pending.resolve()
    await page.getByText("2 sessions, sorted from newest to oldest", { exact: true }).waitFor()
    assert.ok(page.url().endsWith(listHash))
    assert.deepEqual(posts, [["POST", { sessions: [detail.session.id] }]])
    assert.equal(queries.length, 2)
    for (const query of queries) {
      assert.equal(new URLSearchParams(query).get("verdict"), "agent")
      assert.equal(new URLSearchParams(query).get("range"), "7d")
    }
    assert.equal(await page.locator(`a[href="${detailHash}"]`).count(), 0)
  } finally { pending.resolve(); await tab.close() }
})

test("A tab's older link confirms the whole visit and posts the canonical session ID", async () => {
  const tab = await openTab(app)
  try {
    const { page } = tab
    const oldId = tabbed.tabs[1].id
    await page.route("**/api/session/" + oldId, (route) => route.fulfill({ json: { ...tabbed, named_tab: oldId } }))
    await page.route("**/api/delete", (route) => route.fulfill({ json: deleted }))
    await page.goto(app.url(sessionHash(oldId)))
    const dialog = await confirm(page)
    const description = await dialog.innerText()
    for (const text of [W.scope, tabbed.title, tabbed.session.when, tabbed.session.id]) {
      assert.ok(description.includes(text), text)
    }
    const [request] = await Promise.all([
      page.waitForRequest("**/api/delete"),
      deleteButton(dialog).click(),
    ])
    assert.deepEqual(request.postDataJSON(), { sessions: [tabbed.session.id] })
    await page.waitForURL(app.url("#/sessions"))
  } finally { await tab.close() }
})

test("Refused, interrupted and incomplete deletions stay on the replay and can be retried", async () => {
  const tab = await openTab(app)
  try {
    const { page } = tab
    const answers = [
      [{ status: 409, json: { error: "The replay changed." } }, "The replay changed."],
      [{ status: 500, json: { error: "The database is busy." } }, "The database is busy."],
      [null, "Can't reach AgentCake."],
      [{ json: { ...deleted, database: { ...clean, error: "disk full" } } }, W.cleanup],
      [{ json: { ...deleted, backups: [{ ...clean, rows: 1, log_cleared: false }] } }, W.cleanup],
    ]
    let attempt = 0
    await page.route("**/api/delete", (route) => {
      const reply = answers[attempt++][0]
      return reply ? route.fulfill(reply) : route.abort("failed")
    })
    const hash = sessionHash(detail.session.id)
    await page.goto(app.url(hash))
    const dialog = await confirm(page)
    for (const [, text] of answers) {
      await deleteButton(dialog).click()
      await dialog.getByRole("alert").filter({ hasText: text }).waitFor()
      assert.ok(page.url().endsWith(hash))
      assert.equal(await deleteButton(dialog).isEnabled(), true)
    }
    assert.equal(attempt, answers.length)
  } finally { await tab.close() }
})

test("An already removed session explains what happened and can return to the list", async () => {
  const tab = await openTab(app)
  try {
    const { page } = tab
    await page.route("**/api/delete", (route) => route.fulfill({ json: { ...deleted, sessions: [{ found: false }] } }))
    await page.goto(app.url(sessionHash(detail.session.id)))
    const dialog = await confirm(page)
    await deleteButton(dialog).click()
    await dialog.getByRole("alert").filter({ hasText: W.gone }).waitFor()
    await dialog.getByRole("button", { name: W.back }).click()
    await page.waitForURL(app.url("#/sessions"))
  } finally { await tab.close() }
})
