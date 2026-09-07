import { describe, it, expect } from "vitest";
import {
  monthStartMs, daysElapsedInMonth, localDayKey, monthLabel,
} from "../lib/time";

const TZ = "Australia/Brisbane"; // UTC+10, no DST

describe("time helpers", () => {
  it("monthStartMs returns 1st 00:00 Brisbane as UTC ms", () => {
    // 2026-09-01 00:00:00 +10:00 === 2026-08-31 14:00:00 UTC
    const now = new Date("2026-09-07T05:00:00Z");
    expect(monthStartMs(now, TZ)).toBe(Date.parse("2026-08-31T14:00:00Z"));
  });

  it("daysElapsedInMonth is fractional and matches elapsed time", () => {
    const start = Date.parse("2026-08-31T14:00:00Z");
    const now = new Date(start + 3.5 * 86_400_000);
    expect(daysElapsedInMonth(now, TZ)).toBeCloseTo(3.5, 6);
  });

  it("localDayKey buckets an instant into the Brisbane calendar day", () => {
    // 2026-09-06T15:30:00Z === 2026-09-07 01:30 Brisbane
    expect(localDayKey(Date.parse("2026-09-06T15:30:00Z"), TZ)).toBe("2026-09-07");
  });

  it("monthLabel formats month and year", () => {
    expect(monthLabel(new Date("2026-09-07T05:00:00Z"), TZ)).toBe("September 2026");
  });
});
