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
    (import.meta.env.VITE_WORKER_URL as string | undefined) ||
    // Set the GitHub Actions repo variable WORKER_URL (see README > Deploy) to the
    // deployed Worker URL. `||` (not `??`) so an empty-string VITE_WORKER_URL — what
    // an unset `${{ vars.WORKER_URL }}` renders as — also falls through to this
    // last-resort placeholder rather than becoming the base URL.
    "https://marburg-energy-proxy.example.workers.dev",
  timezone: "Australia/Brisbane",
  // Feeds were reconfigured on this date (Australia/Brisbane local). Data before
  // it is ignored for the month-to-date bill and the "this month" chart. Once the
  // billing month starts after this date it stops having any effect, so it can be
  // deleted after 2026-09.
  dataStartDate: "2026-09-07",
  feeds,
  feedLabels,
  allFeedIds: [...feeds.main, ...feeds.nicki, ...feeds.solar],
  tariff,
  shares,
  solarAllocation: "proportional" as SolarAllocation,
  bucketSeconds: 300,
  // Coarser buckets for the whole-month query keep the payload ~1 MB; per spec
  // §2.3 bucket size does not change the kWh totals.
  monthBucketSeconds: 900,
  livePollMs: 10_000,
  billRecomputeMs: 180_000,
  todayRefreshMs: 300_000,
};
