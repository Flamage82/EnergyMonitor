import { describe, it, expect } from "vitest";
import { toTodayPoints, toMonthDayPoints } from "../lib/chart";
import type { GroupBucket } from "../lib/energy";

const b = (tMs: number, mainW: number, nickiW: number, solarW: number): GroupBucket =>
  ({ tMs, mainW, nickiW, solarW, partial: false });

describe("toTodayPoints", () => {
  it("passes watts straight through with positive solar", () => {
    expect(toTodayPoints([b(1000, 500, 100, 300)])).toEqual([{ t: 1000, main: 500, nicki: 100, solar: 300 }]);
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
