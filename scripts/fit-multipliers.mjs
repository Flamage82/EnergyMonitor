// Fit a per-circuit multiplier to the retailer's half-hourly data: which scale
// factor on each CT channel makes the monitor's net match the meter's?
//
//   node scripts/fit-multipliers.mjs <AGL MyUsageData csv>
//
// The retailer's import − export for a half-hour is the integral of net power
// over that slot, however the meter nets its phases, so it is linear in each
// circuit's energy:  agl_net = Σ k_i · E_i + c.  Ordinary least squares over
// every half-hour gives k_i (the multiplier) and c (constant unmetered load).
//
// Background and the Oct 2026 findings: docs/metering-accuracy.md

import { readFileSync } from "node:fs";

const WORKER = process.env.WORKER_URL
  ?? "https://marburg-energy-proxy.bytecreep.workers.dev";
const ORIGIN = "https://flamage82.github.io";

// Feed topology, from app/src/config.ts. The solar feed reads NEGATIVE when
// generating, so net grid power is the plain sum of every feed.
const FEEDS = [
  { id: 384745, name: "Light 1", phase: "A" },
  { id: 384746, name: "Power 1", phase: "A" },
  { id: 384747, name: "Light 2", phase: "A" },
  { id: 384748, name: "Power 2", phase: "A" },
  { id: 384750, name: "Oven", phase: "A" },
  { id: 384751, name: "Water treatment", phase: "A" },
  { id: 384752, name: "Air conditioner", phase: "C" },
  { id: 384754, name: "Pool", phase: "C" },
  { id: 384753, name: "Solar", phase: "C" },
  { id: 545440, name: "Nicki", phase: "B" },
];
const SOLAR = 384753, WATER = 384751;

// The candidate fix scored against the free fit: every phase-C channel ×2.
const PROPOSED = { 384752: 2, 384754: 2, 384753: 2 };

const BRISBANE_OFFSET_MS = 10 * 3600 * 1000; // Queensland has no DST
const at = (s) => Date.parse(`${s}:00+10:00`);
// Before 8 Sep 2026 the monitor missed 1.5–2 kW of load (Nicki's feed began
// 7 Sep and the setup changed with it), so earlier data can't calibrate today's.
const FIRST_USABLE = at("2026-09-08T00:00");

// Scaling already baked into the logged values (the emoncms output formula),
// so each feed can be normalised back to its raw ×1 reading before fitting.
// Read off the data: the solar clipping plateau and the Water channel's
// overnight baseline. The app's `config.calibration` mirrors this timeline.
const DEVICE = [
  { from: at("2026-09-08T00:00"), mult: { [SOLAR]: 2 } },               // solar on C ×2
  { from: at("2026-09-28T12:30"), skip: true },                         // C−A test, reconfiguring
  { from: at("2026-09-28T13:30"), mult: { [WATER]: 2 } },               // ×2 landed on Water; solar plain C
  { from: at("2026-10-04T10:30"), skip: true },                         // second C−A test
  { from: at("2026-10-04T13:30"), mult: {} },                           // everything ×1
  { from: at("2026-10-07T09:29"), mult: { 384752: 2, 384754: 2, [SOLAR]: 2 } }, // outputs ×2 phase C
];
function deviceAt(t) {
  let cur = null;
  for (const d of DEVICE) if (t >= d.from) cur = d;
  return cur;
}

// ---------------------------------------------------------------------------

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("usage: node scripts/fit-multipliers.mjs <AGL MyUsageData csv>");
  process.exit(1);
}

// AGL rows: ...,RateTypeDescription,StartDate,EndDate,ProfileReadValue,...
// "Generalusage" is import, "Solar" is export; StartDate is dd/mm/yyyy local.
function parseAglTime(s) {
  const m = s.match(/^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):\d\d ([AP])M$/);
  if (!m) throw new Error(`unrecognised AGL date: ${s}`);
  const h = (Number(m[4]) % 12) + (m[6] === "P" ? 12 : 0);
  return Date.UTC(+m[3], +m[2] - 1, +m[1], h, +m[5]) - BRISBANE_OFFSET_MS;
}
const agl = new Map(); // slot start ms -> net kWh
for (const line of readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1)) {
  const f = line.split(",");
  const t = parseAglTime(f[6]);
  const kwh = Number(f[8]) * (f[5] === "Generalusage" ? 1 : -1);
  agl.set(t, (agl.get(t) ?? 0) + kwh);
}
const aglEnd = Math.max(...agl.keys()) + 1800e3;

async function fetchSeries(start, end) {
  const u = new URL(`${WORKER}/series`);
  u.searchParams.set("ids", FEEDS.map((f) => f.id).join(","));
  u.searchParams.set("start", String(start));
  u.searchParams.set("end", String(end));
  u.searchParams.set("interval", "1800");
  const res = await fetch(u, { headers: { Origin: ORIGIN } });
  if (!res.ok) throw new Error(`series -> ${res.status} ${await res.text()}`);
  return res.json(); // [{ feedid, data: [[ms, W|null], ...] }] — sorted by id, not request order
}

