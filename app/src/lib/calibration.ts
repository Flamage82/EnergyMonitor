import type { MultiFeedSeries } from "./energy";

/** From `fromMs` until the next step, multiply the feed's logged watts by `factor`. */
export interface CalibrationStep { fromMs: number; factor: number; }
/** Per feed id, steps in ascending `fromMs`. A feed with no entry is ×1. */
export type Calibration = Record<number, CalibrationStep[]>;

/** The factor in force for `feedId` at `tMs`; ×1 before its first step. */
export function factorAt(cal: Calibration, feedId: number, tMs: number): number {
  let factor = 1;
  for (const step of cal[feedId] ?? []) {
    if (step.fromMs > tMs) break;
    factor = step.factor;
  }
  return factor;
}

/**
 * Applies the calibration to a `/series` response, point by point, so every
 * consumer downstream (bill, by-house and by-load charts) sees corrected watts.
 */
export function calibrateSeries(series: MultiFeedSeries, cal: Calibration): MultiFeedSeries {
  return series.map(({ feedid, data }) => {
    const id = Number(feedid);
    if (!cal[id]) return { feedid, data };
    return {
      feedid,
      data: data.map(([t, v]): [number, number | null] => [t, v == null ? null : v * factorAt(cal, id, t)]),
    };
  });
}

/** Applies the factor in force at `nowMs` to each live value. */
export function calibrateLive(values: Record<number, number>, cal: Calibration, nowMs: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [id, v] of Object.entries(values)) out[Number(id)] = v * factorAt(cal, Number(id), nowMs);
  return out;
}
