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

/**
 * The real spacing of the returned buckets, in seconds — the median gap between
 * consecutive timestamps. emoncms rounds the requested `interval` up to a
 * multiple of the feed's native interval, so trusting the config value when
 * integrating watts→kWh would silently scale every figure on a mismatch. Falls
 * back to `fallbackSeconds` for a series too short to measure.
 */
export function inferBucketSeconds(buckets: GroupBucket[], fallbackSeconds: number): number {
  const deltas: number[] = [];
  for (let i = 1; i < buckets.length; i++) {
    const d = (buckets[i].tMs - buckets[i - 1].tMs) / 1000;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return fallbackSeconds;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

export function buildBuckets(series: MultiFeedSeries, groups: FeedGroups): GroupBucket[] {
  const byId = new Map(series.map((s) => [Number(s.feedid), s.data]));
  const all = [...groups.main, ...groups.nicki, ...groups.solar];
  const length = Math.max(0, ...all.map((id) => byId.get(id)?.length ?? 0));

  // Per feed id: index of its first non-null datapoint (Infinity if it never
  // reports). A null before this index means "not reporting yet" — contributes 0
  // and is not a gap. A null at or after it is a real drop-out.
  const firstIdx = new Map<number, number>();
  for (const s of series) {
    const i = s.data.findIndex(([, v]) => v != null);
    firstIdx.set(Number(s.feedid), i === -1 ? Infinity : i);
  }

  const sumGroup = (ids: number[], i: number) => {
    let sum = 0;
    let missing = false;
    for (const id of ids) {
      const feedData = byId.get(id);
      if (feedData === undefined) {
        // The feed is absent from the response entirely (dropped/errored
        // upstream) — that is a real gap in every bucket, not a quiet zero.
        missing = true;
        continue;
      }
      const v = feedData[i]?.[1];
      if (v == null) {
        if (i >= (firstIdx.get(id) ?? Infinity)) missing = true;
        // else: leading null — the feed had not started reporting yet, so it
        // contributes 0 and is not a gap.
      } else sum += v;
    }
    return { sum, missing };
  };

  const out: GroupBucket[] = [];
  for (let i = 0; i < length; i++) {
    const main = sumGroup(groups.main, i);
    const nicki = sumGroup(groups.nicki, i);
    const solar = sumGroup(groups.solar, i);
    // Take the timestamp from the first feed that actually has a point at this
    // index — the first configured feed may be missing from the response.
    let tMs = 0;
    for (const id of all) {
      const t = byId.get(id)?.[i]?.[0];
      if (t != null) { tMs = t; break; }
    }
    out.push({
      tMs,
      mainW: main.sum,
      nickiW: nicki.sum,
      // Feed is negative when generating. `|| 0` collapses the `-0` that a
      // zero-generation sum would otherwise produce, so bucket equality in tests
      // and downstream comparisons stay predictable.
      solarW: -solar.sum || 0,
      partial: main.missing || nicki.missing || solar.missing,
    });
  }
  return out;
}

export interface HouseholdBill {
  importKwh: number;
  importCost: number;       // dollars
  solarCreditShare: number; // dollars, <= 0
  supplyChargeShare: number;// dollars
  total: number;            // dollars
}
export interface BillResult { mainHouse: HouseholdBill; nicki: HouseholdBill; gaps: number; }

export interface AllocateOpts {
  bucketSeconds: number;
  tariff: Tariff;
  shares: Shares;
  solarAllocation: SolarAllocation;
  daysElapsed: number;
}

export function allocateBill(buckets: GroupBucket[], opts: AllocateOpts): BillResult {
  const { bucketSeconds, tariff, shares, solarAllocation, daysElapsed } = opts;
  const importRate = tariff.importCentsPerKwh / 100;
  const fitRate = tariff.feedInCentsPerKwh / 100;
  // `|| 1` guards the share-split divisions below against a misconfigured
  // `{ mainHouse: 0, nicki: 0 }` producing NaN dollar figures.
  const totalShares = shares.mainHouse + shares.nicki || 1;

  const main = { importKwh: 0, importCost: 0, solarCreditShare: 0 };
  const nicki = { importKwh: 0, importCost: 0, solarCreditShare: 0 };
  let gaps = 0;

  for (const b of buckets) {
    if (b.partial) gaps++;
    const gross = b.mainW + b.nickiW;
    const netW = gross - b.solarW;

    if (netW >= 0) {
      const netKwh = integrateKwh(netW, bucketSeconds);
      if (solarAllocation === "proportional") {
        const mainShare = gross > 0 ? b.mainW / gross : 0.5;
        main.importKwh += netKwh * mainShare;
        nicki.importKwh += netKwh * (1 - mainShare);
      } else {
        const mainNetW = Math.max(0, b.mainW - b.solarW);
        const solarLeft = Math.max(0, b.solarW - b.mainW);
        const nickiNetW = Math.max(0, b.nickiW - solarLeft);
        main.importKwh += integrateKwh(mainNetW, bucketSeconds);
        nicki.importKwh += integrateKwh(nickiNetW, bucketSeconds);
      }
    } else {
      const exportKwh = integrateKwh(-netW, bucketSeconds);
      const credit = exportKwh * fitRate;
      main.solarCreditShare -= (credit * shares.mainHouse) / totalShares;
      nicki.solarCreditShare -= (credit * shares.nicki) / totalShares;
    }
  }

  main.importCost = main.importKwh * importRate;
  nicki.importCost = nicki.importKwh * importRate;

  const supplyTotal = (daysElapsed * tariff.supplyChargeCentsPerDay) / 100;
  const mainSupply = (supplyTotal * shares.mainHouse) / totalShares;
  const nickiSupply = (supplyTotal * shares.nicki) / totalShares;

  const finish = (h: typeof main, supply: number): HouseholdBill => ({
    ...h,
    supplyChargeShare: supply,
    total: h.importCost + h.solarCreditShare + supply,
  });

  return {
    mainHouse: finish(main, mainSupply),
    nicki: finish(nicki, nickiSupply),
    gaps,
  };
}
