# web/ · cake's local pages (shadcn/ui + Frosting theme)

Rules: [`../DESIGN.md`](../DESIGN.md). Users never need Node: a release runs `npm ci && npm run build` and ships `dist/`
(static files); cake (Python) serves them and a JSON API under `/api`. Build with Node 24.22.1, the release's
(`.nvmrc`, so `nvm use` picks it; `package.json` asks for 22.22.0 or newer, as react-router does).

    npm ci                 # exact versions from package-lock.json
    npm run dev            # http://127.0.0.1:5179/ (answers /api from the fixtures)
    npm run build          # type-check + dist/ (the app) + check:dist
    npm run check:ui       # UI rules + DESIGN.md token table + check:schemas
    npm test               # node --test on scripts/*.test.mjs and tests/*.test.mjs: the schema checker, the fixture /api, check:dist,
                           # and the pages in Chromium (tests/: home, dashboard, the session list, the session and replay pages,
                           # the registration card, light under a dark system)
    npm run visual         # pixel diff of the component overview + 9 pages against visual/baseline/
    npm run visual:update  # accept the current look as the baseline (commit it with the change)
    npm run shots -- <dir> # 1280px and 485px screenshots of every page, fails on horizontal scroll
    node scripts/replay-fixtures.mjs  # re-records the sample replays in the test site's shop (tests/site; a scratch AgentCake, ~3 min)
    node scripts/favicon.mjs          # redraws public/favicon.ico (Crumb's head) from the built pages; after npm run build

Routes: `#/` (no data yet), `#/dashboard`, `#/sessions`, `#/sessions/<id>`, `#/settings`, `#/components`, each behind the
registration card until AgentCake has registered (DESIGN.md §6.6); until the first session, `#/` and `#/dashboard` show how
to connect the website (DESIGN.md §6.3). The top bar shows the website (DESIGN.md §6.2).
Screenshots and the visual test use Playwright's Chromium; set `CAKE_CHROME` to its executable if it is not found. It
runs with rendering switches that give the same pixels on every run however busy the machine is (CPU raster, every
compositing stage done before a frame: `STABLE_RENDERING` in `scripts/shots.mjs`); the visual test's threshold stays.

## Data: `/api`

The pages hold no data. Each page asks cake for JSON through `src/data/api.ts` (one function per endpoint, relative URLs
`api/…` so the pages work under any path) and shows `PageLoading` until the answer arrives, `PageError` with "Try again"
if it doesn't (`src/components/cake/page-state.tsx`). The contract has three parts that `npm run check:ui` keeps equal:

- `src/data/types.ts`: one TypeScript type per endpoint, with the conventions (snake_case keys, times inside a session in
  milliseconds, wall-clock times formatted by the server, errors as `{"error": "…"}`);
- `src/data/schema/<endpoint>.schema.json`: the same shapes as JSON Schema, for the Python tests. They use only the
  keywords `scripts/json-schema.mjs` knows (type, enum, const, properties, required, additionalProperties, items,
  minItems, maxItems, minimum, maximum, minLength, pattern, `$ref`, `$defs`), so the Python side can check answers with
  the same few rules and the standard library; every object is closed (`additionalProperties: false`);
- `src/data/fixtures/<endpoint>.json`, and more under `fixtures/<endpoint>/`: sample answers (the design's made-up data;
  the replays are recorded, see below).

