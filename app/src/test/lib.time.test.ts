import { describe, it, expect } from "vitest";
import {
  monthStartMs, effectiveMonthWindow, localDayKey, monthLabel, localDateStartMs, zonedTimeToUtcMs,
  dayWindow, monthWindow, dayLabel,
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

  it("dayLabel formats weekday, day and month in the zone", () => {
    // 2026-09-06T14:00:00Z === 2026-09-07 00:00 Brisbane, a Monday
    expect(dayLabel(Date.parse("2026-09-06T14:00:00Z"), TZ)).toMatch(/Mon.*7.*Sep/);
  });
});

describe("dayWindow", () => {
  // 2026-09-08 15:00 Brisbane
  const now = new Date("2026-09-08T05:00:00Z");

  it("spans local midnight today to now at offset 0", () => {
    const w = dayWindow(now, TZ, "2026-09-07", 0);
    expect(w.startMs).toBe(Date.parse("2026-09-07T14:00:00Z")); // Sep 8 00:00 Brisbane
    expect(w.endMs).toBe(now.getTime());
    expect(w.atFloor).toBe(false);
  });

  it("spans a whole past calendar day at a negative offset", () => {
    const w = dayWindow(now, TZ, "2026-09-07", -1);
    expect(w.startMs).toBe(Date.parse("2026-09-06T14:00:00Z")); // Sep 7 00:00 Brisbane
    expect(w.endMs).toBe(Date.parse("2026-09-07T14:00:00Z")); // Sep 8 00:00 Brisbane
  });

  it("crosses the month boundary when the offset runs past the 1st", () => {
    const w = dayWindow(now, TZ, "2026-01-01", -10); // Aug 29
    expect(w.startMs).toBe(Date.parse("2026-08-28T14:00:00Z"));
  });

  it("flags atFloor once the day is at or before dataStartDate", () => {
    expect(dayWindow(now, TZ, "2026-09-07", -1).atFloor).toBe(true);
    expect(dayWindow(now, TZ, "2026-09-07", -2).atFloor).toBe(true);
  });
});

describe("monthWindow", () => {
  it("at offset 0 matches the current effective-month window", () => {
    const now = new Date("2026-09-20T05:00:00Z");
    const w = monthWindow(now, TZ, "2026-09-07", 0);
    expect(w.startMs).toBe(Date.parse("2026-09-06T14:00:00Z")); // floored to Sep 7
    expect(w.endMs).toBe(now.getTime());
    expect(w.isCurrent).toBe(true);
    expect(w.floored).toBe(true);
    expect(w.atFloor).toBe(true); // no earlier month has data
  });

  it("at a negative offset spans the whole previous month", () => {
    const now = new Date("2026-11-15T05:00:00Z");
    const w = monthWindow(now, TZ, "2026-01-01", -1); // October
    expect(w.startMs).toBe(Date.parse("2026-09-30T14:00:00Z")); // Oct 1 00:00 Brisbane
    expect(w.endMs).toBe(Date.parse("2026-10-31T14:00:00Z")); // Nov 1 00:00 Brisbane
    expect(w.isCurrent).toBe(false);
    expect(w.daysElapsed).toBeCloseTo(31, 6);
    expect(w.atFloor).toBe(false);
  });

  it("flags atFloor for the month containing dataStartDate", () => {
    const now = new Date("2026-11-15T05:00:00Z");
    expect(monthWindow(now, TZ, "2026-01-01", -10).atFloor).toBe(true); // January
  });
});
