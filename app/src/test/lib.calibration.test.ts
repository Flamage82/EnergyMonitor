import { describe, it, expect } from "vitest";
import { calibrateLive, calibrateSeries, factorAt, unmeteredAt, type Calibration } from "../lib/calibration";
import type { MultiFeedSeries } from "../lib/energy";

const cal: Calibration = {
  1: [{ fromMs: -Infinity, factor: 2 }],
  5: [{ fromMs: 2000, factor: 2 }, { fromMs: 4000, factor: 1 }],
};

describe("factorAt", () => {
  it("is 1 for a feed with no calibration", () => {
    expect(factorAt(cal, 9, 3000)).toBe(1);
  });
  it("is 1 before a feed's first step", () => {
    expect(factorAt(cal, 5, 1999)).toBe(1);
  });
  it("applies the latest step at or before the timestamp", () => {
    expect(factorAt(cal, 5, 2000)).toBe(2);
    expect(factorAt(cal, 5, 3999)).toBe(2);
    expect(factorAt(cal, 5, 4000)).toBe(1);
  });
  it("applies an open-ended step to all of history", () => {
    expect(factorAt(cal, 1, 0)).toBe(2);
  });
});

describe("unmeteredAt", () => {
  const steps = [{ fromMs: 2000, watts: 45 }, { fromMs: 4000, watts: 0 }];
  it("is 0 before the first step and with no steps", () => {
    expect(unmeteredAt(steps, 1999)).toBe(0);
    expect(unmeteredAt([], 5000)).toBe(0);
  });
  it("applies the latest step at or before the timestamp", () => {
    expect(unmeteredAt(steps, 2000)).toBe(45);
    expect(unmeteredAt(steps, 3999)).toBe(45);
    expect(unmeteredAt(steps, 4000)).toBe(0);
  });
});

describe("calibrateSeries", () => {
  const series: MultiFeedSeries = [
    { feedid: "1", data: [[1000, 100], [3000, null]] },
    { feedid: "5", data: [[1000, -400], [3000, -400], [5000, -400]] },
    { feedid: "9", data: [[1000, 30]] },
  ];

  it("scales each point by the factor in force at its timestamp", () => {
    const out = calibrateSeries(series, cal);
    expect(out[0].data).toEqual([[1000, 200], [3000, null]]);
    expect(out[1].data).toEqual([[1000, -400], [3000, -800], [5000, -400]]);
    expect(out[2].data).toEqual([[1000, 30]]);
  });

  it("does not mutate its input", () => {
    calibrateSeries(series, cal);
    expect(series[0].data[0]).toEqual([1000, 100]);
  });
});

describe("calibrateLive", () => {
  it("scales each live value by the factor in force now", () => {
    expect(calibrateLive({ 1: 100, 5: -400, 9: 30 }, cal, 3000)).toEqual({ 1: 200, 5: -800, 9: 30 });
    expect(calibrateLive({ 5: -400 }, cal, 5000)).toEqual({ 5: -400 });
  });
});
