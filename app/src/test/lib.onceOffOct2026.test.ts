// ONCE-OFF(oct-2026): delete with lib/onceOffOct2026.ts
import { describe, it, expect } from "vitest";
import { applyOctober2026Patch, OCT_2026_WINDOWS } from "../lib/onceOffOct2026";
import { gridFlowW, type GroupBucket } from "../lib/energy";

const at = (s: string) => Date.parse(`${s}:00+10:00`);
const bucket = (tMs: number, over: Partial<GroupBucket> = {}): GroupBucket =>
  ({ tMs, mainW: 1000, nickiW: 0, solarW: 1500, partial: false, ...over });
const windows = [{ fromMs: 1000, toMs: 2000, importFactor: 1.1, exportFactor: 2 }];

describe("applyOctober2026Patch", () => {
  it("scales a circuit-netted bucket's import and export inside its window", () => {
    // net −500 W: pure export, so only the export factor bites
    const [b] = applyOctober2026Patch([bucket(1000)], windows);
    expect(gridFlowW(b)).toEqual({ importW: 0, exportW: 1000 });
    const [i] = applyOctober2026Patch([bucket(1500, { solarW: 400 })], windows);
    expect(gridFlowW(i).importW).toBeCloseTo(660); // 600 W × 1.1
    expect(gridFlowW(i).exportW).toBe(0);
  });

  it("scales a bucket that already carries the integrator's split", () => {
    const [b] = applyOctober2026Patch([bucket(1000, { importW: 100, exportW: 50 })], windows);
    expect(gridFlowW(b).importW).toBeCloseTo(110);
    expect(gridFlowW(b).exportW).toBe(100);
  });

  it("leaves buckets outside every window untouched, including at the end edge", () => {
    const outside = [bucket(999), bucket(2000)];
    expect(applyOctober2026Patch(outside, windows)).toEqual(outside);
  });

  it("does not mutate its input", () => {
    const input = [bucket(1000)];
    applyOctober2026Patch(input, windows);
    expect(input[0].importW).toBeUndefined();
  });
});

describe("OCT_2026_WINDOWS", () => {
  it("covers 1 Oct 00:00 to 7 Oct 10:00 without gaps or overlaps", () => {
    expect(OCT_2026_WINDOWS[0].fromMs).toBe(at("2026-10-01T00:00"));
    expect(OCT_2026_WINDOWS.at(-1)!.toMs).toBe(at("2026-10-07T10:00"));
    for (let i = 1; i < OCT_2026_WINDOWS.length; i++) {
      expect(OCT_2026_WINDOWS[i].fromMs).toBe(OCT_2026_WINDOWS[i - 1].toMs);
    }
  });
});
