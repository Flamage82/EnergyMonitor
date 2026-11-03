import type {
  FeedGroups, GridFeeds, LoadGroup, Tariff, Shares, SolarAllocation,
} from "./lib/energy";
import type { Calibration, UnmeteredStep } from "./lib/calibration";

// How the supply charge, solar income and shared circuits are divided.
const shares: Shares = { mainHouse: 5, nicki: 1 };

const feeds = {
  main: [384745, 384746, 384747, 384748, 384750, 384752, 384754],
  nicki: [545440],
  solar: [384753],
  // The water treatment plant (HSTP) serves both houses.
  shared: { ids: [384751], shares },
} satisfies FeedGroups;

// The IoTaWatt integrator's import/export split of the circuit net, logged
// from 7 Oct 09:48 (earlier buckets net the circuits). Its formula sums the
// circuits with the phase-C ×2 built in, so it has no `calibration` entry.
// `buildBuckets` instead re-bases it onto the calibrated circuits (the solar
// trim and `unmetered` below); if a circuit's factor changes in the IoTaWatt
// formula, change it there too. Checked against AGL in docs/metering-accuracy.md.
const gridFeeds: GridFeeds = { imports: 546961, exports: 546962 };

const feedLabels: Record<number, string> = {
  384745: "Light 1", 384746: "Power 1", 384747: "Light 2", 384748: "Power 2",
  384750: "Oven", 384751: "Water treatment", 384752: "Air conditioner", 384754: "Pool",
  384753: "Solar", 545440: "Nicki",
};

// Series for the chart's "by load" view. The two light and two power circuits
// are each merged into one series so the count lands at eight — the ceiling for
// a colour-blind-safe categorical line palette. Every feed id appears once.
const loadGroups: LoadGroup[] = [
  { label: "Lights", ids: [384745, 384747] },
  { label: "Power", ids: [384746, 384748] },
  { label: "Oven", ids: [384750] },
  { label: "Water treatment", ids: [384751] },
  { label: "Air conditioner", ids: [384752] },
  { label: "Pool", ids: [384754] },
  { label: "Nicki", ids: [545440] },
  { label: "Solar", ids: [384753] },
];

// Every phase-C channel (air conditioner, pool, solar) logs half its real
// power; phase A and Nicki (B) are correct. Fitted against the retailer's
// half-hourly data — see docs/metering-accuracy.md and
// scripts/fit-multipliers.mjs. Steps are the factor from that local time on.
// Since 7 Oct 09:29 the IoTaWatt's emoncms output formulas apply the ×2
// themselves, so these steps only correct the history logged before that.
const brisbane = (s: string) => Date.parse(`${s}:00+10:00`);
const always = -Infinity;
const outputsDoubled = brisbane("2026-10-07T09:29"); // first doubled post 09:29:30
const vtCal2065 = brisbane("2026-10-19T10:00");      // VT cal 20.65 in force (changed ~09:40)
const calibration: Calibration = {
  384752: [{ fromMs: always, factor: 2 }, { fromMs: outputsDoubled, factor: 1 }], // Air conditioner
  384754: [{ fromMs: always, factor: 2 }, { fromMs: outputsDoubled, factor: 1 }], // Pool
  384753: [                                                      // Solar
    { fromMs: always, factor: 1 },                               // emoncms formula already ×2
    { fromMs: brisbane("2026-09-28T13:25"), factor: 2 },         // formula ×2 removed
    { fromMs: brisbane("2026-10-04T11:10"), factor: 1 },         // C − A test, reads true
    { fromMs: brisbane("2026-10-04T12:40"), factor: 2 },
    { fromMs: outputsDoubled, factor: 1 },
    // The ×2 reads 2% high (fitted ×1.96, steady across 9 Oct–1 Nov). From the
    // VT cal 20.65 change, the regime that fit describes.
    { fromMs: vtCal2065, factor: 0.98 },
  ],
  384751: [                                                     // Water treatment
    // Logged doubled for this window: its baseline went 45 → 97 W while the
    // meter saw no change.
    { fromMs: brisbane("2026-09-28T13:25"), factor: 0.5 },
    { fromMs: brisbane("2026-10-04T12:40"), factor: 1 },
  ],
};

