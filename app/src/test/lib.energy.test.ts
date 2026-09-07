import { describe, it, expect } from "vitest";
import { allocateBill, buildBuckets, buildFeedBuckets, inferBucketSeconds, integrateKwh, type MultiFeedSeries, type FeedGroups, type GroupBucket } from "../lib/energy";

const groups: FeedGroups = { main: [1, 2], nicki: [9], solar: [5] };

describe("buildBuckets", () => {
  it("sums feed groups per timestamp and flips solar sign", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[1000, 100], [2000, 200]] },
      { feedid: "2", data: [[1000, 50], [2000, 60]] },
      { feedid: "9", data: [[1000, 30], [2000, 40]] },
      { feedid: "5", data: [[1000, -400], [2000, -10]] },
    ];
    const b = buildBuckets(series, groups);
    expect(b[0]).toEqual({ tMs: 1000, mainW: 150, nickiW: 30, solarW: 400, partial: false });
    expect(b[1]).toEqual({ tMs: 2000, mainW: 260, nickiW: 40, solarW: 10, partial: false });
  });

  it("treats a null sample as 0 and marks the bucket partial once the feed has reported", () => {
    // feed 1 reports at bucket 0 then drops out at bucket 1 -> real gap
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[900, 10], [1000, null]] },
      { feedid: "2", data: [[900, 40], [1000, 50]] },
      { feedid: "9", data: [[900, 20], [1000, 30]] },
      { feedid: "5", data: [[900, -400], [1000, -400]] },
    ];
    expect(buildBuckets(series, groups)[1]).toEqual({
      tMs: 1000, mainW: 50, nickiW: 30, solarW: 400, partial: true,
    });
  });

  it("treats a feed's leading run of nulls as not-started-yet (0, not a gap)", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[0, 100], [1, 100], [2, 100], [3, 100], [4, 100], [5, 100]] },
      { feedid: "2", data: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]] },
      // Nicki-style new feed: null until index 3
      { feedid: "9", data: [[0, null], [1, null], [2, null], [3, 40], [4, 50], [5, 60]] },
      { feedid: "5", data: [[0, -10], [1, -10], [2, -10], [3, -10], [4, -10], [5, -10]] },
    ];
    const b = buildBuckets(series, groups);
    for (let i = 0; i < 3; i++) {
      expect(b[i].partial).toBe(false);
      expect(b[i].nickiW).toBe(0);
    }
    expect(b[3]).toEqual({ tMs: 3, mainW: 100, nickiW: 40, solarW: 10, partial: false });
    expect(b[4].nickiW).toBe(50);
    expect(b[5].nickiW).toBe(60);
  });

  it("takes the timestamp from the first feed that has a point when main[0] is absent", () => {
    // groups.main[0] === 1 is missing from the response entirely.
    const series: MultiFeedSeries = [
      { feedid: "2", data: [[1788184800000, 50], [1788185100000, 60]] },
      { feedid: "9", data: [[1788184800000, 30], [1788185100000, 40]] },
      { feedid: "5", data: [[1788184800000, -400], [1788185100000, -10]] },
    ];
    const b = buildBuckets(series, groups);
    expect(b[0].tMs).toBe(1788184800000);
    expect(b[1].tMs).toBe(1788185100000);
  });

  it("flags every bucket partial when a feed is missing from the response entirely", () => {
    const series: MultiFeedSeries = [
      // feed 1 (main) dropped by the API completely
      { feedid: "2", data: [[1000, 50], [2000, 60]] },
      { feedid: "9", data: [[1000, 30], [2000, 40]] },
      { feedid: "5", data: [[1000, -400], [2000, -10]] },
    ];
    const b = buildBuckets(series, groups);
    expect(b).toHaveLength(2);
    for (const bucket of b) expect(bucket.partial).toBe(true);
    // the absent feed contributes 0, so main is just feed 2
    expect(b[0].mainW).toBe(50);
    expect(b[1].mainW).toBe(60);
  });

  it("flags a null that follows a feed's first real value as a real gap", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[0, 100], [1, 100], [2, 100], [3, null], [4, 100]] },
      { feedid: "2", data: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
      { feedid: "9", data: [[0, 10], [1, 10], [2, 10], [3, 10], [4, 10]] },
      { feedid: "5", data: [[0, -10], [1, -10], [2, -10], [3, -10], [4, -10]] },
    ];
    const b = buildBuckets(series, groups);
    expect(b[2].partial).toBe(false);
    expect(b[3].partial).toBe(true);
    expect(b[4].partial).toBe(false);
  });
});