| Endpoint | Answer | Schema |
|---|---|---|
| `GET /api/overview?range=24h\|7d\|30d\|all` | `Overview`: counts, the human + agent top block, the agents seen, page views and pages per session, the latest Agent sessions, disk use, the coverage table's wording | `overview` |
| `GET /api/web?range=24h\|7d\|30d\|all` | `WebAnalytics`: visitors and page views (all and by verdict), active time spent (all and by verdict), the Trends chart's five metrics for Human and Agent by hour or day, and the time zone they're in, the same five for each agent (Top agents), the Paths table, and the Sources, Devices and Geography tables (a row per value of each breakdown) | `web` |
| `GET /api/funnel?range=&step=&step=` | `FunnelReport`: Agent and Human session counts for each step once the session reaches the preceding steps in order. Each `step` is an exact path without the query string or fragment. | `funnel` |
| `GET /api/sessions?verdict=&agent=&range=&path=&cursor=` | `SessionsPage` with group counts, agent names, newest sessions, and a `next` cursor. An exact stored pathname in `path` keeps Agent and Human sessions with a matching view in any counted tab. | `sessions` |
| `GET /api/session/<id>` | `SessionDetail`: the session, title, summary, timeline, the pages in the order they opened, four reason layers, actions, replay (chunks, the session's clock `epoch_ms`, `handoff_lead_ms`, why it is `missing`), server half; for a session of more than one tab also each tab (`tabs`), the tab to follow at each moment (`follow`), the tab the verdict rests on, and the tab an older address named; `<id>` may be a tab's own id; 404 if unknown | `session` |
| `GET /api/session/<id>/replay?chunk=<n>&tab=<id>` | `ReplayChunk`: the rrweb events of chunk n (one per 10 s, as listed in the session, or in its tab `tab` of a session of more than one tab), on the session's clock; the replay page asks for a chunk only when it needs it | `replay` |
| `GET /api/settings` | `Settings` | `settings` |
| `POST /api/settings` (JSON, only the fields to change) | the whole `Settings`; 400 with an error body for a bad value | `settings-update` (body) |
| `GET /api/timezones` | `Timezones`: the time zones Settings lists, UTC first, each with its offset from UTC now | `timezones` |
| `POST /api/delete` (JSON: `{"sessions": ["<id>"]}` or `{"all": true}`) | the replay dialog deletes one whole visit by its canonical session ID. Settings deletes every session. The response reports sessions found and the live database and backup cleanup outcomes. | — |
| `GET /api/setup` | `Setup`: the sentence for a coding agent (EN / 中文), commands, example preview, how many sessions are recorded (the home page is the dashboard from the first one on) | `setup` |
| `GET /api/register` | `Registration`: whether this data folder has registered (until it has, every page shows the registration card), what it sent and when, the checks the card makes, where to ask for deletion | `register` |
| `POST /api/register` (JSON: the text "View registration data" shows) | the new `Registration` once Tartini AI took it; 400 for a body the page doesn't write, 409 when registered already, 502 / 503 saying why it wasn't sent | `register-payload` (body) |
| `GET /api/health` | `Health`: for `agentcake doctor` (the fields of cake 0.3.4); the pages don't use it | `health` |
| any error | `ApiErrorBody` `{"error": "…"}` | `error` |

The dashboard and the session list are shot on real data: `fixtures/library/` holds cake's own answers
(`overview.json`, `sessions.json`, `setup.json`) on a fixed test library of recorded visits that the maintainers keep
with their recordings (two cake.js visits and the lab's 26 sessions), all made at one fixed moment in one time zone, so
the wall-clock words ("Today 09:28") never move; `fixtures/setup.json` is a fresh AgentCake's answer (nothing recorded:
the onboarding), `fixtures/register/first-run.json` its registration card, and `fixtures/register.json` the same
AgentCake once it has registered (a made-up registration written in, as a test tool does), which every other page is
shown behind. The maintainers write all six again after a change to the API or to how cake judges (then
`npm run visual:update`). `scripts/fixture-api.mjs` answers from `library/` first when asked to
(`serve(dist, { fixtures: "library" })`, the dashboard's and the session list's shots); every other sample is the design's.

The fixtures exist only for screenshots and development: `scripts/fixture-api.mjs` answers `/api` from them in `npm run
visual`, `npm run shots`, `npm run dev`, `npm run preview` and `npm test` (same routes, filters and errors as cake). A
schema's samples are `fixtures/<endpoint>.json` and every file under `fixtures/<endpoint>/`: more sessions in
`session/<id>.json`, and each recorded replay in `replay/<id>/<n>.json`, one file per chunk. The replays are real:
cake.js recorded them in the shop (the demo shop until 0.4.0, now the test site in tests/site), read back with cake's own
`streams.read_events` (`node scripts/replay-fixtures.mjs` re-records them; what is typed is masked by cake.js and
checked absent). The build never includes the fixtures, and `scripts/check-dist.mjs` (the last step of `npm run build`)
fails if any sample session shows up in `dist/`. A change to the contract changes all three parts, and the Python side
with them.

The replay page plays rrweb-player 2.0.0-alpha.18, which cake ships in `agentcake/static/` and serves under `/static/`;
the pages load it at run time (no npm copy). The dev, preview, screenshot and test servers serve the same two files
(`scripts/cake-static.mjs`). DESIGN.md §6.4 describes how the page reads chunks, labels the cursor and says why a
replay is missing.
