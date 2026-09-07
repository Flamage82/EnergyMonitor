# Post-merge follow-ups

Items deferred from the final whole-branch review of `feat/energy-dashboard`
(2026-09-07). None block the dashboard working; they harden it and tidy it.

## Worth doing soon

- **I8 — non-functional fallback Worker URL.** `app/src/config.ts` falls back to
  `https://marburg-energy-proxy.example.workers.dev` when `VITE_WORKER_URL` is
  unset. `example` is a registrable Cloudflare subdomain, not a reserved name, so
  an unset `WORKER_URL` repo variable sends the public site's GETs to a third
  party. Fix: fall back to `""` and have `<App>` render a "dashboard not
  configured" message when `config.workerBaseUrl` is blank; optionally
  `if (!process.env.VITE_WORKER_URL) throw` in `vite.config.ts` for production
  builds so a misconfigured deploy is a red CI run.

- **I9 — the effective-month-window calc is duplicated.** `Math.max(monthStartMs,
  localDateStartMs(dataStartDate))` appears in both `app/src/hooks/useSeries.ts`
  (which buckets are fetched) and `app/src/components/BillSummary.tsx` (the
  supply-charge window). If one is edited alone the bill charges supply for a
  period it has no usage data for. Extract one helper:
  ```ts
  // lib/time.ts
  export function effectiveMonthWindow(now, timeZone, dataStartDate) {
    const startMs = Math.max(monthStartMs(now, timeZone), localDateStartMs(dataStartDate, timeZone));
    return { startMs, daysElapsed: (now.getTime() - startMs) / 86_400_000 };
  }
  ```
  Call it from both sites; delete the now-dead `daysElapsedInMonth` and its test.

- **Dark-mode chart axes/grid.** The series colours now come from theme-aware
  `--chart-*` custom properties in `App.css` (done 2026-09-07), but Recharts'
  default axis/grid/tick strokes are still dark grey — in the
  `prefers-color-scheme: dark` theme (which `App.css` fully implements) the axes
  and tick labels are near-invisible. Add explicit `stroke` (from a `--chart-axis`
  / `--chart-grid` custom property) to `<XAxis>` / `<YAxis>` / `<CartesianGrid>`
  and a `<Legend>` wrapperStyle colour.

## Nice to have

- **Key in an `Authorization` header, not a query param.** The Worker sends
  `?apikey=` on the upstream request; Cloudflare records subrequest URLs, so the
  key would appear in `wrangler tail` and in Workers Logs / Logpush if ever
  enabled. Switch to `headers: { Authorization: \`Bearer ${env.EMONCMS_KEY}\` }`
  (verified to work against emoncms.org during design).
- `app/src/lib/energy.ts` — `buildBuckets` can emit `solarW: -0` when the solar
  feeds sum to exactly 0. Harmless today; `-solar.sum || 0` fixes it and stops
  surprising `toEqual` assertions.
- `app/src/lib/energy.ts` — guard `totalShares` against 0 (`|| 1`), and `export`
  the `AllocateOpts` type.
- `app/src/components/EnergyChart.tsx` — the range toggle `role="group"` has no
  accessible name; add `aria-label="Chart range"`.
- `app/src/config.ts` — use `satisfies AppConfig` instead of the
  `as SolarAllocation` cast, so the whole object is validated.
- Derive `bucketSeconds` from the returned `tMs` deltas rather than trusting the
  config value, so a config/emoncms-rounding mismatch can't silently scale every
  kWh figure.
- `README.md` — "safe to delete after 2026-09" for `dataStartDate` is inaccurate;
  removing the key needs edits to `useSeries.ts` and `BillSummary.tsx`. It simply
  stops having any effect once the billing month starts after it.
- Add `"engines": { "node": ">=22" }` to both `package.json` files.
- `app/package.json` `overrides: { vite }` — remove once the app moves to
  vitest 3 (matching the worker), so both packages share one vitest major.
- Investigate/mute the `act()` warnings from `hooks.test.tsx` so the test output
  is pristine again.
- `app` bundle is ~605 kB (181 kB gzip), almost all Recharts — consider
  `manualChunks` or a lighter chart lib if tablet load time matters.
- Add direct unit tests for `useLiveFeeds` and `zonedTimeToUtcMs` (both are only
  covered transitively today).
- `<EnergyChart>` test describe: add a `beforeEach(() => localStorage.clear())`
  to match its `afterEach`, so its isolation is order-independent.

## Product / disclosure

- The first-month estimate is structurally low: supply charge is prorated from
  2026-09-07 (the data floor) while the retailer bills from 2026-09-01 — roughly
  $8 unaccounted for September. The note discloses the window ("Covers 2026-09-07
  onwards") but consider wording it in plainer terms for a household audience,
  e.g. "excludes 1–6 Sep (before monitoring was reconfigured)".
- `now` is fixed at page load (`App.tsx` `useState(() => new Date())`). A tab left
  open across midnight / the month rollover won't advance the "today" / "this
  month" window until reload. Acceptable for the audience; revisit if it bites.