describe("buildFeedBuckets", () => {
  const ids = [1, 2, 9, 5];

  it("keeps each feed's watts separate per timestamp, raw solar sign", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[1000, 100], [2000, 200]] },
      { feedid: "2", data: [[1000, 50], [2000, 60]] },
      { feedid: "9", data: [[1000, 30], [2000, 40]] },
      { feedid: "5", data: [[1000, -400], [2000, -10]] },
    ];
    const b = buildFeedBuckets(series, ids);
    expect(b[0]).toEqual({ tMs: 1000, watts: { 1: 100, 2: 50, 9: 30, 5: -400 }, partial: false });
    expect(b[1]).toEqual({ tMs: 2000, watts: { 1: 200, 2: 60, 9: 40, 5: -10 }, partial: false });
  });

  it("treats a leading null as 0 (not a gap) and a later null as a real gap", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[0, 100], [1, 100], [2, null]] },
      { feedid: "2", data: [[0, 0], [1, 0], [2, 0]] },
      { feedid: "9", data: [[0, null], [1, 40], [2, 50]] },
      { feedid: "5", data: [[0, -10], [1, -10], [2, -10]] },
    ];
    const b = buildFeedBuckets(series, [1, 2, 9, 5]);
    expect(b[0]).toEqual({ tMs: 0, watts: { 1: 100, 2: 0, 9: 0, 5: -10 }, partial: false });
    expect(b[2].partial).toBe(true); // feed 1 dropped out after reporting
    expect(b[2].watts[1]).toBe(0);
  });

  it("flags every bucket partial when a feed is absent from the response", () => {
    const series: MultiFeedSeries = [
      { feedid: "2", data: [[1000, 50], [2000, 60]] },
      { feedid: "9", data: [[1000, 30], [2000, 40]] },
      { feedid: "5", data: [[1000, -400], [2000, -10]] },
    ];
    const b = buildFeedBuckets(series, [1, 2, 9, 5]);
    expect(b[0].tMs).toBe(1000);
    expect(b[0].watts[1]).toBe(0);
    for (const bucket of b) expect(bucket.partial).toBe(true);
  });
});

describe("buildBuckets solar sign", () => {
  it("emits +0 (not -0) when the solar feeds sum to exactly zero", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[0, 100]] },
      { feedid: "2", data: [[0, 0]] },
      { feedid: "9", data: [[0, 0]] },
      { feedid: "5", data: [[0, 0]] },
    ];
    const solarW = buildBuckets(series, groups)[0].solarW;
    expect(Object.is(solarW, -0)).toBe(false);
    expect(solarW).toBe(0);
  });
});

describe("inferBucketSeconds", () => {
  const at = (tMs: number): GroupBucket => ({ tMs, mainW: 0, nickiW: 0, solarW: 0, partial: false });

  it("returns the median gap between consecutive timestamps", () => {
    const buckets = [at(0), at(900_000), at(1_800_000), at(2_700_000)];
    expect(inferBucketSeconds(buckets, 300)).toBe(900);
  });

  it("shrugs off a single large gap (data drop-out) via the median", () => {
    const buckets = [at(0), at(900_000), at(9_000_000), at(9_900_000), at(10_800_000)];
    expect(inferBucketSeconds(buckets, 300)).toBe(900);
  });

  it("falls back when the series is too short to measure", () => {
    expect(inferBucketSeconds([], 300)).toBe(300);
    expect(inferBucketSeconds([at(0)], 300)).toBe(300);
  });
});

describe("allocateBill share guard", () => {
  it("does not divide by zero when both shares are zero", () => {
    const r = allocateBill(exporting, {
      ...base, shares: { mainHouse: 0, nicki: 0 }, daysElapsed: 5, solarAllocation: "proportional",
    });
    expect(Number.isNaN(r.mainHouse.total)).toBe(false);
    expect(Number.isNaN(r.nicki.supplyChargeShare)).toBe(false);
  });
});

