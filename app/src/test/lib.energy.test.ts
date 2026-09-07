import { describe, it, expect } from "vitest";
import { buildBuckets, integrateKwh, type MultiFeedSeries, type FeedGroups } from "../lib/energy";

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
