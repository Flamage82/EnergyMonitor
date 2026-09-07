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
    (import.meta.env.VITE_WORKER_URL as string | undefined) ??
    "https://marburg-energy-proxy.CHANGE-ME.workers.dev",
  timezone: "Australia/Brisbane",
  feeds,
  feedLabels,
  allFeedIds: [...feeds.main, ...feeds.nicki, ...feeds.solar],
  tariff,
  shares,
  solarAllocation: "proportional" as SolarAllocation,
  bucketSeconds: 300,
  livePollMs: 10_000,
  billRecomputeMs: 180_000,
  todayRefreshMs: 300_000,
};
