# Energy Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public web dashboard showing real-time household energy use at Marburg, with a usage graph and an approximate month-to-date electricity bill split between the main house and Nicki's granny flat.

**Architecture:** A React + Vite SPA hosted on GitHub Pages talks only to a small stateless Cloudflare Worker. The Worker holds the read-only Emoncms API key as a secret, whitelists feed IDs, forces `average=1`, adds CORS headers scoped to the Pages origin, and edge-caches responses. All energy integration and bill allocation happens in pure, unit-tested functions in the browser.

**Tech Stack:** TypeScript everywhere. App: Vite 6, React 19, Recharts 3, Vitest + @testing-library/react + jsdom. Worker: Cloudflare Workers runtime, Wrangler 4, Vitest + @cloudflare/vitest-pool-workers. Deploy: GitHub Actions → GitHub Pages; `wrangler deploy` for the Worker.

**Spec:** `docs/superpowers/specs/2026-09-07-energy-dashboard-design.md`

## Global Constraints

- Node ≥ 22 (dev machine has v22.21.1, npm 11.9.0).
- `app/` and `worker/` are **separate npm packages**, each with its own `package.json` and `node_modules`. No monorepo tooling.
- The raw Emoncms API key must NEVER appear in: committed files, the app bundle, client-visible URLs, or logs. It lives only as the Worker secret `EMONCMS_KEY` and (for local Worker dev) in `worker/.dev.vars`, which is git-ignored.
- Vite `base` MUST be `"/EnergyMonitor/"` (project Pages path).
- All Emoncms history requests go through the Worker and always use `average=1` — the Worker enforces this; the client never calls emoncms.org directly (CORS blocks it anyway).
- Feed IDs (node ByteCreep): Light 1 `384745`, Power 1 `384746`, Light 2 `384747`, Power 2 `384748`, Oven `384750`, HSTP `384751`, Air Conditioner `384752`, Solar `384753` (negative when generating), Pool `384754`, Nicki `545440`. Voltage `384743` is unused.
- Tariff (GST-inclusive display): import `27.83` c/kWh, supply charge `132.484` c/day, feed-in `5` c/kWh.
- Household shares for supply charge and feed-in income: main house `4`, Nicki `1`.
- Timezone: `Australia/Brisbane` (UTC+10, no DST). Billing period = calendar month in that zone.
- Pure logic functions (`lib/`) take all inputs as parameters (including "now" as a `Date` and any config) — no module-level singletons, no `Date.now()` inside them.
- Commit after every task with a Conventional Commits message. The human runs `git add`; a step that needs staging must say so and stop for the human, OR use `git commit <paths> -m ...` directly (no `git add`).

---

## File Structure

```
/.github/workflows/deploy.yml     GitHub Actions: build app, deploy to Pages
/.gitignore                       (exists)
/README.md                        setup + deploy instructions
/docs/superpowers/...             spec + this plan

/worker/
  package.json                    wrangler, typescript, vitest, @cloudflare/vitest-pool-workers
  wrangler.jsonc                  name, main, compatibility_date, vars.ALLOWED_ORIGIN
  tsconfig.json
  vitest.config.ts               defineWorkersConfig
  .dev.vars                       EMONCMS_KEY=... (git-ignored, created by hand)
  src/
    index.ts                      fetch handler: /live, /series, CORS, whitelist, cache
    feeds.ts                      FEED_IDS constant (single source for the whitelist)
  test/
    worker.test.ts               integration tests via SELF.fetch

/app/
  package.json
  index.html
  vite.config.ts                 base, plugin-react, vitest (jsdom) config
  tsconfig.json / tsconfig.node.json
  src/
    main.tsx                     React root
    App.tsx                      layout: <LiveNow/> <EnergyChart/> <BillSummary/>
    App.css / index.css          minimal styling
    config.ts                    all tunables (feed IDs, labels, tariff, shares, URLs, intervals)
    lib/
      time.ts                    zoned-time helpers (month boundary, days elapsed, day key)
      energy.ts                  types + buildBuckets + integrateKwh + allocateBill
    api/
      worker.ts                  typed client for /live and /series
    hooks/
      usePolledFetch.ts          generic "fetch + refresh on interval" hook
      useLiveFeeds.ts            current W per feed
      useSeries.ts               useMonthData + useTodaySeries (grouped buckets)
    components/
      LiveNow.tsx                headline trio + net indicator + per-circuit list
      EnergyChart.tsx            Recharts; today / month toggle; localStorage
      BillSummary.tsx            two household cards
      Section.tsx                shared card wrapper + error banner
    test/
      setup.ts                   @testing-library/jest-dom
      lib.time.test.ts
      lib.energy.test.ts
      api.worker.test.ts
      hooks.test.tsx
      components.test.tsx
```

---

## Task 1: Scaffold both packages

