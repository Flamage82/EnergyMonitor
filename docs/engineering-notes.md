# Engineering notes — Marburg Energy dashboard

Context for anyone (human or agent) picking this up later. The
[design spec](superpowers/specs/2026-09-07-energy-dashboard-design.md) explains
the *what*; this file is the accumulated *why*, the traps, and the things that
were learned by running it against the real Emoncms and the real deploy.

Status as of 2026-09-07: built, merged to `main`, deployed and live-verified.

---

## Architecture in one paragraph

Static React SPA on GitHub Pages talks **only** to a Cloudflare Worker
(`worker/`). The Worker holds the read-only Emoncms API key as a secret,
whitelists the 11 feed IDs, forces `average=1` on history queries, adds CORS
scoped to the Pages origin, edge-caches, and proxies to `emoncms.org`. The
browser never sees the key and **cannot** call `emoncms.org` directly (see CORS
below). All energy integration and bill allocation is pure, unit-tested code in
`app/src/lib/`.

Why a Worker and not "encrypt the key in the bundle, decrypt with a password":
CORS forces a proxy regardless (below), and once there's a proxy, putting the
key *in* it is less code and strictly more secure than shipping public
ciphertext.

---

## Hard-won facts about emoncms.org

- **No CORS.** `emoncms.org` answers the CORS preflight but sends no
  `Access-Control-Allow-Origin` on the actual response. A browser `fetch()` to it
  fails outright. This is why the Worker is mandatory, not optional.
- **`average=1` is load-bearing.** Without it, `feed/data.json` returns the
  instantaneous sample at each bucket's start (spikes missed). With it, the mean
  of every 5-second raw sample in the bucket. Energy = mean-power × time, so
  bucket size does **not** change the kWh totals (measured: ~0.5% between 5-min
  and 30-min). The Worker forces `average=1`; a client cannot turn it off.
- **emoncms has a server memory limit that returns as a fake success.** A query
  spanning ~31 days × 10 feeds at 60-second buckets makes `emoncms.org` return
  **HTTP 200 with an HTML body**: `Fatal error: Allowed memory size of
  134217728 bytes exhausted`. It is *not* a clean error. `worker/src/index.ts`
  `/series` guards against this two ways: (a) it auto-coarsens the interval
  (`minInterval = ceil(spanSeconds * nIds / 100_000)`), and (b) it validates the
  upstream body parses as a JSON array before caching/returning, else 502.
  **If you widen the query window or add feeds, re-check this.**
- **The multi-feed endpoint** `feed/data.json?ids=a,b,c` returns
  `[{feedid, data: [[ms, val|null], ...]}, ...]` and pads feeds with no data for
  the range with `null` — it does not omit them. A feed *missing entirely* from
  the response is the pathological case (partial response / the HTML error) and
  `buildBuckets` flags every bucket `partial` when it sees that.
- Current-value endpoint: `feed/fetch.json?ids=a,b,c` → a **positional** array
  `[v0, v1, ...]` in the order you asked. See the feed-order trap below.

---

## The feed-order trap (do not re-introduce)

`worker/src/feeds.ts` `FEED_IDS` and `app/src/config.ts` `allFeedIds` are **two
independently-ordered lists of the same IDs**:

- `FEED_IDS`: `[Light1, Power1, Light2, Power2, Oven, HSTP, AirCon, Solar, Pool, Nicki]`
- `config.allFeedIds`: `[...feeds.main (8), ...feeds.nicki, ...feeds.solar]` —
  Pool is in `main` (index 7), so Solar/Pool/Nicki land at different positions.

The original `/live` returned emoncms's **positional array** and the client
mapped it onto `config.allFeedIds` by index → Solar's watts got labelled "Pool",
etc. It shipped and was only caught by running it live (the live view showed an
impossible negative "Main house").

