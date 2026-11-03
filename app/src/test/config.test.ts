import { describe, it, expect } from "vitest";
import { config } from "../config";
import { factorAt, unmeteredAt } from "../lib/calibration";

describe("config", () => {
  it("lists all 10 feed ids across groups with labels", () => {
    expect(config.allFeedIds).toHaveLength(10);
    for (const id of config.allFeedIds) {
      expect(config.feedLabels[id]).toBeTruthy();
    }
  });
  it("groups Nicki and Solar separately from the main house", () => {
    expect(config.feeds.nicki).toEqual([545440]);
    expect(config.feeds.solar).toEqual([384753]);
    expect(config.feeds.main).not.toContain(545440);
  });
  it("shares the water treatment plant between the houses by the standard ratio", () => {
    expect(config.feeds.shared.ids).toEqual([384751]);
    expect(config.feeds.shared.shares).toEqual(config.shares);
    expect(config.feeds.main).not.toContain(384751);
  });
  it("defines eight by-load series covering every feed exactly once", () => {
    expect(config.loadGroups).toHaveLength(8);
    const covered = config.loadGroups.flatMap((g) => g.ids).sort((a, b) => a - b);
    expect(covered).toEqual([...config.allFeedIds].sort((a, b) => a - b));
    for (const g of config.loadGroups) expect(g.label).toBeTruthy();
  });
  it("doubles every phase-C channel, allowing for the old upstream solar ×2", () => {
    const at = (s: string) => Date.parse(`${s}:00+10:00`);
    const now = at("2026-10-07T12:00");
    const before = at("2026-10-06T12:00");
    expect(factorAt(config.calibration, 384752, before)).toBe(2); // Air conditioner
    expect(factorAt(config.calibration, 384754, before)).toBe(2); // Pool
    expect(factorAt(config.calibration, 384753, before)).toBe(2); // Solar
    expect(factorAt(config.calibration, 384752, at("2026-01-01T12:00"))).toBe(2);
    // The IoTaWatt's emoncms outputs apply the ×2 themselves from 7 Oct 09:29.
    for (const id of [384752, 384754, 384753]) {
      expect(factorAt(config.calibration, id, at("2026-10-07T09:28"))).toBe(2);
      expect(factorAt(config.calibration, id, now)).toBe(1);
    }
    // The emoncms formula already doubled solar until 28 Sep.
    expect(factorAt(config.calibration, 384753, at("2026-09-20T12:00"))).toBe(1);
    // C − A tests read correctly as logged.
    expect(factorAt(config.calibration, 384753, at("2026-10-04T12:00"))).toBe(1);
    // Water treatment was logged doubled from 28 Sep to 4 Oct.
    expect(factorAt(config.calibration, 384751, at("2026-10-01T12:00"))).toBe(0.5);
    expect(factorAt(config.calibration, 384751, now)).toBe(1);
    for (const id of [384745, 384746, 384747, 384748, 384750, 545440]) {
      expect(factorAt(config.calibration, id, now)).toBe(1);
    }
  });
  it("trims solar's ×2 by 2% from the VT cal 20.65 change, and adds 45 W unmetered then", () => {
    const at = (s: string) => Date.parse(`${s}:00+10:00`);
    expect(factorAt(config.calibration, 384753, at("2026-10-19T09:59"))).toBe(1);
    expect(factorAt(config.calibration, 384753, at("2026-10-19T10:00"))).toBe(0.98);
    // No other circuit is trimmed.
    for (const id of [384752, 384754, 384751, 384745, 545440]) {
      expect(factorAt(config.calibration, id, at("2026-11-01T12:00"))).toBe(1);
    }
    expect(unmeteredAt(config.unmetered, at("2026-10-19T09:59"))).toBe(0);
    expect(unmeteredAt(config.unmetered, at("2026-10-19T10:00"))).toBe(45);
  });
  it("carries the data-floor cutoff (1 Oct, patched toward AGL until the once-off goes)", () => {
    expect(config.dataStartDate).toBe("2026-10-01");
  });
  it("uses a coarser bucket for the whole-month query", () => {
    expect(config.bucketSeconds).toBe(300);
    expect(config.monthBucketSeconds).toBe(900);
  });
  it("records October 2026's actual bill", () => {
    expect(config.actualBills["2026-10"]).toBe(429);
  });
  it("carries the published tariff", () => {
    expect(config.tariff.importCentsPerKwh).toBe(27.83);
    expect(config.tariff.supplyChargeCentsPerDay).toBe(132.484);
    expect(config.tariff.feedInCentsPerKwh).toBe(5);
  });
});
