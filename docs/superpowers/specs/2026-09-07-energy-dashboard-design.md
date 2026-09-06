# Energy Dashboard — Design

**Date:** 2026-09-07
**Status:** Approved design, pre-implementation
**Repo:** `github.com/Flamage82/EnergyMonitor` (currently empty)

## 1. Purpose

A public web dashboard so the kids (and household) can see real-time energy
usage at Marburg, understand what individual appliances draw, and watch an
approximate running total of the month's electricity bill — split between the
**main house** (4 people) and **Nicki's granny flat** (1 person).

Success criteria:

- Live per-circuit power readings, refreshed every ~10 s, usable as a
  "turn it on and watch the number" diagnostic tool.
- A graph of the day's usage (default) with a month view toggle.
- Month-to-date bill estimate for each household, net of solar, updated a few
  times an hour.
- Zero backend state. Free hosting. Nothing for a user to log into.

Explicit non-goals: historical bill archive, multi-month comparison, per-user
accounts, alerting, notifications, controlling anything.

## 2. Data source: Emoncms.org

All data comes from a single Emoncms account, node **ByteCreep**, via a
**read-only API key**. Findings from probing the live API (2026-09-07):

### 2.1 Feeds

| Feed | ID | Unit | Group | Notes |
|---|---|---|---|---|
| Voltage | 384743 | V | — | not used |
| Light 1 | 384745 | W | main | |
| Power 1 | 384746 | W | main | |
| Light 2 | 384747 | W | main | |
| Power 2 | 384748 | W | main | |
| Oven | 384750 | W | main | |
| HSTP | 384751 | W | main | hot water |
| Air Conditioner | 384752 | W | main | |
| Solar | 384753 | W | solar | **negative when generating** |
| Pool | 384754 | W | main | |
| Nicki | 545440 | W | nicki | granny flat, independent circuit |

- All feeds are engine 5 (PHPFINA), 5-second fixed interval, history back to 2019.
- No circuits overlap / double-count. No whole-of-meter feed exists — the meter's
  net position is reconstructed by summing circuits.
- Unmonitored loads exist; the bill is therefore an estimate (see §5).

### 2.2 Endpoints used

- **`GET feed/fetch.json?ids=a,b,c`** → `[v1, v2, ...]` — current value of each
  feed. One call for the whole live view.
- **`GET feed/data.json?ids=a,b,c&start=<ms>&end=<ms>&interval=<s>&average=1&timeformat=unixms&timezone=Australia/Brisbane`**
  → `[{feedid, data:[[ms,val],...]}, ...]` — history for all feeds in one call.

### 2.3 The `average=1` parameter (critical)

Without it, `feed/data.json` returns the **instantaneous sample at the start of
each bucket** — spikes between samples are missed.

With `average=1` it returns the **mean of every 5-second raw sample in the
bucket** (docs: *"Mean of each interval rather than the value at its start"*).
Energy is then `Σ(bucket_avg_W × bucket_seconds) / 3600 / 1000` kWh — a true
integral of power over time, accurate to the 5-second source resolution
**regardless of bucket size**.

Measured (Solar feed, month-to-date): 60 s buckets → −175.5 kWh, 5 min →
−176.0 kWh, 30 min → −177.0 kWh. ~0.5 % spread. Bucket size affects graph
smoothness and payload size, not the total.

### 2.4 Limits

- Max 70,000 datapoints per request. A full month at 5-min buckets is ~8,900
  points/feed — one multi-feed request covers all feeds, ~3 MB, well under cap.
- Datapoint payload today (6 days) at 5-min, 10 feeds: 610 KB.

### 2.5 CORS — why a proxy is required

emoncms.org answers the CORS **preflight** (`Access-Control-Allow-Origin: *`)
but sends **no `Access-Control-Allow-Origin` header on the actual response**.
Confirmed from a real browser: `fetch()` to emoncms.org fails outright, with
both header auth and `?apikey=`. A purely static browser-only app **cannot**
call emoncms.org. A proxy is mandatory regardless of the key-storage question.

## 3. Architecture

```
GitHub repo (Flamage82/EnergyMonitor)
│
├── app/     React + Vite + TS  ──GitHub Actions──►  GitHub Pages
│                                                    https://flamage82.github.io/EnergyMonitor/
│                                                         │  fetch  (CORS allowed by Worker)
│                                                         ▼
└── worker/  Cloudflare Worker  ─────────────────►  <name>.<subdomain>.workers.dev
                                                         │  injects EMONCMS_KEY secret
                                                         │  validates feed IDs
                                                         ▼
                                                    emoncms.org/feed/*
```

### 3.1 Key storage decision

**The Worker holds the API key** as a Cloudflare secret (`EMONCMS_KEY`). The key
never reaches the browser.

