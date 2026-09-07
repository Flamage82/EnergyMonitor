export interface FeedGroups { main: number[]; nicki: number[]; solar: number[]; }
export interface Tariff {
  importCentsPerKwh: number;
  supplyChargeCentsPerDay: number;
  feedInCentsPerKwh: number;
}
export interface Shares { mainHouse: number; nicki: number; }
export type SolarAllocation = "proportional" | "mainHouseFirst";

export type MultiFeedSeries = { feedid: string; data: [number, number | null][] }[];

export interface GroupBucket {
  tMs: number;
  mainW: number;
  nickiW: number;
  solarW: number; // >= 0 when generating
  partial: boolean;
}

export function integrateKwh(watts: number, bucketSeconds: number): number {
  return (watts * bucketSeconds) / 3_600_000;
}

export function buildBuckets(series: MultiFeedSeries, groups: FeedGroups): GroupBucket[] {
  const byId = new Map(series.map((s) => [Number(s.feedid), s.data]));
  const all = [...groups.main, ...groups.nicki, ...groups.solar];
  const length = Math.max(0, ...all.map((id) => byId.get(id)?.length ?? 0));

  const sumGroup = (ids: number[], i: number) => {
    let sum = 0;
    let missing = false;
    for (const id of ids) {
      const point = byId.get(id)?.[i];
      const v = point?.[1];
      if (v == null) missing = true;
      else sum += v;
    }
    return { sum, missing };
  };

  const out: GroupBucket[] = [];
  for (let i = 0; i < length; i++) {
    const main = sumGroup(groups.main, i);
    const nicki = sumGroup(groups.nicki, i);
    const solar = sumGroup(groups.solar, i);
    const tMs =
      byId.get(all[0])?.[i]?.[0] ??
      byId.get(groups.main[0])?.[i]?.[0] ??
      0;
    out.push({
      tMs,
      mainW: main.sum,
      nickiW: nicki.sum,
      solarW: -solar.sum, // feed is negative when generating
      partial: main.missing || nicki.missing || solar.missing,
    });
  }
  return out;
}
