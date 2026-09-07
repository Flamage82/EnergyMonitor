import { integrateKwh, type GroupBucket } from "./energy";
import { localDayKey } from "./time";

export function toTodayPoints(buckets: GroupBucket[]) {
  return buckets.map((b) => ({ t: b.tMs, main: b.mainW, nicki: b.nickiW, solar: b.solarW }));
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
