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
and `npm run test` (Vitest) for the unit tests.

`worker/`: run `npm install` once. Create a `worker/.dev.vars` file containing
`EMONCMS_KEY=<key>`, where the key is the read-only emoncms API key stored at
`C:\Dropbox\EmonCmsApiKey.txt`. Then run `npm run dev` to start `wrangler dev` on
http://localhost:8787. `npm run test` runs the Vitest suite in the workerd runtime via
`@cloudflare/vitest-pool-workers`, and `npm run types` regenerates the Worker binding
types.

## Deploy

Deployment instructions are filled in by Task 15. The app builds to `app/dist/` for
static hosting under `/EnergyMonitor/`, and the Worker deploys with `npm run deploy`
(`wrangler deploy`) once the production `EMONCMS_KEY` secret and `ALLOWED_ORIGIN` are
configured.
