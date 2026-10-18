export interface FeedGroups { main: number[]; nicki: number[]; solar: number[]; }
/** A named series in the "by load" chart — one or more feed ids summed together. */
export interface LoadGroup { label: string; ids: number[]; }
export interface Tariff {
  importCentsPerKwh: number;
  supplyChargeCentsPerDay: number;
  feedInCentsPerKwh: number;
}
export interface Shares { mainHouse: number; nicki: number; }
export type SolarAllocation = "proportional" | "mainHouseFirst";

export type MultiFeedSeries = { feedid: string; data: [number, number | null][] }[];

/**
 * The IoTaWatt integrator's grid feeds: the positive (Imports, >= 0) and
 * negative (Exports, <= 0) parts of the circuit net, split at sample rate, so
 * their averages stay correct at any bucket size.
 */
export interface GridFeeds { imports: number; exports: number; }

export interface GroupBucket {
  tMs: number;
  mainW: number;
  nickiW: number;
  solarW: number; // >= 0 when generating
  // From the integrator, both >= 0; unset where either feed has no value.
  importW?: number;
  exportW?: number;
  partial: boolean;
}

export interface FeedBucket {
  tMs: number;
  watts: Record<number, number>; // per feed id, raw sign (solar negative when generating)
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

/**
 * Aligns the raw multi-feed series into per-timestamp buckets, one watt value
 * per feed id, keeping each feed's raw sign (solar is negative when generating).
 *
 * `partial` marks a bucket where at least one requested feed has no usable
 * value: a feed absent from the response entirely (dropped/errored upstream), or
 * a null at/after that feed's first real datapoint (a drop-out). A *leading* run
 * of nulls is a feed that had not started reporting yet — it contributes 0 and
 * is not a gap.
 */
export function buildFeedBuckets(series: MultiFeedSeries, feedIds: number[]): FeedBucket[] {
  const byId = new Map(series.map((s) => [Number(s.feedid), s.data]));
  const length = Math.max(0, ...feedIds.map((id) => byId.get(id)?.length ?? 0));

  // Per feed id: index of its first non-null datapoint (Infinity if it never
  // reports), used to tell a leading null from a real drop-out.
  const firstIdx = new Map<number, number>();
  for (const s of series) {
    const i = s.data.findIndex(([, v]) => v != null);
    firstIdx.set(Number(s.feedid), i === -1 ? Infinity : i);
  }

  const out: FeedBucket[] = [];
  for (let i = 0; i < length; i++) {
    const watts: Record<number, number> = {};
    let partial = false;
    for (const id of feedIds) {
      const feedData = byId.get(id);
      if (feedData === undefined) {
        watts[id] = 0;
        partial = true;
        continue;
      }
      const v = feedData[i]?.[1];
      if (v == null) {
        watts[id] = 0;
        if (i >= (firstIdx.get(id) ?? Infinity)) partial = true;
      } else {
        watts[id] = v;
      }
    }
    // Timestamp from the first feed that actually has a point at this index —
    // the first configured feed may be missing from the response.
    let tMs = 0;
    for (const id of feedIds) {
      const t = byId.get(id)?.[i]?.[0];
      if (t != null) { tMs = t; break; }
    }
    out.push({ tMs, watts, partial });
  }
  return out;
}

/**
 * `buildFeedBuckets` collapsed into the three household groups — the shape the
 * bill and the by-house chart consume. Any missing feed in any group makes the
 * whole bucket `partial`.
 *
 * With `grid`, each bucket also carries the integrator's `importW`/`exportW`.
 * A null in either grid feed leaves both unset (the bill then falls back to
 * netting the circuits) and is not a gap: the circuits still give a figure.
 */
export function buildBuckets(series: MultiFeedSeries, groups: FeedGroups, grid?: GridFeeds): GroupBucket[] {
  const all = [...groups.main, ...groups.nicki, ...groups.solar];
  const sum = (watts: Record<number, number>, ids: number[]) =>
    ids.reduce((a, id) => a + (watts[id] ?? 0), 0);
  const byId = new Map(series.map((s) => [Number(s.feedid), s.data]));
  const imports = grid && byId.get(grid.imports);
  const exports = grid && byId.get(grid.exports);

  return buildFeedBuckets(series, all).map((b, i) => {
    const bucket: GroupBucket = {
      tMs: b.tMs,
      mainW: sum(b.watts, groups.main),
      nickiW: sum(b.watts, groups.nicki),
      // Feed is negative when generating. `|| 0` collapses the `-0` that a
      // zero-generation sum would otherwise produce, so bucket equality in tests
      // and downstream comparisons stay predictable.
      solarW: -sum(b.watts, groups.solar) || 0,
      partial: b.partial,
    };
    const inW = imports?.[i]?.[1], outW = exports?.[i]?.[1];
    if (inW != null && outW != null) {
      bucket.importW = inW;
      bucket.exportW = -outW || 0;
    }
    return bucket;
  });
}

/**
 * A bucket's grid import and export, both >= 0 watts. Prefers the integrator's
 * per-sample split; without it, classifies the whole bucket by the sign of the
 * circuit net, which loses any flow both ways inside the bucket (a passing
 * cloud) — about 13% of export at 15-min buckets.
 */
export function gridFlowW(b: GroupBucket): { importW: number; exportW: number } {
  if (b.importW != null && b.exportW != null) return { importW: b.importW, exportW: b.exportW };
  const netW = b.mainW + b.nickiW - b.solarW;
  return netW >= 0 ? { importW: netW, exportW: 0 } : { importW: 0, exportW: -netW };
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

  // The main house's fraction of a bucket's import. With the integrator a
  // bucket can import and export at once, so each mode's split is a ratio
  // applied to the measured import rather than the circuit net itself.
  const mainShareOf = (b: GroupBucket): number => {
    const gross = b.mainW + b.nickiW;
    const proportional = gross > 0 ? b.mainW / gross : 0.5;
    if (solarAllocation === "proportional") return proportional;
    const mainNetW = Math.max(0, b.mainW - b.solarW);
    const solarLeft = Math.max(0, b.solarW - b.mainW);
    const nickiNetW = Math.max(0, b.nickiW - solarLeft);
    // Netted to export, yet the integrator saw import: no solar-first split to scale.
    return mainNetW + nickiNetW > 0 ? mainNetW / (mainNetW + nickiNetW) : proportional;
  };

  for (const b of buckets) {
    if (b.partial) gaps++;
    const { importW, exportW } = gridFlowW(b);

    if (importW > 0) {
      const importKwh = integrateKwh(importW, bucketSeconds);
      const mainShare = mainShareOf(b);
      main.importKwh += importKwh * mainShare;
      nicki.importKwh += importKwh * (1 - mainShare);
    }
    if (exportW > 0) {
      const credit = integrateKwh(exportW, bucketSeconds) * fitRate;
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
