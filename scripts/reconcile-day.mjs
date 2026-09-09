// Reconcile the monitor's import/export for one local day against the retailer's
// figures, at several bucket sizes, to separate bucketing loss from hardware
// (CT coverage / calibration) error.
//
//   node scripts/reconcile-day.mjs <YYYY-MM-DD> [providerImportKwh] [providerExportKwh]
//   node scripts/reconcile-day.mjs 2026-09-08 29.58 7.13
//
// Background and the 8 Sep 2026 findings: docs/metering-accuracy.md

const WORKER = process.env.WORKER_URL
  ?? "https://marburg-energy-proxy.bytecreep.workers.dev";
// The Worker only serves this origin; it ignores the header value beyond that.
const ORIGIN = "https://flamage82.github.io";

// Feed topology, from app/src/config.ts. The solar feed reads NEGATIVE when
// generating, so net grid power is the plain sum of every raw feed value.
const MAIN = [384745, 384746, 384747, 384748, 384750, 384751, 384752, 384754];
const NICKI = [545440];
const SOLAR = 384753;
const ALL = [...MAIN, ...NICKI, SOLAR];
const LABELS = {
  384745: "Light 1", 384746: "Power 1", 384747: "Light 2", 384748: "Power 2",
  384750: "Oven", 384751: "Water treatment", 384752: "Air conditioner",
  384754: "Pool", 384753: "Solar", 545440: "Nicki",
};
// Queensland has no DST — Brisbane is UTC+10 all year.
const BRISBANE_OFFSET_MS = 10 * 3600 * 1000;
const BUCKET_SIZES = [60, 300, 900, 1800];

const [day, provImport, provExport] = process.argv.slice(2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) {
  console.error("usage: node scripts/reconcile-day.mjs <YYYY-MM-DD> [provImportKwh] [provExportKwh]");
  process.exit(1);
}
const START = Date.parse(`${day}T00:00:00Z`) - BRISBANE_OFFSET_MS;
const END = START + 86400_000;
const provider = provImport != null
  ? { importKwh: Number(provImport), exportKwh: Number(provExport) }
  : null;

async function fetchSeries(interval) {
  const u = new URL(`${WORKER}/series`);
  u.searchParams.set("ids", ALL.join(","));
  u.searchParams.set("start", String(START));
  u.searchParams.set("end", String(END));
  u.searchParams.set("interval", String(interval));
  const res = await fetch(u, { headers: { Origin: ORIGIN } });
  if (!res.ok) throw new Error(`series ${interval}s -> ${res.status} ${await res.text()}`);
  return res.json(); // [{ feedid, data: [[ms, val|null], ...] }]
}

function analyse(series, interval) {
  const byId = new Map(series.map((s) => [Number(s.feedid), s.data]));
  const n = byId.get(ALL[0])?.length ?? 0;
  const dtHours = interval / 3600;

  let importKwh = 0, exportKwh = 0, netSignedKwh = 0, bucketsWithNull = 0;
  const nullByFeed = Object.fromEntries(ALL.map((id) => [id, 0]));
  const energyByFeed = Object.fromEntries(ALL.map((id) => [id, 0]));

  for (let i = 0; i < n; i++) {
    let net = 0, anyNull = false;
    for (const id of ALL) {
      const v = byId.get(id)?.[i]?.[1];
      if (v == null) { anyNull = true; nullByFeed[id]++; continue; }
      net += v;
      energyByFeed[id] += (v * dtHours) / 1000;
    }
    if (anyNull) bucketsWithNull++;
    netSignedKwh += (net * dtHours) / 1000;
    if (net >= 0) importKwh += (net * dtHours) / 1000;
    else exportKwh += (-net * dtHours) / 1000;
  }
  return { interval, buckets: n, bucketsWithNull, nullByFeed, energyByFeed,
    importKwh, exportKwh, netSignedKwh };
}

const vs = (a, b) => (b == null ? "" : ` (${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%)`);

const runs = [];
for (const interval of BUCKET_SIZES) {
  try { runs.push(analyse(await fetchSeries(interval), interval)); }
  catch (e) { console.error(String(e)); }
}

console.log(`\n${day} (Australia/Brisbane)  ${new Date(START).toISOString()} .. ${new Date(END).toISOString()}`);
if (provider) console.log(`Provider:  import ${provider.importKwh} kWh   export ${provider.exportKwh} kWh`);
console.log("\nbucket │ import kWh          │ export kWh          │ signed-net kWh │ null buckets");
console.log("───────┼────────────────────┼────────────────────┼────────────────┼─────────────");
for (const r of runs) {
  console.log(
    `${String(r.interval).padStart(5)}s │ ${r.importKwh.toFixed(2).padStart(7)}${vs(r.importKwh, provider?.importKwh).padEnd(10)} │ ` +
    `${r.exportKwh.toFixed(2).padStart(7)}${vs(r.exportKwh, provider?.exportKwh).padEnd(10)} │ ` +
    `${r.netSignedKwh.toFixed(2).padStart(14)} │ ${String(r.bucketsWithNull).padStart(11)}`,
  );
}

const fine = runs[0];
if (fine) {
  const nulls = Object.entries(fine.nullByFeed).filter(([, c]) => c > 0);
  console.log(nulls.length
    ? `\nNull samples (${fine.interval}s): ${nulls.map(([id, c]) => `${LABELS[id]} ${c}`).join(", ")}`
    : `\nNo null samples on any feed (${fine.interval}s).`);
  console.log(`\nPer-feed energy over the day (${fine.interval}s buckets):`);
  for (const id of ALL) {
    console.log(`  ${LABELS[id].padEnd(18)} ${fine.energyByFeed[id].toFixed(2).padStart(8)} kWh`);
  }
  const load = [...MAIN, ...NICKI].reduce((a, id) => a + fine.energyByFeed[id], 0);
  console.log(`\n  Total measured load   ${load.toFixed(2)} kWh`);
  console.log(`  Total measured solar  ${(-fine.energyByFeed[SOLAR]).toFixed(2)} kWh`);
  if (provider) {
    const trueNet = provider.importKwh - provider.exportKwh;
    console.log(`\n  Provider signed net   ${trueNet.toFixed(2)} kWh`);
    console.log(`  Monitor signed net    ${fine.netSignedKwh.toFixed(2)} kWh  (${(fine.netSignedKwh - trueNet).toFixed(2)} kWh, ${(((fine.netSignedKwh - trueNet) / trueNet) * 100).toFixed(1)}%)`);
  }
}