// Join: one row per half-hour with every feed present, normalised to raw ×1 kWh.
const rows = [];
for (let s = FIRST_USABLE; s < aglEnd; s += 30 * 86400e3) {
  const e = Math.min(s + 30 * 86400e3, aglEnd);
  const byId = new Map((await fetchSeries(s, e)).map((x) => [Number(x.feedid), x.data]));
  const n = byId.get(FEEDS[0].id).length;
  for (let i = 0; i < n; i++) {
    const t = byId.get(FEEDS[0].id)[i][0];
    const dev = deviceAt(t);
    if (t < s || t >= e || !agl.has(t) || !dev || dev.skip) continue;
    const kwh = {};
    let complete = true;
    for (const { id } of FEEDS) {
      const w = byId.get(id)?.[i]?.[1];
      if (w == null) { complete = false; break; }
      kwh[id] = (w * 0.5) / 1000 / (dev.mult[id] ?? 1);
    }
    if (complete) {
      rows.push({ t, day: new Date(t + BRISBANE_OFFSET_MS).toISOString().slice(0, 10), net: agl.get(t), kwh });
    }
  }
}
if (rows.length < 100) {
  console.error(`only ${rows.length} usable half-hours — need data after ${new Date(FIRST_USABLE).toISOString()}`);
  process.exit(1);
}

// --- least squares ----------------------------------------------------------

function solve(A, b) { // Gauss-Jordan with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

function ols(X, y) {
  const p = X[0].length, n = y.length;
  const XtX = Array.from({ length: p }, () => Array(p).fill(0)), Xty = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const coef = solve(XtX, Xty);
  const resid = y.map((v, i) => v - X[i].reduce((s, x, a) => s + x * coef[a], 0));
  const sse = resid.reduce((s, r) => s + r * r, 0);
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const s2 = sse / (n - p);
  const se = coef.map((_, a) => Math.sqrt(s2 * solve(XtX, XtX.map((__, i) => (i === a ? 1 : 0)))[a]));
  return { coef, se, rms: Math.sqrt(sse / n), r2: 1 - sse / sst };
}

const wh = (kwh) => `${(kwh * 1000).toFixed(0)} Wh`;
const span = `${rows[0].day} → ${rows.at(-1).day}`;
console.log(`\n${rows.length} half-hours, ${span} (config-change windows excluded)`);

// 1. Every channel free, plus a constant.
const free = ols(rows.map((r) => [...FEEDS.map((f) => r.kwh[f.id]), 1]), rows.map((r) => r.net));
console.log(`\nFitted multiplier per channel (slot RMS ${wh(free.rms)}, R² ${free.r2.toFixed(4)})`);
console.log("channel             phase  multiplier");
FEEDS.forEach((f, a) => {
  console.log(`  ${f.name.padEnd(18)} ${f.phase}    ${free.coef[a].toFixed(3).padStart(6)} ± ${free.se[a].toFixed(3)}`);
});
console.log(`  ${"constant".padEnd(18)}      ${(free.coef.at(-1) * 2000).toFixed(0).padStart(6)} W`);
console.log("  (Water treatment is a near-constant load, so it trades off against the\n" +
  "   constant and its multiplier is poorly determined.)");

// 2. The proposed fixed multipliers vs as-logged, slot and day level.
const scaled = (r, mult) => FEEDS.reduce((s, f) => s + r.kwh[f.id] * (mult[f.id] ?? 1), 0);
const days = [...new Set(rows.map((r) => r.day))];
function score(mult) {
  const res = rows.map((r) => r.net - scaled(r, mult));
  const daily = days.map((d) => {
    const rs = rows.filter((r) => r.day === d);
    if (rs.length < 48) return null; // a partial day hides config windows
    const a = rs.reduce((s, r) => s + r.net, 0), m = rs.reduce((s, r) => s + scaled(r, mult), 0);
    return { d, agl: a, mon: m };
  }).filter(Boolean);
  return { rms: Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length), daily };
}
const label = (mult) => Object.keys(mult).length
  ? Object.entries(mult).map(([id, k]) => `${FEEDS.find((f) => f.id === Number(id)).name} ×${k}`).join(", ")
  : "raw (every channel ×1, device multipliers removed)";
for (const mult of [{}, PROPOSED]) {
  const { rms, daily } = score(mult);
  const errs = daily.map((x) => Math.abs(x.mon - x.agl));
  console.log(`\n${label(mult)}\n  slot RMS ${wh(rms)}; daily net |error| mean ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(2)} kWh, max ${Math.max(...errs).toFixed(2)} kWh over ${daily.length} full days`);
  if (mult === PROPOSED) {
    for (const x of daily) {
      const e = x.mon - x.agl;
      console.log(`    ${x.d}  AGL net ${x.agl.toFixed(2).padStart(6)}  monitor ${x.mon.toFixed(2).padStart(6)}  ${e >= 0 ? "+" : ""}${e.toFixed(2)}`);
    }
  }
}

// 3. Leave-one-day-out: does the free fit beat the fixed multipliers on unseen days?
let sseFree = 0, sseFixed = 0;
for (const d of days) {
  const train = rows.filter((r) => r.day !== d), test = rows.filter((r) => r.day === d);
  const { coef } = ols(train.map((r) => [...FEEDS.map((f) => r.kwh[f.id]), 1]), train.map((r) => r.net));
  for (const r of test) {
    sseFree += (r.net - [...FEEDS.map((f) => r.kwh[f.id]), 1].reduce((s, x, a) => s + x * coef[a], 0)) ** 2;
    sseFixed += (r.net - scaled(r, PROPOSED)) ** 2;
  }
}
console.log(`\nLeave-one-day-out slot RMS: free fit ${wh(Math.sqrt(sseFree / rows.length))}, ` +
  `proposed fixed ${wh(Math.sqrt(sseFixed / rows.length))}`);