**Files:**
- Create: `app/package.json`, `app/index.html`, `app/vite.config.ts`, `app/tsconfig.json`, `app/tsconfig.node.json`, `app/src/main.tsx`, `app/src/App.tsx`, `app/src/index.css`, `app/src/test/setup.ts`, `app/src/vite-env.d.ts`
- Create: `worker/package.json`, `worker/wrangler.jsonc`, `worker/tsconfig.json`, `worker/vitest.config.ts`, `worker/src/index.ts` (stub), `worker/src/feeds.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `worker/src/feeds.ts` exports `export const FEED_IDS = [384745,384746,384747,384748,384750,384751,384752,384753,384754,545440] as const;` and `export type FeedId = (typeof FEED_IDS)[number];`

- [ ] **Step 1: Create the app package with Vite React-TS**

`app/package.json`:
```json
{
  "name": "energy-dashboard-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "recharts": "^3.3.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

`app/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/EnergyMonitor/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

`app/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

`app/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Marburg Energy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`app/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`app/src/App.tsx`:
```tsx
export default function App() {
  return <main className="app">Energy dashboard</main>;
}
```

`app/src/index.css`: a few lines of reset + system font. `app/src/vite-env.d.ts`: `/// <reference types="vite/client" />`.

`app/tsconfig.json` (standard Vite React strict config), `app/tsconfig.node.json` (for vite.config). Copy from a fresh `npm create vite@latest` react-ts template; ensure `"strict": true`.

- [ ] **Step 2: Install and verify the app builds**

Run: `cd app && npm install && npm run build && npm run test`
Expected: build succeeds, `vitest run` exits 0 with "no test files" (allowed) — if vitest errors on no files, add `passWithNoTests` to the `test` script: `"test": "vitest run --passWithNoTests"`.

- [ ] **Step 3: Create the worker package**

`worker/package.json`:
```json
{
  "name": "energy-dashboard-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "types": "wrangler types"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.40",
    "typescript": "^5.7.2",
    "vitest": "~2.1.8",
    "wrangler": "^4.0.0"
  }
}
```

`worker/wrangler.jsonc`:
```jsonc
{
  "name": "marburg-energy-proxy",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-07",
  "vars": {
    "ALLOWED_ORIGIN": "http://localhost:5173"
  }
}
```

`worker/src/feeds.ts`:
```ts
export const FEED_IDS = [
  384745, 384746, 384747, 384748, 384750, 384751, 384752, 384753, 384754, 545440,
] as const;
export type FeedId = (typeof FEED_IDS)[number];
```

`worker/src/index.ts` (stub for now):
```ts
export interface Env {
  EMONCMS_KEY: string;
  ALLOWED_ORIGIN: string;
}

export default {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;
```

`worker/vitest.config.ts`:
```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { EMONCMS_KEY: "test-key", ALLOWED_ORIGIN: "http://localhost:5173" },
        },
      },
    },
  },
});
```

`worker/tsconfig.json`: `target ES2022`, `module ESNext`, `moduleResolution bundler`, `types: ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers"]`, `strict: true`. Add `@cloudflare/workers-types` to devDependencies.

- [ ] **Step 4: Install and verify the worker runs**

Run: `cd worker && npm install && npm run test -- --passWithNoTests`
Then: `npx wrangler dev --port 8787 &` then `curl -s http://localhost:8787/` → `{"ok":true}` ; kill the dev server.

- [ ] **Step 5: Write README skeleton**

`README.md` with sections: Overview, Local development (`app`: `npm run dev`; `worker`: create `.dev.vars` with `EMONCMS_KEY=<key from C:\Dropbox\EmonCmsApiKey.txt>`, then `npm run dev`), Deploy (filled in Task 15). One paragraph each; no placeholders like "TODO".

- [ ] **Step 6: Commit**

```bash
git commit app/ worker/ README.md -m "chore: scaffold app and worker packages"
```
(If git refuses because paths are untracked with no HEAD parent issues, run `git commit -a` after the human stages, or ask the human to `git add app worker README.md && git commit`.)

---

## Task 2: `lib/time.ts` — zoned time helpers

**Files:**
- Create: `app/src/lib/time.ts`
- Test: `app/src/test/lib.time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `zonedTimeToUtcMs(y: number, month1to12: number, day: number, h: number, min: number, s: number, timeZone: string): number`
  - `monthStartMs(now: Date, timeZone: string): number` — epoch ms of the 1st of `now`'s month at 00:00:00 local
  - `daysElapsedInMonth(now: Date, timeZone: string): number` — fractional days since `monthStartMs`
  - `localDayKey(tMs: number, timeZone: string): string` — `"YYYY-MM-DD"` in `timeZone`
  - `monthLabel(now: Date, timeZone: string): string` — e.g. `"September 2026"`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  monthStartMs, daysElapsedInMonth, localDayKey, monthLabel,
} from "../lib/time";

const TZ = "Australia/Brisbane"; // UTC+10, no DST

describe("time helpers", () => {
  it("monthStartMs returns 1st 00:00 Brisbane as UTC ms", () => {
    // 2026-09-01 00:00:00 +10:00 === 2026-08-31 14:00:00 UTC
    const now = new Date("2026-09-07T05:00:00Z");
    expect(monthStartMs(now, TZ)).toBe(Date.parse("2026-08-31T14:00:00Z"));
  });

  it("daysElapsedInMonth is fractional and matches elapsed time", () => {
    const start = Date.parse("2026-08-31T14:00:00Z");
    const now = new Date(start + 3.5 * 86_400_000);
    expect(daysElapsedInMonth(now, TZ)).toBeCloseTo(3.5, 6);
  });

  it("localDayKey buckets an instant into the Brisbane calendar day", () => {
    // 2026-09-06T15:30:00Z === 2026-09-07 01:30 Brisbane
    expect(localDayKey(Date.parse("2026-09-06T15:30:00Z"), TZ)).toBe("2026-09-07");
  });

  it("monthLabel formats month and year", () => {
    expect(monthLabel(new Date("2026-09-07T05:00:00Z"), TZ)).toBe("September 2026");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/test/lib.time.test.ts`
Expected: FAIL — module `../lib/time` not found.

- [ ] **Step 3: Implement `lib/time.ts`**

```ts
function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour, minute: Number(map.minute), second: Number(map.second),
  };
}

export function zonedTimeToUtcMs(
  y: number, month1to12: number, day: number, h: number, min: number, s: number, timeZone: string,
): number {
  const guess = Date.UTC(y, month1to12 - 1, day, h, min, s);
  const p = parts(new Date(guess), timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asIfUtc - guess;
  return guess - offset;
}

export function monthStartMs(now: Date, timeZone: string): number {
  const p = parts(now, timeZone);
  return zonedTimeToUtcMs(p.year, p.month, 1, 0, 0, 0, timeZone);
}

export function daysElapsedInMonth(now: Date, timeZone: string): number {
  return (now.getTime() - monthStartMs(now, timeZone)) / 86_400_000;
}

export function localDayKey(tMs: number, timeZone: string): string {
  const p = parts(new Date(tMs), timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

export function monthLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, month: "long", year: "numeric" }).format(now);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/test/lib.time.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git commit app/src/lib/time.ts app/src/test/lib.time.test.ts -m "feat: zoned time helpers for Brisbane month boundaries"
```

---

## Task 3: `lib/energy.ts` — types, bucket assembly, integration

**Files:**
- Create: `app/src/lib/energy.ts`
- Test: `app/src/test/lib.energy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types: `FeedGroups { main: number[]; nicki: number[]; solar: number[] }`, `Tariff { importCentsPerKwh; supplyChargeCentsPerDay; feedInCentsPerKwh }`, `Shares { mainHouse; nicki }`, `SolarAllocation = "proportional" | "mainHouseFirst"`
  - `MultiFeedSeries = { feedid: string; data: [number, number | null][] }[]` (the Worker `/series` response shape)
  - `GroupBucket { tMs: number; mainW: number; nickiW: number; solarW: number; partial: boolean }` (`solarW` ≥ 0 when generating)
  - `buildBuckets(series: MultiFeedSeries, groups: FeedGroups): GroupBucket[]`
  - `integrateKwh(watts: number, bucketSeconds: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { buildBuckets, integrateKwh, type MultiFeedSeries, type FeedGroups } from "../lib/energy";

const groups: FeedGroups = { main: [1, 2], nicki: [9], solar: [5] };

describe("buildBuckets", () => {
  it("sums feed groups per timestamp and flips solar sign", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[1000, 100], [2000, 200]] },
      { feedid: "2", data: [[1000, 50], [2000, 60]] },
      { feedid: "9", data: [[1000, 30], [2000, 40]] },
      { feedid: "5", data: [[1000, -400], [2000, -10]] },
    ];
    const b = buildBuckets(series, groups);
    expect(b[0]).toEqual({ tMs: 1000, mainW: 150, nickiW: 30, solarW: 400, partial: false });
    expect(b[1]).toEqual({ tMs: 2000, mainW: 260, nickiW: 40, solarW: 10, partial: false });
  });

  it("treats a null sample as 0 and marks the bucket partial", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[1000, null]] },
      { feedid: "2", data: [[1000, 50]] },
      { feedid: "9", data: [[1000, 30]] },
      { feedid: "5", data: [[1000, -400]] },
    ];
    expect(buildBuckets(series, groups)[0]).toEqual({
      tMs: 1000, mainW: 50, nickiW: 30, solarW: 400, partial: true,
    });
  });
});

