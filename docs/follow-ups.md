# Post-merge follow-ups

Items deferred from the final whole-branch review of `feat/energy-dashboard`
(2026-09-07). The list below was worked through on `chore/post-merge-follow-ups`.

## Done

- **I8 — non-functional fallback Worker URL.** `app/src/config.ts` now falls back
  to `""`; `<App>` renders a "dashboard not configured" notice when
  `config.workerBaseUrl` is blank, and `app/vite.config.ts` throws on an unset
  `VITE_WORKER_URL` for `vite build` so a misconfigured deploy is a red CI run
  (CI's compile-check build passes a throwaway value).
- **I9 — duplicated effective-month-window calc.** Extracted
  `effectiveMonthWindow(now, timeZone, dataStartDate)` into `app/src/lib/time.ts`;
  `useSeries.ts` and `BillSummary.tsx` both call it. `daysElapsedInMonth` and its
  test are gone.
- **Dark-mode chart axes/grid.** Added `--chart-axis` / `--chart-grid` custom
  properties (both themes) and wired explicit `stroke` onto `<XAxis>` / `<YAxis>` /
  `<CartesianGrid>` plus a `<Legend>` `wrapperStyle` colour.
- **Dark-mode chart tooltip.** The `<Tooltip>` panels were still Recharts' hard-
  coded white; themed via a shared `tooltipProps` (`--card` / `--border` /
  `--text` / `--muted`, `--shadow`), `zIndex` to sit above the legend wrapper, and
  ink-coloured rows so the readout stays legible over both card surfaces.
- **Key in an `Authorization` header, not a query param.** The Worker now sends
  `Authorization: Bearer …` on the upstream request; no `apikey` in any URL.
- `buildBuckets` no longer emits `solarW: -0` (`-solar.sum || 0`).
- `allocateBill` guards `totalShares` against 0 (`|| 1`) and `AllocateOpts` is
  exported.
- `<EnergyChart>` range toggle has `aria-label="Chart range"`.
- `app/src/config.ts` validates the whole object with `satisfies AppConfig`.
- `bucketSeconds` for the month bill/chart is derived from the returned `tMs`
  deltas (`inferBucketSeconds`), not trusted from config.
- `README.md` — `dataStartDate` "safe to delete" wording corrected.
- `"engines": { "node": ">=22" }` added to both `package.json` files.
- App moved to vitest 3; the `overrides: { vite }` pin is gone. Both packages now
  share one vitest major.
- `act()` warnings from `hooks.test.tsx` fixed (the `afterEach` was running the
  hook's pending `setInterval` against an about-to-unmount component).
- App bundle: Recharts is split into its own `manualChunks` entry so an app-code
  edit doesn't bust its cache.
- Direct unit tests added for `useLiveFeeds` and `zonedTimeToUtcMs`.
- `<EnergyChart>` test describe got a `beforeEach(() => localStorage.clear())` to
  match its `afterEach`.
- First-month estimate note reworded for a household audience: "Excludes 1–6 Sept
  (before monitoring was reconfigured)."

## Still open (accepted)

- `now` is fixed at page load (`App.tsx` `useState(() => new Date())`). A tab left
  open across midnight / the month rollover won't advance the "today" / "this
  month" window until reload. Acceptable for the audience; revisit if it bites.
- **Bill month navigation.** The chart can page day/month
  (`feat/chart-day-navigation`); the bill still only shows the current
  month-to-date. Deferred until there's a completed prior month of data (Oct
  2026) to build and test historical proration against — `daysElapsed`, the
  "Bill so far" title and the pre-monitoring-days note all need past-month
  variants.
- The chart and the bill now each mount their own `useMonthData`; at the live
  edge (neither paged away) that's two identical current-month requests every
  `billRecomputeMs`. Fine at this app's cadence/traffic; the shared single poll
  in `App.tsx` was dropped because the two panels page independently.
