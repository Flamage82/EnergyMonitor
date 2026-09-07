import { describe, it, expect } from "vitest";
import { toTodayPoints, toTodayLoadPoints, toMonthDayPoints } from "../lib/chart";
import type { FeedBucket, GroupBucket, LoadGroup } from "../lib/energy";

const b = (tMs: number, mainW: number, nickiW: number, solarW: number): GroupBucket =>
  ({ tMs, mainW, nickiW, solarW, partial: false });

describe("toTodayPoints", () => {
  it("passes watts straight through with positive solar", () => {
    expect(toTodayPoints([b(1000, 500, 100, 300)])).toEqual([{ t: 1000, main: 500, nicki: 100, solar: 300 }]);
  });

  it("floors a negative reading (measurement noise) to zero", () => {
    expect(toTodayPoints([b(1000, 500, 100, -12)])).toEqual([{ t: 1000, main: 500, nicki: 100, solar: 0 }]);
  });
});

describe("toTodayLoadPoints", () => {
  const fb = (tMs: number, watts: Record<number, number>): FeedBucket => ({ tMs, watts, partial: false });
  const groups: LoadGroup[] = [
    { label: "Lights", ids: [1, 3] },
    { label: "Oven", ids: [4] },
    { label: "Solar", ids: [5] },
  ];

  it("sums each load group's feeds under its label", () => {
    const pts = toTodayLoadPoints([fb(1000, { 1: 120, 3: 80, 4: 400 })], groups, [5]);
    expect(pts).toEqual([{ t: 1000, Lights: 200, Oven: 400, Solar: 0 }]);
  });

  it("flips a solar group to positive generation", () => {
    const pts = toTodayLoadPoints([fb(1000, { 1: 0, 3: 0, 4: 0, 5: -1200 })], groups, [5]);
    expect(pts[0].Solar).toBe(1200);
  });

  it("floors a solar group reading positive (drift in low light) to zero", () => {
    const pts = toTodayLoadPoints([fb(1000, { 1: 0, 3: 0, 4: 0, 5: 8 })], groups, [5]);
    expect(pts[0].Solar).toBe(0);
  });
});

describe("toMonthDayPoints", () => {
  it("sums net import per Brisbane day", () => {
    // both buckets on 2026-09-01 Brisbane; net = main+nicki-solar
    const start = Date.parse("2026-08-31T14:00:00Z");
    const pts = toMonthDayPoints(
      [b(start, 2000, 0, 0), b(start + 1800_000, 0, 0, 1000)],
      1800, "Australia/Brisbane",
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].day).toBe("2026-09-01");
    expect(pts[0].netImportKwh).toBeCloseTo((2000 * 1800 - 1000 * 1800) / 3_600_000, 6);
  });
});
