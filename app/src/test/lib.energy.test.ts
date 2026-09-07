import { describe, it, expect } from "vitest";
import { allocateBill, buildBuckets, integrateKwh, type MultiFeedSeries, type FeedGroups, type GroupBucket } from "../lib/energy";

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

  it("treats a null sample as 0 and marks the bucket partial", () => {
    const series: MultiFeedSeries = [
      { feedid: "1", data: [[1000, null]] },
      { feedid: "2", data: [[1000, 50]] },
      { feedid: "9", data: [[1000, 30]] },
      { feedid: "5", data: [[1000, -400]] },
    ];
    expect(buildBuckets(series, groups)[0]).toEqual({
      tMs: 1000, mainW: 50, nickiW: 30, solarW: 400, partial: true,
    });
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