Rejected alternative: ship an encrypted key in the static bundle, decrypt with a
user-entered password into localStorage. Rejected because (a) a proxy is
required anyway for CORS, so this adds moving parts rather than removing them;
(b) the ciphertext would be public, exposed to offline brute-force; (c) the
proxy already fully contains the key with no crypto.

Because the key is read-only and the Worker whitelists feed IDs and endpoints,
the worst case if the Worker URL is discovered is that someone can read these 11
energy feeds. That is acceptable — no password gate for now.

### 3.2 Cloudflare Worker (`worker/`)

Thin, stateless proxy. Endpoints:

| Route | Purpose | Upstream |
|---|---|---|
| `GET /live` | current W for all configured feeds | `feed/fetch.json?ids=<all>` |
| `GET /series?ids=&start=&end=&interval=` | history | `feed/data.json?ids=&start=&end=&interval=&average=1&timeformat=unixms&timezone=Australia/Brisbane` |

Behaviour:

- Rejects any `id` not in the built-in allow-list (the 11 feed IDs above).
- Forces `average=1`; ignores/overrides client attempts to set it otherwise.
- Clamps `interval` to a sane minimum (e.g. ≥ 60) and the range to ≤ 40 days.
- `Access-Control-Allow-Origin`: exact Pages origin, from a Worker var
  (`ALLOWED_ORIGIN`) so it is configurable per environment.
- `Cache-Control` + Cloudflare Cache API: 60 s on `/series`, 10 s on `/live`.
- Returns upstream JSON unchanged on success; `502` + short JSON error on
  upstream failure (no silent empty arrays).

Config: `wrangler.toml` with `ALLOWED_ORIGIN` var; `wrangler secret put
EMONCMS_KEY`; `wrangler deploy`. Local dev via `wrangler dev`.

### 3.3 React app (`app/`)

- Vite + React + TypeScript. `base: "/EnergyMonitor/"` for Pages.
- Deployed by GitHub Actions (`.github/workflows/deploy.yml`) on push to `main`,
  using the official Pages actions. Pages source = GitHub Actions.
- No router — single page.
- State via React hooks + a small amount of `localStorage`. No Redux etc.

## 4. Configuration — `app/src/config.ts`

Single typed module, the only place these values live:

```ts
export const config = {
  workerBaseUrl: "https://<worker-host>",      // set after first deploy
  timezone: "Australia/Brisbane",              // QLD, no DST

  feeds: {
    main:  [384745, 384746, 384747, 384748, 384750, 384751, 384752, 384754],
    nicki: [545440],
    solar: [384753],                           // negative when generating
  },
  feedLabels: { 384745: "Light 1", /* ... */ },

  tariff: {
    importCentsPerKwh: 27.83,                   // GST inclusive
    supplyChargeCentsPerDay: 132.484,           // GST inclusive
    feedInCentsPerKwh: 5,                       // no GST
  },

  shares: { mainHouse: 4, nicki: 1 },           // supply charge + FiT income split

  solarAllocation: "proportional",              // | "mainHouseFirst"

  bucketSeconds: 300,                           // history resolution
  livePollMs: 10_000,
  billRecomputeMs: 180_000,
};
```

## 5. Energy & billing math — `app/src/lib/energy.ts`

Pure, deterministic, unit-tested (Vitest, TDD). No I/O.

### 5.1 Per-bucket quantities

For each 5-min bucket the multi-feed history provides an average W per feed.

```
main_W  = Σ feeds.main
nicki_W = Σ feeds.nicki          (= Nicki feed)
solar_W = −(Σ feeds.solar)       (≥ 0 when generating)
gross_W = main_W + nicki_W
net_W   = gross_W − solar_W      (> 0 import, < 0 export)
```

Energy per bucket: `kWh = W × bucketSeconds / 3_600_000`.

Missing bucket (`null` for any feed in the group): treat that feed as 0 for the
bucket and flag the bucket as partial; surface "N gaps" in the UI rather than
failing.

### 5.2 Allocation between households

**Supply charge:** `days_elapsed_in_month × supplyChargeCentsPerDay`, split
`mainHouse:nicki` = 4:1. `days_elapsed` is fractional, based on `now` in
`Australia/Brisbane` vs the 1st of the month 00:00 local.

**Per bucket, import (`net_W > 0`):**

- `proportional` (default): each household pays for
  `net_kWh × (household_W / gross_W)` at `importCentsPerKwh`.
- `mainHouseFirst`: solar offsets `main_W` first.
  `main_net = max(0, main_W − solar_W)`;
  `solar_left = max(0, solar_W − main_W)`;
  `nicki_net = max(0, nicki_W − solar_left)`.
  Each pays for its own `*_net` kWh.

