# Marburg Energy Dashboard

## Overview

A dashboard for visualising energy data from the Marburg site's emoncms feeds. The
project is split into two packages: `app/` is a Vite + React 19 + TypeScript single-page
app that renders the charts and is deployed as a static site under the `/EnergyMonitor/`
base path, and `worker/` is a Cloudflare Worker that proxies requests to the emoncms API
so the read API key is never exposed to the browser and CORS is handled in one place.
Pure data-transform libraries, the Worker proxy logic, React data hooks, and the chart
components are built on top of this scaffold in later tasks.

## Local development

`app/`: run `npm install` once, then `npm run dev` to start the Vite dev server on
http://localhost:5173. Use `npm run build` for a production build (`tsc -b && vite build`)
and `npm run test` (Vitest) for the unit tests. By default the dev app talks to the
deployed Worker (the fallback URL in `app/src/config.ts`); set `VITE_WORKER_URL` in
`app/.env.local` to point at a different Worker.

`worker/`: run `npm install` once. Create a `worker/.dev.vars` file containing
`EMONCMS_KEY=<key>`, where the key is the read-only emoncms API key stored at
`C:\Dropbox\EmonCmsApiKey.txt`. Then run `npm run dev` to start `wrangler dev` on
http://localhost:8787. `npm run test` runs the Vitest suite in the workerd runtime via
`@cloudflare/vitest-pool-workers`, and `npm run types` regenerates the Worker binding
types.

`ALLOWED_ORIGIN` gotcha: `worker/wrangler.jsonc` sets `ALLOWED_ORIGIN` to the production
Pages origin (`https://flamage82.github.io`), so a locally-run `wrangler dev` Worker
will CORS-block requests from `npm run dev` (http://localhost:5173). To test the app
against a local Worker, add this line to `worker/.dev.vars` (it overrides
`wrangler.jsonc` vars and is git-ignored):

```
# ALLOWED_ORIGIN=http://localhost:5173
```

Otherwise just run the app against the deployed Worker (the default).

## Deploy

The app is served by GitHub Pages at https://flamage82.github.io/EnergyMonitor/ and
built by the `Deploy dashboard to Pages` GitHub Actions workflow
(`.github/workflows/deploy.yml`) on every push to `main`. The Worker is deployed
separately with Wrangler. The emoncms key lives only in `C:\Dropbox\EmonCmsApiKey.txt`
and as the Cloudflare Worker secret `EMONCMS_KEY` — it is never committed and never
reaches the browser.

### One-time setup

1. **Cloudflare — deploy the Worker.**

   ```
   cd worker
   npx wrangler login              # opens a browser to authorise
   npx wrangler secret put EMONCMS_KEY   # paste the key from C:\Dropbox\EmonCmsApiKey.txt at the prompt
   npx wrangler deploy
   ```

   Copy the URL Wrangler prints, e.g. `https://marburg-energy-proxy.<subdomain>.workers.dev`.

2. **GitHub — set the Worker URL variable.** Repo **Settings → Secrets and variables →
   Actions → Variables → New repository variable**. Name `WORKER_URL`, value = the
   Worker URL from step 1. The build injects it as `VITE_WORKER_URL`; if it is unset
   the build falls back to the literal in `app/src/config.ts`.

3. **GitHub — enable Pages.** Repo **Settings → Pages → Build and deployment → Source
   → GitHub Actions**.

4. **Go live.** Merge `feat/energy-dashboard` → `main`. The `Deploy dashboard to Pages`
   workflow runs automatically and the site goes live at
   https://flamage82.github.io/EnergyMonitor/. After the first deploy, check the
   browser Network tab on the live site shows `200`s from the Worker and no CORS
   errors.

### Updates

- **App changes:** push to `main` → the workflow rebuilds and redeploys.
- **Worker changes:** `cd worker && npx wrangler deploy`.
- **Rate / config changes:** edit `app/src/config.ts`, then push to `main` to redeploy.

### Config knobs (`app/src/config.ts`)

- `tariff` — `importCentsPerKwh`, `supplyChargeCentsPerDay`, `feedInCentsPerKwh`.
- `shares` — household split for shared costs (currently `{ mainHouse: 4, nicki: 1 }`, a 4:1 split).
- `solarAllocation` — `"proportional"` (default) or `"mainHouseFirst"`.
- `bucketSeconds` — chart aggregation bucket size (currently 300).
- `livePollMs`, `billRecomputeMs`, `todayRefreshMs` — poll / refresh intervals.
- `dataStartDate` — data floor for the month-to-date bill and "this month" chart;
  set to the feed-reconfiguration date, and safe to delete after 2026-09.

Changing any of these requires a commit to `main` to take effect on the live site.
