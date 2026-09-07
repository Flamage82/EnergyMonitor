import type {
  FeedGroups, Tariff, Shares, SolarAllocation,
} from "./lib/energy";

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
  // Feeds were reconfigured on this date (Australia/Brisbane local). Data before
  // it is ignored for the month-to-date bill and the "this month" chart. Once the
  // billing month starts after this date the `Math.max` in `effectiveMonthWindow`
  // always picks the month start, so the key stops having any effect — but
  // removing it still means editing `lib/time.ts` (and its callers), so leave it.
  dataStartDate: "2026-09-07",
  feeds,
  feedLabels,
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