describe("integrateKwh", () => {
  it("converts average watts over a bucket to kWh", () => {
    expect(integrateKwh(2000, 300)).toBeCloseTo(2000 * 300 / 3_600_000, 9); // ~0.1667
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/test/lib.energy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types + `buildBuckets` + `integrateKwh`**

```ts
export interface FeedGroups { main: number[]; nicki: number[]; solar: number[]; }
export interface Tariff {
  importCentsPerKwh: number;
  supplyChargeCentsPerDay: number;
  feedInCentsPerKwh: number;
}
export interface Shares { mainHouse: number; nicki: number; }
export type SolarAllocation = "proportional" | "mainHouseFirst";

export type MultiFeedSeries = { feedid: string; data: [number, number | null][] }[];

export interface GroupBucket {
  tMs: number;
  mainW: number;
  nickiW: number;
  solarW: number; // >= 0 when generating
  partial: boolean;
}

export function integrateKwh(watts: number, bucketSeconds: number): number {
  return (watts * bucketSeconds) / 3_600_000;
}

export function buildBuckets(series: MultiFeedSeries, groups: FeedGroups): GroupBucket[] {
  const byId = new Map(series.map((s) => [Number(s.feedid), s.data]));
  const all = [...groups.main, ...groups.nicki, ...groups.solar];
  const length = Math.max(0, ...all.map((id) => byId.get(id)?.length ?? 0));

  const sumGroup = (ids: number[], i: number) => {
    let sum = 0;
    let missing = false;
    for (const id of ids) {
      const point = byId.get(id)?.[i];
      const v = point?.[1];
      if (v == null) missing = true;
      else sum += v;
    }
    return { sum, missing };
  };

  const out: GroupBucket[] = [];
  for (let i = 0; i < length; i++) {
    const main = sumGroup(groups.main, i);
    const nicki = sumGroup(groups.nicki, i);
    const solar = sumGroup(groups.solar, i);
    const tMs =
      byId.get(all[0])?.[i]?.[0] ??
      byId.get(groups.main[0])?.[i]?.[0] ??
      0;
    out.push({
      tMs,
      mainW: main.sum,
      nickiW: nicki.sum,
      solarW: -solar.sum, // feed is negative when generating
      partial: main.missing || nicki.missing || solar.missing,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/test/lib.energy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git commit app/src/lib/energy.ts app/src/test/lib.energy.test.ts -m "feat: energy bucket assembly and kWh integration"
```

---

## Task 4: `lib/energy.ts` — `allocateBill`

**Files:**
- Modify: `app/src/lib/energy.ts`
- Test: `app/src/test/lib.energy.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `GroupBucket`, `Tariff`, `Shares`, `SolarAllocation`, `integrateKwh` from Task 3.
- Produces:
  - `HouseholdBill { importKwh: number; importCost: number; solarCreditShare: number; supplyChargeShare: number; total: number }` (all dollars except `importKwh`; `solarCreditShare` ≤ 0)
  - `BillResult { mainHouse: HouseholdBill; nicki: HouseholdBill; gaps: number }`
  - `allocateBill(buckets: GroupBucket[], opts: AllocateOpts): BillResult` where
    `AllocateOpts { bucketSeconds: number; tariff: Tariff; shares: Shares; solarAllocation: SolarAllocation; daysElapsed: number }`

- [ ] **Step 1: Write the failing tests**

```ts
import { allocateBill, type GroupBucket } from "../lib/energy";

const tariff = { importCentsPerKwh: 27.83, supplyChargeCentsPerDay: 132.484, feedInCentsPerKwh: 5 };
const shares = { mainHouse: 4, nicki: 1 };
const base = { bucketSeconds: 1800, tariff, shares, daysElapsed: 0 };

// one 30-min bucket, importing: main 1000W, nicki 1000W, solar 400W -> net 1600W import
const importing: GroupBucket[] = [
  { tMs: 0, mainW: 1000, nickiW: 1000, solarW: 400, partial: false },
];
// one 30-min bucket, exporting: main 200W, nicki 100W, solar 1000W -> net -700W export
const exporting: GroupBucket[] = [
  { tMs: 0, mainW: 200, nickiW: 100, solarW: 1000, partial: false },
];

describe("allocateBill - proportional", () => {
  it("splits net import cost by each house's share of gross load", () => {
    const r = allocateBill(importing, { ...base, solarAllocation: "proportional" });
    const netKwh = 1600 * 1800 / 3_600_000; // 0.8
    // gross split is 50/50
    expect(r.mainHouse.importKwh).toBeCloseTo(netKwh / 2, 9);
    expect(r.mainHouse.importCost).toBeCloseTo((netKwh / 2) * 0.2783, 9);
    expect(r.nicki.importCost).toBeCloseTo((netKwh / 2) * 0.2783, 9);
    expect(r.gaps).toBe(0);
  });

  it("credits export at the feed-in rate, split 4:1", () => {
    const r = allocateBill(exporting, { ...base, solarAllocation: "proportional" });
    const exportKwh = 700 * 1800 / 3_600_000; // 0.35
    const credit = exportKwh * 0.05;
    expect(r.mainHouse.solarCreditShare).toBeCloseTo(-credit * 4 / 5, 9);
    expect(r.nicki.solarCreditShare).toBeCloseTo(-credit * 1 / 5, 9);
    expect(r.mainHouse.importCost).toBe(0);
  });
});

describe("allocateBill - mainHouseFirst", () => {
  it("solar offsets the main house before Nicki", () => {
    // main 1000, nicki 1000, solar 400 -> main_net 600, nicki_net 1000
    const r = allocateBill(importing, { ...base, solarAllocation: "mainHouseFirst" });
    expect(r.mainHouse.importKwh).toBeCloseTo(600 * 1800 / 3_600_000, 9);
    expect(r.nicki.importKwh).toBeCloseTo(1000 * 1800 / 3_600_000, 9);
  });

  it("spillover solar reaches Nicki once the main house is covered", () => {
    const bucket: GroupBucket[] = [{ tMs: 0, mainW: 300, nickiW: 800, solarW: 500, partial: false }];
    const r = allocateBill(bucket, { ...base, solarAllocation: "mainHouseFirst" });
    // main_net 0, solar_left 200, nicki_net 600
    expect(r.mainHouse.importKwh).toBe(0);
    expect(r.nicki.importKwh).toBeCloseTo(600 * 1800 / 3_600_000, 9);
  });
});

describe("allocateBill - supply charge and gaps", () => {
  it("prorates the supply charge 4:1 by days elapsed", () => {
    const r = allocateBill([], { ...base, daysElapsed: 10, solarAllocation: "proportional" });
    const total = 10 * 1.32484; // dollars
    expect(r.mainHouse.supplyChargeShare).toBeCloseTo(total * 4 / 5, 9);
    expect(r.nicki.supplyChargeShare).toBeCloseTo(total * 1 / 5, 9);
    expect(r.mainHouse.total).toBeCloseTo(total * 4 / 5, 9);
  });

  it("counts partial buckets as gaps", () => {
    const b: GroupBucket[] = [
      { tMs: 0, mainW: 100, nickiW: 0, solarW: 0, partial: true },
      { tMs: 1, mainW: 100, nickiW: 0, solarW: 0, partial: false },
    ];
    expect(allocateBill(b, { ...base, solarAllocation: "proportional" }).gaps).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/test/lib.energy.test.ts`
Expected: FAIL — `allocateBill` is not exported.

- [ ] **Step 3: Implement `allocateBill`**

```ts
export interface HouseholdBill {
  importKwh: number;
  importCost: number;       // dollars
  solarCreditShare: number; // dollars, <= 0
  supplyChargeShare: number;// dollars
  total: number;            // dollars
}
export interface BillResult { mainHouse: HouseholdBill; nicki: HouseholdBill; gaps: number; }

interface AllocateOpts {
  bucketSeconds: number;
  tariff: Tariff;
  shares: Shares;
  solarAllocation: SolarAllocation;
  daysElapsed: number;
}

export function allocateBill(buckets: GroupBucket[], opts: AllocateOpts): BillResult {
  const { bucketSeconds, tariff, shares, solarAllocation, daysElapsed } = opts;
  const importRate = tariff.importCentsPerKwh / 100;
  const fitRate = tariff.feedInCentsPerKwh / 100;
  const totalShares = shares.mainHouse + shares.nicki;

  const main = { importKwh: 0, importCost: 0, solarCreditShare: 0 };
  const nicki = { importKwh: 0, importCost: 0, solarCreditShare: 0 };
  let gaps = 0;

  for (const b of buckets) {
    if (b.partial) gaps++;
    const gross = b.mainW + b.nickiW;
    const netW = gross - b.solarW;

    if (netW >= 0) {
      const netKwh = integrateKwh(netW, bucketSeconds);
      if (solarAllocation === "proportional") {
        const mainShare = gross > 0 ? b.mainW / gross : 0.5;
        main.importKwh += netKwh * mainShare;
        nicki.importKwh += netKwh * (1 - mainShare);
      } else {
        const mainNetW = Math.max(0, b.mainW - b.solarW);
        const solarLeft = Math.max(0, b.solarW - b.mainW);
        const nickiNetW = Math.max(0, b.nickiW - solarLeft);
        main.importKwh += integrateKwh(mainNetW, bucketSeconds);
        nicki.importKwh += integrateKwh(nickiNetW, bucketSeconds);
      }
    } else {
      const exportKwh = integrateKwh(-netW, bucketSeconds);
      const credit = exportKwh * fitRate;
      main.solarCreditShare -= (credit * shares.mainHouse) / totalShares;
      nicki.solarCreditShare -= (credit * shares.nicki) / totalShares;
    }
  }

  main.importCost = main.importKwh * importRate;
  nicki.importCost = nicki.importKwh * importRate;

  const supplyTotal = (daysElapsed * tariff.supplyChargeCentsPerDay) / 100;
  const mainSupply = (supplyTotal * shares.mainHouse) / totalShares;
  const nickiSupply = (supplyTotal * shares.nicki) / totalShares;

  const finish = (h: typeof main, supply: number): HouseholdBill => ({
    ...h,
    supplyChargeShare: supply,
    total: h.importCost + h.solarCreditShare + supply,
  });

  return {
    mainHouse: finish(main, mainSupply),
    nicki: finish(nicki, nickiSupply),
    gaps,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/test/lib.energy.test.ts`
Expected: PASS (all energy tests, ~10).

- [ ] **Step 5: Commit**

```bash
git commit app/src/lib/energy.ts app/src/test/lib.energy.test.ts -m "feat: per-household bill allocation with two solar modes"
```

---

## Task 5: `config.ts`

**Files:**
- Create: `app/src/config.ts`
- Test: `app/src/test/config.test.ts`

**Interfaces:**
- Consumes: `FeedGroups`, `Tariff`, `Shares`, `SolarAllocation` from `lib/energy`.
- Produces: `export const config` with fields:
  `workerBaseUrl: string`, `timezone: string`, `feeds: FeedGroups`, `feedLabels: Record<number, string>`, `allFeedIds: number[]`, `tariff: Tariff`, `shares: Shares`, `solarAllocation: SolarAllocation`, `bucketSeconds: number`, `livePollMs: number`, `billRecomputeMs: number`, `todayRefreshMs: number`
- `workerBaseUrl` reads `import.meta.env.VITE_WORKER_URL` with a hardcoded production fallback (set for real in Task 15).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { config } from "../config";

describe("config", () => {
  it("lists all 10 feed ids across groups with labels", () => {
    expect(config.allFeedIds).toHaveLength(10);
    for (const id of config.allFeedIds) {
      expect(config.feedLabels[id]).toBeTruthy();
    }
  });
  it("groups Nicki and Solar separately from the main house", () => {
    expect(config.feeds.nicki).toEqual([545440]);
    expect(config.feeds.solar).toEqual([384753]);
    expect(config.feeds.main).not.toContain(545440);
  });
  it("carries the published tariff", () => {
    expect(config.tariff.importCentsPerKwh).toBe(27.83);
    expect(config.tariff.supplyChargeCentsPerDay).toBe(132.484);
    expect(config.tariff.feedInCentsPerKwh).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/test/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `config.ts`**

```ts
import type { FeedGroups, Tariff, Shares, SolarAllocation } from "./lib/energy";

const feeds: FeedGroups = {
  main: [384745, 384746, 384747, 384748, 384750, 384751, 384752, 384754],
  nicki: [545440],
  solar: [384753],
};

const feedLabels: Record<number, string> = {
  384745: "Light 1", 384746: "Power 1", 384747: "Light 2", 384748: "Power 2",
  384750: "Oven", 384751: "Hot water", 384752: "Air conditioner", 384754: "Pool",
  384753: "Solar", 545440: "Nicki",
};

const tariff: Tariff = {
  importCentsPerKwh: 27.83,
  supplyChargeCentsPerDay: 132.484,
  feedInCentsPerKwh: 5,
};

const shares: Shares = { mainHouse: 4, nicki: 1 };

export const config = {
  workerBaseUrl:
    (import.meta.env.VITE_WORKER_URL as string | undefined) ??
    "https://marburg-energy-proxy.CHANGE-ME.workers.dev",
  timezone: "Australia/Brisbane",
  feeds,
  feedLabels,
  allFeedIds: [...feeds.main, ...feeds.nicki, ...feeds.solar],
  tariff,
  shares,
  solarAllocation: "proportional" as SolarAllocation,
  bucketSeconds: 300,
  livePollMs: 10_000,
  billRecomputeMs: 180_000,
  todayRefreshMs: 300_000,
};
```
Note: the `CHANGE-ME` fallback is replaced with the real Worker subdomain in Task 15 — leaving it now is fine because dev uses `VITE_WORKER_URL`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/test/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git commit app/src/config.ts app/src/test/config.test.ts -m "feat: dashboard config (feeds, tariff, shares, intervals)"
```

---

## Task 6: Worker `/live` endpoint + CORS + whitelist

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/test/worker.test.ts`

**Interfaces:**
- Consumes: `FEED_IDS` from `worker/src/feeds.ts`.
- Produces: HTTP contract —
  - `OPTIONS *` → `204` with `Access-Control-Allow-Origin: <ALLOWED_ORIGIN>`, `Access-Control-Allow-Methods: GET, OPTIONS`
  - `GET /live` → `200`, body is emoncms `feed/fetch.json` output (JSON array of numbers), `Access-Control-Allow-Origin` set, `Cache-Control: public, s-maxage=10`
  - non-GET (except OPTIONS) → `405` JSON `{ error }`
  - unknown path → `404` JSON `{ error }`
  - upstream failure → `502` JSON `{ error }`

- [ ] **Step 1: Write the failing tests**

```ts
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index";

const ctx = () => createExecutionContext();

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[1,2,3]", { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("worker /live", () => {
  it("answers OPTIONS with CORS headers", async () => {
    const res = await worker.fetch(new Request("https://w/live", { method: "OPTIONS" }), env, ctx());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("proxies /live to emoncms feed/fetch and adds CORS + cache headers", async () => {
    const c = ctx();
    const res = await worker.fetch(new Request("https://w/live"), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([1, 2, 3]);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=10");
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain("emoncms.org/feed/fetch.json");
    expect(calledUrl).toContain("ids=384745");
    expect(calledUrl).toContain("apikey=test-key");
  });

  it("rejects POST with 405", async () => {
    const res = await worker.fetch(new Request("https://w/live", { method: "POST" }), env, ctx());
    expect(res.status).toBe(405);
  });

  it("returns 502 when upstream fails", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const c = ctx();
    const res = await worker.fetch(new Request("https://w/live"), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(502);
  });
});
```
Note: the cache path uses `caches.default`, which is available in the workers pool. If `cache.match` returns a stale hit across tests, add `?t=${Math.random()}` to the request URL per test or call `caches.default.delete` in `afterEach`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run`
Expected: FAIL — handler returns `{ok:true}` for everything.

- [ ] **Step 3: Implement the handler with `/live`**

```ts
import { FEED_IDS } from "./feeds";

export interface Env {
  EMONCMS_KEY: string;
  ALLOWED_ORIGIN: string;
}

const EMONCMS = "https://emoncms.org";

function cors(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

function jsonError(message: string, env: Env, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });
}

async function proxy(clientUrl: string, upstream: URL, env: Env, ctx: ExecutionContext, ttl: number): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(clientUrl); // key excludes the apikey we add below
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  upstream.searchParams.set("apikey", env.EMONCMS_KEY);
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream.toString(), { headers: { Accept: "application/json" } });
  } catch {
    return jsonError("upstream fetch failed", env, 502);
  }
  if (!upstreamRes.ok) return jsonError(`upstream ${upstreamRes.status}`, env, 502);

  const body = await upstreamRes.text();
  const res = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, s-maxage=${ttl}`,
      ...cors(env),
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors(env), "Access-Control-Allow-Headers": "Content-Type" },
      });
    }
    if (request.method !== "GET") return jsonError("method not allowed", env, 405);

    const url = new URL(request.url);

    if (url.pathname === "/live") {
      const upstream = new URL(`${EMONCMS}/feed/fetch.json`);
      upstream.searchParams.set("ids", FEED_IDS.join(","));
      return proxy(request.url, upstream, env, ctx, 10);
    }

    return jsonError("not found", env, 404);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git commit worker/src/index.ts worker/test/worker.test.ts -m "feat(worker): /live proxy with CORS, whitelist, edge cache"
```

---

## Task 7: Worker `/series` endpoint

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/test/worker.test.ts` (add a `describe`)

**Interfaces:**
- Consumes: `FEED_IDS`, `proxy`, `jsonError` from Task 6.
- Produces: HTTP contract —
  - `GET /series?ids=<csv>&start=<ms>&end=<ms>&interval=<s>` →
    - `400` if `ids`/`start`/`end` missing or range invalid or > 40 days
    - `403` if any `id` not in `FEED_IDS`
    - `200` proxying emoncms `feed/data.json` with `average=1`, `timeformat=unixms`, `interval` clamped to ≥ 60; `Cache-Control: public, s-maxage=60`
  - Response body shape: `[{ feedid: string, data: [number, number|null][] }, ...]`

- [ ] **Step 1: Write the failing tests**

```ts
describe("worker /series", () => {
  const q = "ids=384753&start=1788184800000&end=1788700000000&interval=300";

  it("proxies to feed/data.json forcing average=1 and unixms", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify([{ feedid: "384753", data: [[1788184800000, -100]] }]), { status: 200 }),
    );
    const c = ctx();
    const res = await worker.fetch(new Request(`https://w/series?${q}`), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(200);
    const calledUrl = (globalThis.fetch as any).mock.calls.at(-1)[0] as string;
    expect(calledUrl).toContain("feed/data.json");
    expect(calledUrl).toContain("average=1");
    expect(calledUrl).toContain("timeformat=unixms");
  });

  it("rejects an unknown feed id with 403", async () => {
    const res = await worker.fetch(
      new Request("https://w/series?ids=999999&start=1&end=2&interval=300"), env, ctx());
    expect(res.status).toBe(403);
  });

  it("rejects a range over 40 days with 400", async () => {
    const res = await worker.fetch(
      new Request(`https://w/series?ids=384753&start=0&end=${41 * 86400 * 1000}&interval=300`), env, ctx());
    expect(res.status).toBe(400);
  });

  it("rejects missing start/end with 400", async () => {
    const res = await worker.fetch(new Request("https://w/series?ids=384753"), env, ctx());
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd worker && npx vitest run`
Expected: FAIL — `/series` returns 404.

- [ ] **Step 3: Add the `/series` branch**

Insert before the final `return jsonError("not found", ...)`:
```ts
    if (url.pathname === "/series") {
      const idsRaw = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (idsRaw.length === 0 || !start || !end) return jsonError("ids, start, end required", env, 400);

      const allowed = new Set<number>(FEED_IDS as readonly number[]);
      if (!idsRaw.every((id) => allowed.has(Number(id)))) return jsonError("unknown feed id", env, 403);

      const startMs = Number(start);
      const endMs = Number(end);
      const span = endMs - startMs;
      if (!Number.isFinite(span) || span <= 0 || span > 40 * 86400 * 1000) {
        return jsonError("bad range", env, 400);
      }

      let interval = Number(url.searchParams.get("interval") ?? "300");
      if (!Number.isFinite(interval) || interval < 60) interval = 60;

      const upstream = new URL(`${EMONCMS}/feed/data.json`);
      upstream.searchParams.set("ids", idsRaw.join(","));
      upstream.searchParams.set("start", String(startMs));
      upstream.searchParams.set("end", String(endMs));
      upstream.searchParams.set("interval", String(interval));
      upstream.searchParams.set("average", "1");
      upstream.searchParams.set("timeformat", "unixms");
      return proxy(request.url, upstream, env, ctx, 60);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd worker && npx vitest run`
Expected: PASS (all worker tests, ~9).

- [ ] **Step 5: Manual smoke test against real emoncms**

Create `worker/.dev.vars` with `EMONCMS_KEY=<key>` (from `C:\Dropbox\EmonCmsApiKey.txt` — do not print it). Run `npx wrangler dev --port 8787`. In another shell:
```
curl -s "http://localhost:8787/live"
curl -s "http://localhost:8787/series?ids=384753&start=1788184800000&end=1788700000000&interval=1800" | head -c 200
```
Expected: array of numbers; then `[{"feedid":"384753","data":[[...]]}]`. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git commit worker/src/index.ts worker/test/worker.test.ts -m "feat(worker): /series history proxy with validation"
```

---

## Task 8: `api/worker.ts` — typed client

**Files:**
- Create: `app/src/api/worker.ts`
- Test: `app/src/test/api.worker.test.ts`

**Interfaces:**
- Consumes: `config.workerBaseUrl` (client passes base URL in, does not import config — keep testable), `MultiFeedSeries` from `lib/energy`.
- Produces:
  - `LiveValues = Record<number, number>` (feed id → current W)
  - `fetchLive(baseUrl: string, feedIds: number[], signal?: AbortSignal): Promise<LiveValues>`
  - `fetchSeries(baseUrl: string, params: { ids: number[]; startMs: number; endMs: number; intervalSeconds: number }, signal?: AbortSignal): Promise<MultiFeedSeries>`
  - `fetchLive` maps the positional `feed/fetch.json` array back onto `feedIds` by index.
  - Both throw `Error` with a useful message on non-2xx or network failure.
  - `fetchSeries` rounds `startMs`/`endMs` down/up to whole minutes so the Worker cache is reused between polls.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLive, fetchSeries } from "../api/worker";

afterEach(() => vi.unstubAllGlobals());

describe("fetchLive", () => {
  it("maps the positional array onto feed ids", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[10,20,30]", { status: 200 })));
    const v = await fetchLive("https://w", [1, 2, 3]);
    expect(v).toEqual({ 1: 10, 2: 20, 3: 30 });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 502 })));
    await expect(fetchLive("https://w", [1])).rejects.toThrow(/502/);
  });
});

describe("fetchSeries", () => {
  it("requests the series endpoint with minute-rounded bounds", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify([{ feedid: "1", data: [] }]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchSeries("https://w", { ids: [1, 2], startMs: 1788184801234, endMs: 1788184999999, intervalSeconds: 300 });
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("https://w/series?");
    expect(url).toContain("ids=1%2C2");
    expect(url).toContain("start=1788184800000"); // floored to minute
    expect(url).toContain("end=1788185040000");   // ceiled to minute
    expect(url).toContain("interval=300");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/test/api.worker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `api/worker.ts`**

```ts
import type { MultiFeedSeries } from "../lib/energy";

export type LiveValues = Record<number, number>;

const MINUTE = 60_000;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    throw new Error(`network error contacting proxy: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`proxy responded ${res.status}`);
  return res.json();
}

export async function fetchLive(baseUrl: string, feedIds: number[], signal?: AbortSignal): Promise<LiveValues> {
  const arr = (await getJson(`${baseUrl}/live`, signal)) as (number | null)[];
  const out: LiveValues = {};
  feedIds.forEach((id, i) => { out[id] = Number(arr[i] ?? 0); });
  return out;
}

export async function fetchSeries(
  baseUrl: string,
  params: { ids: number[]; startMs: number; endMs: number; intervalSeconds: number },
  signal?: AbortSignal,
): Promise<MultiFeedSeries> {
  const start = Math.floor(params.startMs / MINUTE) * MINUTE;
  const end = Math.ceil(params.endMs / MINUTE) * MINUTE;
  const qs = new URLSearchParams({
    ids: params.ids.join(","),
    start: String(start),
    end: String(end),
    interval: String(params.intervalSeconds),
  });
  return (await getJson(`${baseUrl}/series?${qs.toString()}`, signal)) as MultiFeedSeries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/test/api.worker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git commit app/src/api/worker.ts app/src/test/api.worker.test.ts -m "feat: typed worker API client"
```

---

## Task 9: `usePolledFetch` + `useLiveFeeds`

**Files:**
- Create: `app/src/hooks/usePolledFetch.ts`, `app/src/hooks/useLiveFeeds.ts`
- Test: `app/src/test/hooks.test.tsx`

**Interfaces:**
- Consumes: `fetchLive` from `api/worker`, `config` from `config`.
- Produces:
  - `AsyncState<T> = { data: T | null; error: string | null; loading: boolean; lastUpdated: number | null }`
  - `usePolledFetch<T>(loader: (signal: AbortSignal) => Promise<T>, intervalMs: number, deps: unknown[]): AsyncState<T>` — runs `loader` immediately and every `intervalMs`; aborts in-flight on unmount; keeps last good `data` when a later poll errors (sets `error` too).
  - `useLiveFeeds(): AsyncState<LiveValues>` — polls `fetchLive(config.workerBaseUrl, config.allFeedIds)` every `config.livePollMs`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePolledFetch } from "../hooks/usePolledFetch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("usePolledFetch", () => {
  it("loads immediately then again after the interval", async () => {
    const loader = vi.fn(async () => 42);
    const { result } = renderHook(() => usePolledFetch(loader, 1000, []));
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(loader).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps last good data but surfaces the error when a poll fails", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("ok")
      .mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => usePolledFetch(loader, 1000, []));
    await waitFor(() => expect(result.current.data).toBe("ok"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await waitFor(() => expect(result.current.error).toMatch(/boom/));
    expect(result.current.data).toBe("ok");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/test/hooks.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement both hooks**

`app/src/hooks/usePolledFetch.ts`:
```ts
import { useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastUpdated: number | null;
}

export function usePolledFetch<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null, error: null, loading: true, lastUpdated: null,
  });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const data = await loaderRef.current(controller.signal);
        if (!cancelled) setState({ data, error: null, loading: false, lastUpdated: Date.now() });
      } catch (e) {
        if (!cancelled && (e as Error).name !== "AbortError") {
          setState((s) => ({ ...s, error: (e as Error).message, loading: false }));
        }
      }
    };

    run();
    const timer = setInterval(run, intervalMs);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return state;
}
```

`app/src/hooks/useLiveFeeds.ts`:
```ts
import { config } from "../config";
import { fetchLive, type LiveValues } from "../api/worker";
import { usePolledFetch, type AsyncState } from "./usePolledFetch";

