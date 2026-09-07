import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePolledFetch } from "../hooks/usePolledFetch";
import { useMonthData } from "../hooks/useSeries";
import * as api from "../api/worker";

describe("usePolledFetch", () => {
  // @testing-library's waitFor only drives fake timers when a `jest` global with
  // `advanceTimersByTime` exists. Vitest has no `jest` global, so we shim one that
  // forwards to Vitest's fake-timer API. Scoped install/remove keeps this from
  // leaking into other describe blocks.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("jest", {
      advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("loads immediately then again after the interval", async () => {
    const loader = vi.fn(async () => 42);
    const { result } = renderHook(() => usePolledFetch(loader, 1000, []));
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(loader).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps last good data but surfaces the error when a poll fails", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("ok")
      .mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => usePolledFetch(loader, 1000, []));
    await waitFor(() => expect(result.current.data).toBe("ok"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await waitFor(() => expect(result.current.error).toMatch(/boom/));
    expect(result.current.data).toBe("ok");
  });
});

describe("useMonthData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches month-to-date buckets and groups them", async () => {
    const spy = vi.spyOn(api, "fetchSeries").mockResolvedValue([
      { feedid: "384746", data: [[1788184800000, 1000]] }, // Power 1 (main)
      { feedid: "545440", data: [[1788184800000, 200]] },  // Nicki
      { feedid: "384753", data: [[1788184800000, -500]] }, // Solar
    ] as any);
    const now = new Date("2026-09-07T05:00:00Z");
    const { result } = renderHook(() => useMonthData(now));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    // month start (Sep 1) is before the data-floor (Sep 7), so the floor wins
    expect(spy.mock.calls[0][1].startMs).toBe(Date.parse("2026-09-06T14:00:00Z"));
    const bucket = result.current.data![0];
    expect(bucket.nickiW).toBe(200);
    expect(bucket.solarW).toBe(500);
  });
});
