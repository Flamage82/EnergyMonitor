import { integrateKwh, type FeedBucket, type GroupBucket, type LoadGroup } from "./energy";
import { localDayKey } from "./time";

export function toTodayPoints(buckets: GroupBucket[]) {
  return buckets.map((b) => ({ t: b.tMs, main: b.mainW, nicki: b.nickiW, solar: b.solarW }));
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
      // `|| 0` collapses the `-0` a zero-generation solar sum would negate to.
      row[g.label] = g.ids.some((id) => solar.has(id)) ? -sum || 0 : sum;
    }
    return row;
  });
}

export function toMonthDayPoints(buckets: GroupBucket[], bucketSeconds: number, timeZone: string) {
  const byDay = new Map<string, number>();
  for (const b of buckets) {
    const day = localDayKey(b.tMs, timeZone);
    const netW = b.mainW + b.nickiW - b.solarW;
    byDay.set(day, (byDay.get(day) ?? 0) + integrateKwh(netW, bucketSeconds));
  }
  return [...byDay.entries()].map(([day, netImportKwh]) => ({ day, netImportKwh }));
}