**Per bucket, export (`net_W < 0`):** `export_kWh × feedInCentsPerKwh` is credit,
split 4:1 (household "income" share, per user), regardless of `solarAllocation`.

### 5.3 Result

```ts
interface HouseholdBill {
  importKwh: number;
  importCost: number;        // $
  solarCreditShare: number;  // $ (negative reduces the bill)
  supplyChargeShare: number; // $
  total: number;             // $
}
interface BillResult { mainHouse: HouseholdBill; nicki: HouseholdBill; }
```

Displayed with a persistent "estimate — excludes unmonitored loads" note.

## 6. UI

One page, three stacked sections. Mobile-first, responsive.

### 6.1 `<LiveNow>` — polls Worker `/live` every `livePollMs`

- Headline trio: **Main house W**, **Nicki W**, **Solar W** (generating/idle).
- **Net** indicator: importing (red, ▲) / exporting (green, ▼) with W.
- Expandable per-circuit list with each feed's current W, using `feedLabels`,
  grouped main / nicki / solar. This is the "flip the pool pump and watch"
  tool.
- Stale-data guard: if newest feed timestamp is > 2 min old, show "data
  delayed".

### 6.2 `<EnergyChart>` — Recharts

- **Today** (default): stacked area, main vs nicki consumption, solar
  generation overlaid as a line, local midnight → now, 5-min buckets.
- **This month**: daily bars (`interval=daily`, tz-aligned), net import per day,
  with export days shown below the axis.
- Toggle; selection persisted to `localStorage` (`chart.range`).

### 6.3 `<BillSummary>` — recomputes every `billRecomputeMs`

- Two cards: **Main house** and **Nicki**. Each shows kWh imported, import cost,
  solar credit share, supply-charge share, and the running **total $**.
- Small print: the three rates, the 4:1 split, "estimate" disclaimer, and month
  label.

## 7. Data flow (hooks)

| Hook | Source | Feeds | Consumers |
|---|---|---|---|
| `useLiveFeeds()` | Worker `/live` | all | `<LiveNow>` |
| `useMonthData()` | Worker `/series` month-to-date @ `bucketSeconds` | main+nicki+solar | `<BillSummary>`, month chart |
| `useTodaySeries()` | Worker `/series` midnight→now @ `bucketSeconds` | main+nicki+solar | today chart |

- Each hook: `fetch` + interval refresh, exposes `{ data, error, loading,
  lastUpdated }`.
- Errors are shown in-place (banner per section), never swallowed.
- `useMonthData` may fetch once and extend incrementally later — start simple
  (refetch whole month-to-date each cycle; ~3 MB, edge-cached).

## 8. Testing

- **Vitest** unit tests for `lib/energy.ts`: integration, `netMeter`, both
  allocation modes, supply-charge proration, gap handling, export credit.
  Written test-first.
- Fixture: a small hand-computed bucket series with a known expected
  `BillResult`.
- Worker: a couple of `vitest` + `@cloudflare/vitest-pool-workers` tests for
  ID-whitelist rejection and CORS header.
- Light component smoke tests (React Testing Library) for the three sections
  rendering with mocked hooks. No E2E for v1.

## 9. Repo layout

```
/app
  src/
    config.ts
    api/worker.ts          # typed client for /live and /series
    lib/energy.ts          # pure math
    lib/time.ts            # month boundaries in Australia/Brisbane
    hooks/
    components/
    App.tsx  main.tsx
  index.html  vite.config.ts  package.json  tsconfig.json
/worker
  src/index.ts
  wrangler.toml
  package.json
/.github/workflows/deploy.yml
/docs/superpowers/specs/2026-09-07-energy-dashboard-design.md
README.md                  # setup: wrangler login, secret put, deploy; Pages settings
```

## 10. Build sequence (for the plan)

1. Scaffold `app/` (Vite React TS) + `worker/` (wrangler) + workspace.
2. `lib/energy.ts` + `lib/time.ts` test-first.
3. Worker: `/live`, `/series`, whitelist, CORS, cache; `wrangler dev` verified.
4. Typed Worker client + the three hooks.
5. `<LiveNow>`.
6. `<EnergyChart>` (today, then month).
7. `<BillSummary>`.
8. GitHub Actions Pages deploy; set real Worker URL in `config.ts`.
9. Deploy Worker; end-to-end check on the live Pages URL.
10. README.

## 11. Open items / future

- Optional: shared-password gate at the Worker (single header check) if the
  dashboard should not be fully public.
- Optional: Worker `/bill` endpoint doing the integration server-side + KV cache
  if client payload/compute becomes a concern.
- Optional: incremental month accumulation instead of full refetch.
- `solarAllocation` default is `proportional`; revisit once real numbers are in.