// The meter sees a steady load that no CT measures: AGL's net runs ~45 W above
// the circuit sum (41 W fitted on 9–17 Oct, 47 W on 20 Oct–1 Nov). It is added
// to the grid import/export and the live net, not to any circuit or house.
// Cause unknown; from the same VT cal 20.65 change as the solar trim.
const unmetered: UnmeteredStep[] = [{ fromMs: vtCal2065, watts: 45 }];

const tariff: Tariff = {
  importCentsPerKwh: 27.83,
  supplyChargeCentsPerDay: 132.484,
  feedInCentsPerKwh: 5,
};

// What AGL actually billed each month, in dollars, keyed "YYYY-MM" (Brisbane
// calendar month). Pre-fills the bill section's "Actual bill" box for that
// month. Add a line when a bill arrives.
const actualBills: Record<string, number> = {
  "2026-10": 429.00,
};

interface AppConfig {
  workerBaseUrl: string;
  timezone: string;
  dataStartDate: string;
  feeds: FeedGroups;
  gridFeeds: GridFeeds;
  feedLabels: Record<number, string>;
  loadGroups: LoadGroup[];
  calibration: Calibration;
  unmetered: UnmeteredStep[];
  allFeedIds: number[];
  tariff: Tariff;
  shares: Shares;
  actualBills: Record<string, number>;
  solarAllocation: SolarAllocation;
  bucketSeconds: number;
  monthBucketSeconds: number;
  livePollMs: number;
  billRecomputeMs: number;
  todayRefreshMs: number;
}

export const config = {
  // Set the GitHub Actions repo variable WORKER_URL (see README > Deploy) to the
  // deployed Worker URL; the build injects it as VITE_WORKER_URL. `||` (not `??`)
  // so an empty-string value — what an unset `${{ vars.WORKER_URL }}` renders as —
  // also falls through. There is deliberately no fallback URL: a blank base makes
  // <App> show a "dashboard not configured" notice rather than sending the public
  // site's requests to whoever happens to own an example domain.
  workerBaseUrl: (import.meta.env.VITE_WORKER_URL as string | undefined) || "",
  timezone: "Australia/Brisbane",
  // The first usable day ("YYYY-MM-DD", with an optional "THH:mm",
  // Australia/Brisbane). Until 7 Oct 10:00 it was the moment the IoTaWatt
  // outputs were corrected; it is now 1 Oct, with 1–7 Oct patched toward AGL's
  // reads by lib/onceOffOct2026.ts (ONCE-OFF(oct-2026): when that file goes,
  // so does the need for this value to be 1 Oct). Data before it is ignored for the
  // month-to-date bill and the "this month" chart, and the day chart pages back
  // no further than this day. Once the billing month starts after this date the
  // `Math.max` in `effectiveMonthWindow` always picks the month start, so the key
  // stops having any effect — but removing it still means editing `lib/time.ts`
  // (and its callers), so leave it.
  dataStartDate: "2026-10-01", // ONCE-OFF(oct-2026)
  feeds,
  gridFeeds,
  feedLabels,
  loadGroups,
  calibration,
  unmetered,
  allFeedIds: [...feeds.main, ...feeds.shared.ids, ...feeds.nicki, ...feeds.solar],
  tariff,
  shares,
  actualBills,
  solarAllocation: "proportional",
  bucketSeconds: 300,
  // Coarser buckets for the whole-month query keep the payload ~1 MB; per spec
  // §2.3 bucket size does not change the kWh totals.
  monthBucketSeconds: 900,
  livePollMs: 10_000,
  billRecomputeMs: 180_000,
  todayRefreshMs: 300_000,
} satisfies AppConfig;