**The fix:** `/live` now returns an **object keyed by feed ID**
(`{ "384753": -1712.7, ... }`), built by the Worker zipping `FEED_IDS` with the
upstream array. `fetchLive` reads `obj[id]`. Order can no longer misalign.
`worker/test/worker.test.ts` pins the exact ID→value pairing — keep that test.

There is still **no cross-package test** binding the Worker's output shape to the
client's expectation (they're separate npm packages). The mitigation is runtime
validation in `fetchLive`/`fetchSeries` (`app/src/api/worker.ts`) that throws a
visible error instead of rendering silent zeros. If you change either side's
shape, update both and both tests.

---

## The Nicki feed / data-floor mechanism

Feed **545440 (Nicki, the granny flat)** was created ~2026-09-07 and has **no
history before that**. All the other feeds were also reconfigured that day. Two
things exist because of this:

1. **`config.dataStartDate = "2026-09-07"`** — a floor. `useMonthData` fetches
   from `max(monthStart, dataStartDate)`, and `BillSummary` prorates the supply
   charge from the same instant. The bill note says "Covers 2026-09-07 onwards".
   Once the billing month starts *after* this date (October) the floor stops
   having any effect — but you can't just delete the config key, it's referenced
   in `useSeries.ts` and `BillSummary.tsx` (see `docs/follow-ups.md` I9).
2. **`buildBuckets` "not started" logic** (`app/src/lib/energy.ts`) — a feed's
   *leading run of nulls* (before its first real datapoint) is "not reporting
   yet": contributes 0, does **not** flag `partial`. A null *after* a feed's
   first datapoint is a real gap and flags `partial` → `bill.gaps` → the note
   shows "N data gaps". So Nicki reading low for her first day or two is
   expected and silent; a feed that genuinely drops out is loud.

**First-month caveat:** the supply charge is prorated from 2026-09-07 while the
retailer bills from 2026-09-01 — roughly $8 of September supply charge is not
shown. Disclosed in the note and `docs/follow-ups.md`.

---

## Local development gotchas

- `worker/wrangler.jsonc` sets `ALLOWED_ORIGIN` to the **production** Pages origin
  (`https://flamage82.github.io`). For local dev the app is on `localhost:5173`,
  so you **must** override it: `worker/.dev.vars` (gitignored) needs both
  `EMONCMS_KEY=...` **and** `ALLOWED_ORIGIN=http://localhost:5173`. Without the
  override, every request is CORS-blocked and the app silently shows nothing.
- Run the Worker with `npx wrangler dev --port 8787 --local`. Point the app at it
  with `app/.env.local` (gitignored) containing
  `VITE_WORKER_URL=http://localhost:8787`. There is **no working default** — the
  `config.ts` fallback is a dead placeholder.
- On Windows, `wrangler dev` / vitest-pool-workers leave a harmless
  `EBUSY ... miniflare-CacheObject` message on shutdown, and print a
  `compatibility_date` fallback warning (the bundled workerd is older than
  `2026-09-07`). Neither is a failure.
- **Recharts + headless screenshots:** a Playwright *full-page* screenshot often
  captures the chart before its enter-animation paints and shows an empty plot.
  Element-scoped or viewport screenshots (and DOM inspection of
  `.recharts-area-area` `d` attributes) show it renders fine. Do not "fix" a
  non-bug here.

---

## Testing notes

- **`tsc --noEmit` is a no-op for `app/`.** The root `app/tsconfig.json` uses
  project references (`files: []` + `references`), so `tsc --noEmit` checks
  nothing. The real typecheck is `cd app && npm run build` (= `tsc -b && vite
  build`). Several early per-task reviews wrongly reported "tsc clean" from the
  no-op. The Worker's tsconfig is a single standalone config, so
  `cd worker && npm run typecheck` (`tsc --noEmit`) *does* work there.
- **testing-library + Vitest fake timers:** `@testing-library/dom`'s `waitFor`
  detects fake timers via a `jest` global that Vitest doesn't provide. Tests that
  need `waitFor` under `vi.useFakeTimers()` install a scoped
  `vi.stubGlobal("jest", { advanceTimersByTime: ... })` shim (see
  `app/src/test/hooks.test.tsx`). Without it those tests deadlock to a 5s
  timeout.
