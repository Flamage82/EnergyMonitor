import { integrateKwh, type FeedBucket, type GroupBucket, type LoadGroup } from "./energy";
import { localDayKey } from "./time";

// A watts reading below zero is measurement noise (most often solar drifting
// slightly negative in low light) — clamp it so the chart never plots below the
// axis. Billing keeps the raw sign; this is a display-only floor.
const floor = (w: number) => Math.max(0, w);

export function toTodayPoints(buckets: GroupBucket[]) {
  return buckets.map((b) => ({ t: b.tMs, main: floor(b.mainW), nicki: floor(b.nickiW), solar: floor(b.solarW) }));
}

// One row per bucket, each load group's summed watts under its label. A solar
// group is flipped to positive generation so its line sits above the axis, like
// the grouped "Solar" line in the by-house view.
export function toTodayLoadPoints(
  buckets: FeedBucket[],
  groups: LoadGroup[],
  solarIds: number[],
) {
  const solar = new Set(solarIds);
  return buckets.map((b) => {
    const row: Record<string, number> = { t: b.tMs };
    for (const g of groups) {
      let sum = 0;
      for (const id of g.ids) sum += b.watts[id] ?? 0;
      // Flip a solar group to positive generation, then floor — `Math.max` also
      // collapses the `-0` a zero-generation solar sum would negate to.
      row[g.label] = floor(g.ids.some((id) => solar.has(id)) ? -sum : sum);
    }
    return row;
  });
}

// One row per local day, with the day's grid import and export as separate
// non-negative totals. Each bucket is classified by the sign of its own net
// (main + nicki - solar) and integrated onto one side only — an export bucket
// never nets against an import bucket, because the retailer settles each
// interval independently (see `allocateBill`).
export function toMonthDayPoints(buckets: GroupBucket[], bucketSeconds: number, timeZone: string) {
  const byDay = new Map<string, { importKwh: number; exportKwh: number }>();
  for (const b of buckets) {
    const day = localDayKey(b.tMs, timeZone);
    const row = byDay.get(day) ?? { importKwh: 0, exportKwh: 0 };
    const netW = b.mainW + b.nickiW - b.solarW;
    if (netW >= 0) row.importKwh += integrateKwh(netW, bucketSeconds);
    else row.exportKwh += integrateKwh(-netW, bucketSeconds);
    byDay.set(day, row);
  }
  return [...byDay.entries()].map(([day, sides]) => ({ day, ...sides }));
}