export function useLiveFeeds(): AsyncState<LiveValues> {
  return usePolledFetch<LiveValues>(
    (signal) => fetchLive(config.workerBaseUrl, config.allFeedIds, signal),
    config.livePollMs,
    [],
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/test/hooks.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git commit app/src/hooks/usePolledFetch.ts app/src/hooks/useLiveFeeds.ts app/src/test/hooks.test.tsx -m "feat: polled-fetch hook and useLiveFeeds"
```

---

## Task 10: `useSeries` — `useMonthData` + `useTodaySeries`

**Files:**
- Create: `app/src/hooks/useSeries.ts`
- Test: `app/src/test/hooks.test.tsx` (add a `describe`)

**Interfaces:**
- Consumes: `fetchSeries` from `api/worker`, `buildBuckets` from `lib/energy`, `monthStartMs` from `lib/time`, `config`, `usePolledFetch`.
- Produces:
  - `useMonthData(now?: Date): AsyncState<GroupBucket[]>` — buckets from `monthStartMs` to now at `config.bucketSeconds`, refreshed every `config.billRecomputeMs`. `now` param defaults to `new Date()` (injectable for tests).
  - `useTodaySeries(now?: Date): AsyncState<GroupBucket[]>` — buckets from local midnight to now at `config.bucketSeconds`, refreshed every `config.todayRefreshMs`.
  - Both fetch only `config.feeds.main + nicki + solar` ids.

- [ ] **Step 1: Write the failing test**

```ts
import { useMonthData } from "../hooks/useSeries";
import * as api from "../api/worker";

describe("useMonthData", () => {
  it("fetches month-to-date buckets and groups them", async () => {
    const spy = vi.spyOn(api, "fetchSeries").mockResolvedValue([
      { feedid: "384746", data: [[1788184800000, 1000]] }, // Power 1 (main)
      { feedid: "545440", data: [[1788184800000, 200]] },  // Nicki
      { feedid: "384753", data: [[1788184800000, -500]] }, // Solar
    ] as any);
    const now = new Date("2026-09-07T05:00:00Z");
    const { result } = renderHook(() => useMonthData(now));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(spy.mock.calls[0][1].startMs).toBe(Date.parse("2026-08-31T14:00:00Z"));
    const bucket = result.current.data![0];
    expect(bucket.nickiW).toBe(200);
    expect(bucket.solarW).toBe(500);
  });
});
```
(Use `vi.useRealTimers()` inside this `describe` or drive timers as in Task 9.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/test/hooks.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useSeries.ts`**

```ts
import { useMemo } from "react";
import { config } from "../config";
import { fetchSeries } from "../api/worker";
import { buildBuckets, type GroupBucket } from "../lib/energy";
import { monthStartMs, zonedTimeToUtcMs } from "../lib/time";
import { usePolledFetch, type AsyncState } from "./usePolledFetch";

const seriesIds = [...config.feeds.main, ...config.feeds.nicki, ...config.feeds.solar];

function useBucketRange(startMs: number, endMs: number, intervalMs: number): AsyncState<GroupBucket[]> {
  return usePolledFetch<GroupBucket[]>(
    async (signal) => {
      const series = await fetchSeries(
        config.workerBaseUrl,
        { ids: seriesIds, startMs, endMs, intervalSeconds: config.bucketSeconds },
        signal,
      );
      return buildBuckets(series, config.feeds);
    },
    intervalMs,
    [startMs],
  );
}

export function useMonthData(now: Date = new Date()): AsyncState<GroupBucket[]> {
  const start = useMemo(() => monthStartMs(now, config.timezone), [now]);
  return useBucketRange(start, now.getTime(), config.billRecomputeMs);
}

export function useTodaySeries(now: Date = new Date()): AsyncState<GroupBucket[]> {
  const start = useMemo(() => {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now).split("-").map(Number);
    return zonedTimeToUtcMs(key[0], key[1], key[2], 0, 0, 0, config.timezone);
  }, [now]);
  return useBucketRange(start, now.getTime(), config.todayRefreshMs);
}
```
Note: passing `now` as a fresh `Date()` on every render would thrash the memo; in `App.tsx` create it once with `useState(() => new Date())` and a slow refresh, or accept the `deps: [startMs]` guard (startMs only changes at midnight / month rollover) which already prevents refetch storms.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/test/hooks.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit app/src/hooks/useSeries.ts app/src/test/hooks.test.tsx -m "feat: useMonthData and useTodaySeries hooks"
```

---

## Task 11: `<LiveNow>` component

**Files:**
- Create: `app/src/components/Section.tsx`, `app/src/components/LiveNow.tsx`
- Test: `app/src/test/components.test.tsx`

**Interfaces:**
- Consumes: `useLiveFeeds`, `config`.
- Produces:
  - `<Section title error?>` — card wrapper; renders a red banner when `error` is set, still shows children.
  - `<LiveNow />` — self-contained (calls `useLiveFeeds`). Renders:
    - three headline figures: main house W (sum of `config.feeds.main`), Nicki W, Solar W (generation = `-solar` sum, shown as "generating"/"idle")
    - net figure with `data-state="importing" | "exporting"` and the W magnitude
    - a `<ul>` of every feed in `config.allFeedIds` with `config.feedLabels[id]` and current W
    - "data delayed" note when `lastUpdated` is older than 2 minutes

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as liveHook from "../hooks/useLiveFeeds";
import { LiveNow } from "../components/LiveNow";

function mockLive(values: Record<number, number>) {
  vi.spyOn(liveHook, "useLiveFeeds").mockReturnValue({
    data: values, error: null, loading: false, lastUpdated: Date.now(),
  });
}

describe("<LiveNow>", () => {
  it("shows per-circuit watts and the net import state", () => {
    mockLive({
      384745: 30, 384746: 500, 384747: 260, 384748: 140, 384750: 0,
      384751: 40, 384752: 25, 384754: 5, 384753: -300, 545440: 200,
    });
    render(<LiveNow />);
    expect(screen.getByText("Pool")).toBeInTheDocument();
    // main = 30+500+260+140+0+40+25+5 = 1000; nicki 200; solar 300 -> net 900 import
    expect(screen.getByTestId("net")).toHaveAttribute("data-state", "importing");
  });

  it("shows exporting when solar exceeds load", () => {
    mockLive({
      384745: 0, 384746: 0, 384747: 0, 384748: 0, 384750: 0,
      384751: 0, 384752: 0, 384754: 0, 384753: -4000, 545440: 100,
    });
    render(<LiveNow />);
    expect(screen.getByTestId("net")).toHaveAttribute("data-state", "exporting");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/test/components.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `Section.tsx` and `LiveNow.tsx`**

`Section.tsx`:
```tsx
import type { ReactNode } from "react";

export function Section({ title, error, children }: { title: string; error?: string | null; children: ReactNode }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      {children}
    </section>
  );
}
```

`LiveNow.tsx`:
```tsx
import { config } from "../config";
import { useLiveFeeds } from "../hooks/useLiveFeeds";
import { Section } from "./Section";

const sum = (v: Record<number, number>, ids: number[]) => ids.reduce((a, id) => a + (v[id] ?? 0), 0);
const w = (n: number) => `${Math.round(n).toLocaleString()} W`;

export function LiveNow() {
  const { data, error, lastUpdated } = useLiveFeeds();
  const v = data ?? {};
  const main = sum(v, config.feeds.main);
  const nicki = sum(v, config.feeds.nicki);
  const solarGen = -sum(v, config.feeds.solar);
  const net = main + nicki - solarGen;
  const stale = lastUpdated != null && Date.now() - lastUpdated > 120_000;

  return (
    <Section title="Right now" error={error}>
      {stale ? <p className="note">data delayed</p> : null}
      <div className="live-headline">
        <div><span className="label">Main house</span><strong>{w(main)}</strong></div>
        <div><span className="label">Nicki</span><strong>{w(nicki)}</strong></div>
        <div><span className="label">Solar</span><strong>{solarGen > 20 ? w(solarGen) : "idle"}</strong></div>
      </div>
      <p className="net" data-testid="net" data-state={net >= 0 ? "importing" : "exporting"}>
        {net >= 0 ? `Importing ${w(net)}` : `Exporting ${w(-net)}`}
      </p>
      <ul className="circuits">
        {config.allFeedIds.map((id) => (
          <li key={id}>
            <span>{config.feedLabels[id]}</span>
            <span>{w(id === config.feeds.solar[0] ? -(v[id] ?? 0) : (v[id] ?? 0))}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/test/components.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git commit app/src/components/Section.tsx app/src/components/LiveNow.tsx app/src/test/components.test.tsx -m "feat: LiveNow component with per-circuit readings"
```

---

## Task 12: `<EnergyChart>` component

**Files:**
- Create: `app/src/components/EnergyChart.tsx`, `app/src/lib/chart.ts`
- Test: `app/src/test/lib.chart.test.ts`, `app/src/test/components.test.tsx` (add a `describe`)

**Interfaces:**
- Consumes: `useTodaySeries`, `useMonthData`, `GroupBucket`, `integrateKwh`, `localDayKey`, `config`.
- Produces:
  - `lib/chart.ts`:
    - `toTodayPoints(buckets: GroupBucket[]): { t: number; main: number; nicki: number; solar: number }[]` — watts, `solar` positive
    - `toMonthDayPoints(buckets: GroupBucket[], bucketSeconds: number, timeZone: string): { day: string; netImportKwh: number }[]` — grouped by `localDayKey`, `netImportKwh` can be negative (export day)
  - `<EnergyChart />` — self-contained; a toggle with values `"today" | "month"`, initial value read from `localStorage["energychart.range"]` (default `"today"`), writes on change. Renders a Recharts `ResponsiveContainer`.

- [ ] **Step 1: Write the failing tests for `lib/chart.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toTodayPoints, toMonthDayPoints } from "../lib/chart";
import type { GroupBucket } from "../lib/energy";

const b = (tMs: number, mainW: number, nickiW: number, solarW: number): GroupBucket =>
  ({ tMs, mainW, nickiW, solarW, partial: false });

describe("toTodayPoints", () => {
  it("passes watts straight through with positive solar", () => {
    expect(toTodayPoints([b(1000, 500, 100, 300)])).toEqual([{ t: 1000, main: 500, nicki: 100, solar: 300 }]);
  });
});

describe("toMonthDayPoints", () => {
  it("sums net import per Brisbane day", () => {
    // both buckets on 2026-09-01 Brisbane; net = main+nicki-solar
    const start = Date.parse("2026-08-31T14:00:00Z");
    const pts = toMonthDayPoints(
      [b(start, 2000, 0, 0), b(start + 1800_000, 0, 0, 1000)],
      1800, "Australia/Brisbane",
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].day).toBe("2026-09-01");
    expect(pts[0].netImportKwh).toBeCloseTo((2000 * 1800 - 1000 * 1800) / 3_600_000, 6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run src/test/lib.chart.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/chart.ts`**

```ts
import { integrateKwh, type GroupBucket } from "./energy";
import { localDayKey } from "./time";

export function toTodayPoints(buckets: GroupBucket[]) {
  return buckets.map((b) => ({ t: b.tMs, main: b.mainW, nicki: b.nickiW, solar: b.solarW }));
}

export function toMonthDayPoints(buckets: GroupBucket[], bucketSeconds: number, timeZone: string) {
  const byDay = new Map<string, number>();
  for (const b of buckets) {
    const day = localDayKey(b.tMs, timeZone);
    const netW = b.mainW + b.nickiW - b.solarW;
    byDay.set(day, (byDay.get(day) ?? 0) + integrateKwh(netW, bucketSeconds));
  }
  return [...byDay.entries()].map(([day, netImportKwh]) => ({ day, netImportKwh }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run src/test/lib.chart.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the component test**

```ts
import { render, screen, fireEvent } from "@testing-library/react";
import * as todayHook from "../hooks/useSeries";
import { EnergyChart } from "../components/EnergyChart";

it("remembers the selected range in localStorage", () => {
  vi.spyOn(todayHook, "useTodaySeries").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
  vi.spyOn(todayHook, "useMonthData").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
  const { unmount } = render(<EnergyChart />);
  fireEvent.click(screen.getByRole("button", { name: /month/i }));
  expect(localStorage.getItem("energychart.range")).toBe("month");
  unmount();
  render(<EnergyChart />);
  expect(screen.getByRole("button", { name: /month/i })).toHaveAttribute("aria-pressed", "true");
});
```
Note: Recharts needs a sized container in jsdom. In `src/test/setup.ts` add a `ResizeObserver` polyfill and stub `HTMLElement.prototype.getBoundingClientRect` to return `{ width: 800, height: 300, ... }`, or wrap the chart in `<ResponsiveContainer width={800} height={300}>`. Simplest: give `ResponsiveContainer` explicit numeric `width`/`height` from a prop that defaults to `"100%"`/`300` and pass fixed numbers in the test. Document whichever you choose in `setup.ts`.

- [ ] **Step 6: Implement `EnergyChart.tsx`**

```tsx
import { useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { config } from "../config";
import { useTodaySeries, useMonthData } from "../hooks/useSeries";
import { toTodayPoints, toMonthDayPoints } from "../lib/chart";
import { Section } from "./Section";

type Range = "today" | "month";
const KEY = "energychart.range";
const initialRange = (): Range => {
  try { return localStorage.getItem(KEY) === "month" ? "month" : "today"; } catch { return "today"; }
};

export function EnergyChart() {
  const [range, setRange] = useState<Range>(initialRange);
  const today = useTodaySeries();
  const month = useMonthData();
  const choose = (r: Range) => { setRange(r); try { localStorage.setItem(KEY, r); } catch { /* ignore */ } };

  const err = range === "today" ? today.error : month.error;

  return (
    <Section title="Usage" error={err}>
      <div className="toggle" role="group">
        <button aria-pressed={range === "today"} onClick={() => choose("today")}>Today</button>
        <button aria-pressed={range === "month"} onClick={() => choose("month")}>This month</button>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        {range === "today" ? (
          <ComposedChart data={toTodayPoints(today.data ?? [])}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit" })} />
            <YAxis tickFormatter={(n) => `${Math.round(n / 100) / 10} kW`} />
            <Tooltip />
            <Area type="monotone" dataKey="main" stackId="load" stroke="#2563eb" fill="#93c5fd" name="Main house" />
            <Area type="monotone" dataKey="nicki" stackId="load" stroke="#7c3aed" fill="#c4b5fd" name="Nicki" />
            <Line type="monotone" dataKey="solar" stroke="#f59e0b" dot={false} name="Solar" />
          </ComposedChart>
        ) : (
          <ComposedChart data={toMonthDayPoints(month.data ?? [], config.bucketSeconds, config.timezone)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8)} />
            <YAxis tickFormatter={(n) => `${Math.round(n)} kWh`} />
            <Tooltip />
            <Bar dataKey="netImportKwh" fill="#2563eb" name="Net import (kWh)" />
          </ComposedChart>
        )}
      </ResponsiveContainer>
    </Section>
  );
}
```

- [ ] **Step 7: Run all app tests**

Run: `cd app && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 8: Commit**

```bash
git commit app/src/components/EnergyChart.tsx app/src/lib/chart.ts app/src/test/lib.chart.test.ts app/src/test/components.test.tsx app/src/test/setup.ts -m "feat: EnergyChart with today/month views and saved range"
```

---

## Task 13: `<BillSummary>` component

**Files:**
- Create: `app/src/components/BillSummary.tsx`
- Test: `app/src/test/components.test.tsx` (add a `describe`)

**Interfaces:**
- Consumes: `useMonthData`, `allocateBill`, `daysElapsedInMonth`, `monthLabel`, `config`.
- Produces: `<BillSummary />` — self-contained. Computes `allocateBill(buckets, { bucketSeconds: config.bucketSeconds, tariff: config.tariff, shares: config.shares, solarAllocation: config.solarAllocation, daysElapsed: daysElapsedInMonth(now, tz) })`. Renders two cards (`data-testid="bill-main"`, `data-testid="bill-nicki"`) each showing import kWh, import cost, solar credit, supply share, and total `$`. Shows `gaps` count and the "estimate" disclaimer + `monthLabel`.

- [ ] **Step 1: Write the failing test**

```ts
import * as seriesHook from "../hooks/useSeries";
import { BillSummary } from "../components/BillSummary";

it("renders a total for each household", () => {
  vi.spyOn(seriesHook, "useMonthData").mockReturnValue({
    data: [
      { tMs: Date.parse("2026-08-31T14:00:00Z"), mainW: 1000, nickiW: 500, solarW: 200, partial: false },
    ],
    error: null, loading: false, lastUpdated: Date.now(),
  });
  render(<BillSummary />);
  expect(screen.getByTestId("bill-main")).toHaveTextContent("$");
  expect(screen.getByTestId("bill-nicki")).toHaveTextContent("$");
  expect(screen.getByText(/estimate/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/test/components.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BillSummary.tsx`**

```tsx
import { config } from "../config";
import { useMonthData } from "../hooks/useSeries";
import { allocateBill, type HouseholdBill } from "../lib/energy";
import { daysElapsedInMonth, monthLabel } from "../lib/time";
import { Section } from "./Section";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

function Card({ testId, name, bill }: { testId: string; name: string; bill: HouseholdBill }) {
  return (
    <div className="bill-card" data-testid={testId}>
      <h3>{name}</h3>
      <dl>
        <div><dt>Imported</dt><dd>{bill.importKwh.toFixed(1)} kWh</dd></div>
        <div><dt>Usage cost</dt><dd>{money(bill.importCost)}</dd></div>
        <div><dt>Solar credit</dt><dd>{money(bill.solarCreditShare)}</dd></div>
        <div><dt>Supply charge</dt><dd>{money(bill.supplyChargeShare)}</dd></div>
        <div className="total"><dt>Running total</dt><dd>{money(bill.total)}</dd></div>
      </dl>
    </div>
  );
}

export function BillSummary() {
  const now = new Date();
  const { data, error } = useMonthData(now);
  const bill = allocateBill(data ?? [], {
    bucketSeconds: config.bucketSeconds,
    tariff: config.tariff,
    shares: config.shares,
    solarAllocation: config.solarAllocation,
    daysElapsed: daysElapsedInMonth(now, config.timezone),
  });

  return (
    <Section title={`Bill so far — ${monthLabel(now, config.timezone)}`} error={error}>
      <div className="bill-cards">
        <Card testId="bill-main" name="Main house" bill={bill.mainHouse} />
        <Card testId="bill-nicki" name="Nicki" bill={bill.nicki} />
      </div>
      <p className="note">
        Estimate only — excludes unmonitored loads
        {bill.gaps > 0 ? ` · ${bill.gaps} data gaps` : ""}. Rates: {config.tariff.importCentsPerKwh}c/kWh import,
        {" "}{config.tariff.supplyChargeCentsPerDay}c/day supply, {config.tariff.feedInCentsPerKwh}c/kWh feed-in.
        Supply charge &amp; solar income split {config.shares.mainHouse}:{config.shares.nicki}.
      </p>
    </Section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/test/components.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit app/src/components/BillSummary.tsx app/src/test/components.test.tsx -m "feat: BillSummary with per-household running totals"
```

---

## Task 14: `<App>` wiring + styling

**Files:**
- Modify: `app/src/App.tsx`, `app/src/index.css`
- Create: `app/src/App.css`
- Test: `app/src/test/components.test.tsx` (add an App smoke test)

**Interfaces:**
- Consumes: `LiveNow`, `EnergyChart`, `BillSummary`.
- Produces: `<App />` rendering the three sections in order inside a `<main className="app">` with a header.

- [ ] **Step 1: Write the failing test**

```ts
import App from "../App";
// mock all three hooks to return empty-but-valid state
it("renders all three sections", () => {
  vi.spyOn(require("../hooks/useLiveFeeds"), "useLiveFeeds").mockReturnValue({ data: {}, error: null, loading: false, lastUpdated: Date.now() });
  vi.spyOn(require("../hooks/useSeries"), "useTodaySeries").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
  vi.spyOn(require("../hooks/useSeries"), "useMonthData").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
  render(<App />);
  expect(screen.getByText("Right now")).toBeInTheDocument();
  expect(screen.getByText("Usage")).toBeInTheDocument();
  expect(screen.getByText(/Bill so far/)).toBeInTheDocument();
});
```
Note: prefer `vi.mock("../hooks/useSeries", ...)` with `importOriginal` if `require` isn't available under ESM; adjust to the project's module setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/test/components.test.tsx`
Expected: FAIL — App still says "Energy dashboard".

- [ ] **Step 3: Implement `App.tsx` + styling**

```tsx
import { LiveNow } from "./components/LiveNow";
import { EnergyChart } from "./components/EnergyChart";
import { BillSummary } from "./components/BillSummary";
import "./App.css";

export default function App() {
  return (
    <main className="app">
      <header><h1>Marburg Energy</h1></header>
      <LiveNow />
      <EnergyChart />
      <BillSummary />
    </main>
  );
}
```
`App.css` / `index.css`: mobile-first single column, `max-width: 640px` centered, card styling for `.section`, headline flex row, `.net[data-state="importing"]` red / `exporting` green, `.banner` red background, `.note` muted. Keep it under ~120 lines, no framework.

- [ ] **Step 4: Run test + full suite + typecheck + build**

Run: `cd app && npx vitest run && npm run build`
Expected: all tests PASS; `tsc -b` clean; `vite build` writes `dist/`.

- [ ] **Step 5: Manual end-to-end check with the real Worker**

Terminal A: `cd worker && npx wrangler dev --port 8787`
Terminal B: `cd app && echo 'VITE_WORKER_URL=http://localhost:8787' > .env.local && npm run dev`
Open the local URL. Confirm: live numbers populate and tick; toggling the chart persists across reload; bill cards show plausible dollar figures. Remove `.env.local` from staging (it's git-ignored via `*.local`).

- [ ] **Step 6: Commit**

```bash
git commit app/src/App.tsx app/src/App.css app/src/index.css app/src/test/components.test.tsx -m "feat: wire up dashboard layout and styling"
```

---

## Task 15: Deploy — GitHub Actions (Pages) + Worker + README

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `app/src/config.ts` (real Worker URL fallback), `worker/wrangler.jsonc` (real `ALLOWED_ORIGIN`), `README.md`

**Interfaces:**
- Consumes: a deployed Worker URL and the GitHub Pages URL.
- Produces: a live site at `https://flamage82.github.io/EnergyMonitor/` and a Worker at `https://marburg-energy-proxy.<subdomain>.workers.dev`.

- [ ] **Step 1: Deploy the Worker manually first**

```bash
cd worker
npx wrangler login
npx wrangler secret put EMONCMS_KEY   # paste the key from C:\Dropbox\EmonCmsApiKey.txt at the prompt
npx wrangler deploy
```
Record the deployed URL printed by Wrangler (e.g. `https://marburg-energy-proxy.flamage.workers.dev`).

- [ ] **Step 2: Set the real origins**

- `worker/wrangler.jsonc`: set `"vars": { "ALLOWED_ORIGIN": "https://flamage82.github.io" }`, then `npx wrangler deploy` again.
- `app/src/config.ts`: replace the `CHANGE-ME` fallback with the real Worker URL.

- [ ] **Step 3: Add the Pages workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy dashboard to Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - run: npm run test
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: app/dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Enable Pages + first deploy**

- Commit and push. In GitHub repo Settings → Pages, set Source = "GitHub Actions".
- Confirm the workflow run succeeds and the site loads at the Pages URL.
- Hit the live site; verify live data, chart, and bill all work against the deployed Worker (check the browser Network tab shows `200`s from the Worker and no CORS errors).

- [ ] **Step 5: Finish the README**

Fill the Deploy section: Worker (`wrangler login` / `secret put` / `deploy`, and the `ALLOWED_ORIGIN` var), Pages (Settings → Pages → GitHub Actions; workflow auto-runs on push). Document the `config.ts` knobs (tariff, `solarAllocation`, `bucketSeconds`, poll intervals) and that changing them needs a commit to redeploy. Note the key lives only in `C:\Dropbox\EmonCmsApiKey.txt` and as the Worker secret.

- [ ] **Step 6: Commit**

```bash
git commit .github/workflows/deploy.yml app/src/config.ts worker/wrangler.jsonc README.md -m "chore: Pages deploy workflow and production origins"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage check:** live per-circuit view (Task 11), today+month chart with saved range (Task 12), per-household bill net of solar with two allocation modes (Tasks 4, 13), Worker key custody + whitelist + CORS + cache (Tasks 6–7), no password (by omission), config-driven tariff/shares/timezone (Task 5), GitHub Pages + separate Worker (Tasks 1, 15), `average=1` enforced server-side (Task 7). All spec sections map to a task.
- **`solarAllocation`** default is `"proportional"` (Task 5); `"mainHouseFirst"` is fully implemented and tested (Task 4) so flipping the config value is the only change needed.
- **Timezone:** all month/day math goes through `lib/time.ts`; no bare `Date` component access on local time elsewhere.
- **Cache correctness:** the Worker cache key is built from the client URL *before* the `apikey` param is appended, so the key never enters the cache key or any stored response; the client rounds `start`/`end` to whole minutes so poll-to-poll requests are cache hits.
- **Naming consistency:** `GroupBucket` fields (`mainW`, `nickiW`, `solarW`, `partial`, `tMs`) are used identically in Tasks 3, 4, 10, 12, 13. `AsyncState<T>` shape is identical across Tasks 9, 10, 11, 12, 13. Worker response shapes match `MultiFeedSeries` / positional live array in Task 8.
