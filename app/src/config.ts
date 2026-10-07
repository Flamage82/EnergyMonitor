import type {
  FeedGroups, LoadGroup, Tariff, Shares, SolarAllocation,
} from "./lib/energy";
import type { Calibration } from "./lib/calibration";

const feeds: FeedGroups = {
  main: [384745, 384746, 384747, 384748, 384750, 384751, 384752, 384754],
  nicki: [545440],
  solar: [384753],
};

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
const calibration: Calibration = {
  384752: [{ fromMs: always, factor: 2 }, { fromMs: outputsDoubled, factor: 1 }], // Air conditioner
  384754: [{ fromMs: always, factor: 2 }, { fromMs: outputsDoubled, factor: 1 }], // Pool
  384753: [                                                      // Solar
    { fromMs: always, factor: 1 },                               // emoncms formula already ×2
    { fromMs: brisbane("2026-09-28T13:25"), factor: 2 },         // formula ×2 removed
    { fromMs: brisbane("2026-10-04T11:10"), factor: 1 },         // C − A test, reads true
    { fromMs: brisbane("2026-10-04T12:40"), factor: 2 },
    { fromMs: outputsDoubled, factor: 1 },
  ],
  384751: [                                                      // Water treatment
    // Logged doubled for this window: its baseline went 45 → 97 W while the
    // meter saw no change.
    { fromMs: brisbane("2026-09-28T13:25"), factor: 0.5 },
    { fromMs: brisbane("2026-10-04T12:40"), factor: 1 },
  ],
};

const tariff: Tariff = {
  importCentsPerKwh: 27.83,
  supplyChargeCentsPerDay: 132.484,
  feedInCentsPerKwh: 5,
};

const shares: Shares = { mainHouse: 4, nicki: 1 };

interface AppConfig {
  workerBaseUrl: string;
  timezone: string;
  dataStartDate: string;
  feeds: FeedGroups;
  feedLabels: Record<number, string>;
  loadGroups: LoadGroup[];
  calibration: Calibration;
  allFeedIds: number[];
  tariff: Tariff;
  shares: Shares;
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
  // The IoTaWatt outputs were corrected at this local time ("YYYY-MM-DD", with an
  // optional "THH:mm", Australia/Brisbane). Data before it is ignored for the
  // month-to-date bill and the "this month" chart, and the day chart pages back
  // no further than this day. Once the billing month starts after this date the
  // `Math.max` in `effectiveMonthWindow` always picks the month start, so the key
  // stops having any effect — but removing it still means editing `lib/time.ts`
  // (and its callers), so leave it.
  dataStartDate: "2026-10-07T10:00",
  feeds,
  feedLabels,
  loadGroups,
  calibration,
  allFeedIds: [...feeds.main, ...feeds.nicki, ...feeds.solar],
  tariff,
  shares,
  solarAllocation: "proportional",
  bucketSeconds: 300,
  // Coarser buckets for the whole-month query keep the payload ~1 MB; per spec
  // §2.3 bucket size does not change the kWh totals.
  monthBucketSeconds: 900,
  livePollMs: 10_000,
  billRecomputeMs: 180_000,
  todayRefreshMs: 300_000,
} satisfies AppConfig;
