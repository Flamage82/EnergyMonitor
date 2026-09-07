import { describe, it, expect } from "vitest";
import { config } from "../config";

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
  it("carries the feed reconfiguration data-floor date", () => {
    expect(config.dataStartDate).toBe("2026-09-07");
  });
  it("carries the published tariff", () => {
    expect(config.tariff.importCentsPerKwh).toBe(27.83);
    expect(config.tariff.supplyChargeCentsPerDay).toBe(132.484);
    expect(config.tariff.feedInCentsPerKwh).toBe(5);
  });
});
