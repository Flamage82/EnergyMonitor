import { describe, it, expect } from "vitest";
import {
  monthStartMs, effectiveMonthWindow, localDayKey, monthLabel, localDateStartMs, zonedTimeToUtcMs,
} from "../lib/time";

const TZ = "Australia/Brisbane"; // UTC+10, no DST

describe("time helpers", () => {
  it("monthStartMs returns 1st 00:00 Brisbane as UTC ms", () => {
    // 2026-09-01 00:00:00 +10:00 === 2026-08-31 14:00:00 UTC
    const now = new Date("2026-09-07T05:00:00Z");
    expect(monthStartMs(now, TZ)).toBe(Date.parse("2026-08-31T14:00:00Z"));
  });

  it("effectiveMonthWindow uses the month start when the data floor is earlier", () => {
    const start = Date.parse("2026-08-31T14:00:00Z"); // Sep 1 00:00 Brisbane
    const now = new Date(start + 3.5 * 86_400_000);
    const w = effectiveMonthWindow(now, TZ, "2026-08-15");
    expect(w.startMs).toBe(start);
    expect(w.floored).toBe(false);
    expect(w.daysElapsed).toBeCloseTo(3.5, 6);
  });

  it("effectiveMonthWindow clamps to the data floor when it is later than the month start", () => {
    const floorMs = Date.parse("2026-09-06T14:00:00Z"); // Sep 7 00:00 Brisbane
    const now = new Date(floorMs + 2 * 86_400_000);
    const w = effectiveMonthWindow(now, TZ, "2026-09-07");
    expect(w.startMs).toBe(floorMs);
    expect(w.floored).toBe(true);
    expect(w.daysElapsed).toBeCloseTo(2, 6);
  });

  it("localDateStartMs returns 00:00 local of an ISO date as UTC ms", () => {
    // 2026-09-07 00:00:00 +10:00 === 2026-09-06 14:00:00 UTC
    expect(localDateStartMs("2026-09-07", TZ)).toBe(Date.parse("2026-09-06T14:00:00Z"));
  });

  it("localDayKey buckets an instant into the Brisbane calendar day", () => {
    // 2026-09-06T15:30:00Z === 2026-09-07 01:30 Brisbane
    expect(localDayKey(Date.parse("2026-09-06T15:30:00Z"), TZ)).toBe("2026-09-07");
  });

  it("zonedTimeToUtcMs converts a Brisbane wall-clock time to UTC ms", () => {
    // 2026-09-07 09:30:00 +10:00 === 2026-09-06 23:30:00 UTC
    expect(zonedTimeToUtcMs(2026, 9, 7, 9, 30, 0, TZ)).toBe(Date.parse("2026-09-06T23:30:00Z"));
  });

  it("zonedTimeToUtcMs respects a DST offset for the given instant", () => {
    // New York is on EDT (-04:00) in July: 2026-07-01 12:00 local === 16:00 UTC
    expect(zonedTimeToUtcMs(2026, 7, 1, 12, 0, 0, "America/New_York"))
      .toBe(Date.parse("2026-07-01T16:00:00Z"));
    // ...and on EST (-05:00) in January: 2026-01-01 12:00 local === 17:00 UTC
    expect(zonedTimeToUtcMs(2026, 1, 1, 12, 0, 0, "America/New_York"))
      .toBe(Date.parse("2026-01-01T17:00:00Z"));
  });

  it("monthLabel formats month and year", () => {
    expect(monthLabel(new Date("2026-09-07T05:00:00Z"), TZ)).toBe("September 2026");
  });
});