- **vitest-pool-workers version:** `@cloudflare/vitest-pool-workers` `0.5.x–0.7.x`
  bundle wrangler 3; `0.8.x` is the first with wrangler 4. The worker is on
  `0.8.71` + `vitest 3.2.7` + `wrangler 4.x`. The app is on `vitest 2.1.9` with an
  `overrides: { vite }` to dedupe. They're separate packages; the vitest major
  mismatch is harmless. `worker/test/env.d.ts` is a types-only declaration merge
  (`ProvidedEnv extends Env`) required because `cloudflare:test` ships
  `ProvidedEnv` empty.
- **`act()` warnings** currently leak from `hooks.test.tsx` into the app test
  output. They're cosmetic (assertions are gated on `waitFor`) but they mean the
  output isn't pristine — worth cleaning so a *real* state-update bug would stand
  out. (`docs/follow-ups.md`.)
- The Worker was verified **live against production emoncms.org** (via
  `wrangler dev` + the real key), not just mocked: `/live`, `/series` with real
  averaged data, 403 on unknown feed, the 31-day memory-limit case, CORS. The app
  was driven live end-to-end with a headless browser three times during
  development. What was **not** verifiable locally: the production CORS origin
  (checked post-deploy by curling the deployed Worker).

---

## Deployment

- **App → Pages:** `.github/workflows/deploy.yml`, on push to `main`. The build
  reads the Worker URL from the GitHub Actions **repo variable** `WORKER_URL`
  (`https://marburg-energy-proxy.bytecreep.workers.dev`). If it's unset the build
  still goes green but the site's data never loads.
- **Worker:** deployed manually — `cd worker && npx wrangler deploy`. Secret:
  `npx wrangler secret put EMONCMS_KEY`. Cloudflare `workers.dev` subdomain for
  this account: `bytecreep`.
- **CI:** `.github/workflows/ci.yml` runs app tests + build and worker
  typecheck + tests on every push and PR. `deploy.yml` is Pages-only.
- The deploy workflow uses `concurrency.cancel-in-progress: false` (deliberate —
  matches GitHub's official Pages workflow, so an in-flight publish isn't
  cancelled).

---

## Decisions made during the build that weren't in the original spec

- `/live` returns an ID-keyed object, not the spec's positional array (feed-order
  bug fix, above).
- `/series` auto-coarsens over-fine intervals and validates the body is JSON
  (emoncms memory-limit discovery). A missing-`interval` request defaults to 300s
  (spec only required "a sane minimum").
- `config.monthBucketSeconds = 900` — the month query uses coarser buckets than
  the live/today view (300s) to keep the payload ~1 MB by month-end. kWh totals
  are unaffected.
- `<App>` owns `useMonthData` and `now` (`useState(() => new Date())`), passing
  both down to `<BillSummary>` and `<EnergyChart>` as props — so the month feed
  is polled once, not twice, and both components see the same window. Side effect:
  a tab left open across midnight/month-rollover won't advance until reload.
- `dataStartDate` + the "not started" gap semantics (Nicki, above).
- The global `git add` hook on this machine has a carve-out for
  `/src/energymonitor` paths (added so subagents could stage files during the
  build).

---

## Where to look

| Thing | File |
|---|---|
| Feed IDs, groups, tariff, rates, all tunables | `app/src/config.ts` |
| Bill math (integration, allocation, two solar modes) | `app/src/lib/energy.ts` |
| Brisbane month/day/timezone math | `app/src/lib/time.ts` |
| Worker proxy (endpoints, CORS, cache, whitelist, guards) | `worker/src/index.ts` |
| Client ↔ Worker contract + runtime validation | `app/src/api/worker.ts` |
| Deferred work | `docs/follow-ups.md` |
| Original design rationale | `docs/superpowers/specs/2026-09-07-energy-dashboard-design.md` |