describe("integrateKwh", () => {
  it("converts average watts over a bucket to kWh", () => {
    expect(integrateKwh(2000, 300)).toBeCloseTo(2000 * 300 / 3_600_000, 9); // ~0.1667
  });
});

const tariff = { importCentsPerKwh: 27.83, supplyChargeCentsPerDay: 132.484, feedInCentsPerKwh: 5 };
const shares = { mainHouse: 4, nicki: 1 };
const base = { bucketSeconds: 1800, tariff, shares, daysElapsed: 0 };

// one 30-min bucket, importing: main 1000W, nicki 1000W, solar 400W -> net 1600W import
const importing: GroupBucket[] = [
  { tMs: 0, mainW: 1000, nickiW: 1000, solarW: 400, partial: false },
];
// one 30-min bucket, exporting: main 200W, nicki 100W, solar 1000W -> net -700W export
const exporting: GroupBucket[] = [
  { tMs: 0, mainW: 200, nickiW: 100, solarW: 1000, partial: false },
];

describe("allocateBill - proportional", () => {
  it("splits net import cost by each house's share of gross load", () => {
    const r = allocateBill(importing, { ...base, solarAllocation: "proportional" });
    const netKwh = 1600 * 1800 / 3_600_000; // 0.8
    // gross split is 50/50
    expect(r.mainHouse.importKwh).toBeCloseTo(netKwh / 2, 9);
    expect(r.mainHouse.importCost).toBeCloseTo((netKwh / 2) * 0.2783, 9);
    expect(r.nicki.importCost).toBeCloseTo((netKwh / 2) * 0.2783, 9);
    expect(r.gaps).toBe(0);
  });

  it("credits export at the feed-in rate, split 4:1", () => {
    const r = allocateBill(exporting, { ...base, solarAllocation: "proportional" });
    const exportKwh = 700 * 1800 / 3_600_000; // 0.35
    const credit = exportKwh * 0.05;
    expect(r.mainHouse.solarCreditShare).toBeCloseTo(-credit * 4 / 5, 9);
    expect(r.nicki.solarCreditShare).toBeCloseTo(-credit * 1 / 5, 9);
    expect(r.mainHouse.importCost).toBe(0);
  });
});

describe("allocateBill - mainHouseFirst", () => {
  it("solar offsets the main house before Nicki", () => {
    // main 1000, nicki 1000, solar 400 -> main_net 600, nicki_net 1000
    const r = allocateBill(importing, { ...base, solarAllocation: "mainHouseFirst" });
    expect(r.mainHouse.importKwh).toBeCloseTo(600 * 1800 / 3_600_000, 9);
    expect(r.nicki.importKwh).toBeCloseTo(1000 * 1800 / 3_600_000, 9);
  });

  it("spillover solar reaches Nicki once the main house is covered", () => {
    const bucket: GroupBucket[] = [{ tMs: 0, mainW: 300, nickiW: 800, solarW: 500, partial: false }];
    const r = allocateBill(bucket, { ...base, solarAllocation: "mainHouseFirst" });
    // main_net 0, solar_left 200, nicki_net 600
    expect(r.mainHouse.importKwh).toBe(0);
    expect(r.nicki.importKwh).toBeCloseTo(600 * 1800 / 3_600_000, 9);
  });
});

describe("allocateBill - supply charge and gaps", () => {
  it("prorates the supply charge 4:1 by days elapsed", () => {
    const r = allocateBill([], { ...base, daysElapsed: 10, solarAllocation: "proportional" });
    const total = 10 * 1.32484; // dollars
    expect(r.mainHouse.supplyChargeShare).toBeCloseTo(total * 4 / 5, 9);
    expect(r.nicki.supplyChargeShare).toBeCloseTo(total * 1 / 5, 9);
    expect(r.mainHouse.total).toBeCloseTo(total * 4 / 5, 9);
  });

  it("counts partial buckets as gaps", () => {
    const b: GroupBucket[] = [
      { tMs: 0, mainW: 100, nickiW: 0, solarW: 0, partial: true },
      { tMs: 1, mainW: 100, nickiW: 0, solarW: 0, partial: false },
    ];
    expect(allocateBill(b, { ...base, solarAllocation: "proportional" }).gaps).toBe(1);
  });
});
