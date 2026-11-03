// ONCE-OFF PATCH (Oct 2026) — delete this file when October is long past.
//
// Brings 1 Oct 00:00 – 7 Oct 10:00 close to the retailer's meter, so October's
// bill can include its first week. Before 7 Oct 09:48 there are no IoTaWatt
// integrator feeds, so the bill nets the circuits per 15-min bucket, which
// loses the energy that flowed both ways inside a bucket (passing clouds).
// Net energy over the week is already within ~0.5%; only the import/export
// split is off, so each window scales import and export to AGL's half-hourly
// totals (fit by hand on 3 Nov 2026; see docs/metering-accuracy.md).
//
// TO REMOVE (grep the repo for "ONCE-OFF(oct-2026)"):
//   1. delete this file and src/test/lib.onceOffOct2026.test.ts
//   2. delete the one call and import in src/hooks/useSeries.ts
//   3. in src/config.ts, set `dataStartDate` to the first day wanted (the key
//      only matters while the floor is later than the month start) and fix
//      the tests that name 1 Oct as the floor
//   4. delete the "ONCE-OFF(oct-2026)" note in docs/metering-accuracy.md

import { gridFlowW, type GroupBucket } from "./energy";

const brisbane = (s: string) => Date.parse(`${s}:00+10:00`);

interface Window { fromMs: number; toMs: number; importFactor: number; exportFactor: number; }

export const OCT_2026_WINDOWS: Window[] = [
  // VT cal 20.5, before the 4 Oct C−A test.
  { fromMs: brisbane("2026-10-01T00:00"), toMs: brisbane("2026-10-04T10:30"), importFactor: 1.030, exportFactor: 1.083 },
  // C−A test (outputs reconfigured, cal 20.5 → 21): export read less than half.
  { fromMs: brisbane("2026-10-04T10:30"), toMs: brisbane("2026-10-04T13:30"), importFactor: 1, exportFactor: 2.23 },
  // VT cal 21, until the old data floor. The integrator feeds begin 09:48, so
  // the last bucket (09:45) is mostly circuit-netted too; a ~1% nudge there.
  { fromMs: brisbane("2026-10-04T13:30"), toMs: brisbane("2026-10-07T10:00"), importFactor: 1.005, exportFactor: 1.106 },
];

/** Scales each bucket's import and export by its window's factors; others pass through. */
export function applyOctober2026Patch(buckets: GroupBucket[], windows: Window[] = OCT_2026_WINDOWS): GroupBucket[] {
  return buckets.map((b) => {
    const w = windows.find((x) => b.tMs >= x.fromMs && b.tMs < x.toMs);
    if (!w) return b;
    const { importW, exportW } = gridFlowW(b);
    return { ...b, importW: importW * w.importFactor, exportW: exportW * w.exportFactor };
  });
}
