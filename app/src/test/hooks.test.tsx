import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePolledFetch } from "../hooks/usePolledFetch";
import { useMonthData, useTodaySeries } from "../hooks/useSeries";
import { useLiveFeeds } from "../hooks/useLiveFeeds";
import { config } from "../config";
import * as api from "../api/worker";

describe("usePolledFetch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    // Discard pending fake timers WITHOUT running them: executing the hook's
    // setInterval here would setState on an about-to-unmount component and trip
    // React's "not wrapped in act(...)" warning.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // The mount effect starts an async loader whose resolution setState lands a
  // tick later; flush it inside act() so nothing escapes.
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

  it("loads immediately then again after the interval", async () => {
    const loader = vi.fn(async () => 42);
    const { result } = renderHook(() => usePolledFetch(loader, 1000, []));
    await flush();
    expect(result.current.data).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps last good data but surfaces the error when a poll fails", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce("ok")
      .mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => usePolledFetch(loader, 1000, []));
    await flush();
    expect(result.current.data).toBe("ok");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.error).toMatch(/boom/);
    expect(result.current.data).toBe("ok");
  });
});

describe("useLiveFeeds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls fetchLive with the configured base url and every feed id", async () => {
    const spy = vi.spyOn(api, "fetchLive").mockResolvedValue({ 384745: 100 } as api.LiveValues);
    const { result } = renderHook(() => useLiveFeeds());
    await waitFor(() => expect(result.current.data).toEqual({ 384745: 100 }));
    expect(spy).toHaveBeenCalledWith("https://worker.test", config.allFeedIds, expect.anything());
  });

  it("applies the calibration in force now to live values", async () => {
    vi.spyOn(api, "fetchLive").mockResolvedValue({ 384746: 100, 384752: 500 } as api.LiveValues);
    // Before the IoTaWatt outputs took over the ×2: Power 1 (phase A) ×1,
    // the air conditioner (phase C) ×2.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-06T12:00:00+10:00"));
    const { result } = renderHook(() => useLiveFeeds());
    await waitFor(() => expect(result.current.data).toEqual({ 384746: 100, 384752: 1000 }));
  });

  it("surfaces a fetch failure as an error string", async () => {
    vi.spyOn(api, "fetchLive").mockRejectedValue(new Error("proxy responded 502"));
    const { result } = renderHook(() => useLiveFeeds());
    await waitFor(() => expect(result.current.error).toMatch(/502/));
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
    // The whole-month query uses the coarser bucket so the payload stays ~1 MB.
    expect(spy.mock.calls[0][1].intervalSeconds).toBe(900);
    const bucket = result.current.data![0];
    expect(bucket.nickiW).toBe(200);
    expect(bucket.solarW).toBe(500);
  });

  it("fetches the whole previous month at a negative offset", async () => {
    const spy = vi.spyOn(api, "fetchSeries").mockResolvedValue([] as any);
    const now = new Date("2026-11-15T05:00:00Z");
    renderHook(() => useMonthData(now, -1));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1].startMs).toBe(Date.parse("2026-09-30T14:00:00Z")); // Oct 1 Brisbane
    expect(spy.mock.calls[0][1].endMs).toBe(Date.parse("2026-10-31T14:00:00Z")); // Nov 1 Brisbane
  });
});

describe("useTodaySeries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns both the grouped buckets and the per-feed buckets from one fetch", async () => {
    const spy = vi.spyOn(api, "fetchSeries").mockResolvedValue([
      { feedid: "384746", data: [[1788184800000, 1000]] }, // Power 1 (main)
      { feedid: "545440", data: [[1788184800000, 200]] },  // Nicki
      { feedid: "384753", data: [[1788184800000, -500]] }, // Solar
    ] as any);
    const now = new Date("2026-09-08T05:00:00Z");
    const { result } = renderHook(() => useTodaySeries(now));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(spy.mock.calls[0][1].intervalSeconds).toBe(config.bucketSeconds);
    expect(result.current.data!.buckets[0].mainW).toBe(1000);
    expect(result.current.data!.feedBuckets[0].watts[384746]).toBe(1000);
    expect(result.current.data!.feedBuckets[0].watts[384753]).toBe(-500);
  });

  it("applies the calibration to both the grouped and the per-feed buckets", async () => {
    const t = Date.parse("2026-10-06T12:00:00+10:00");
    vi.spyOn(api, "fetchSeries").mockResolvedValue([
      { feedid: "384746", data: [[t, 1000]] }, // Power 1, phase A
      { feedid: "384752", data: [[t, 500]] },  // Air conditioner, phase C
      { feedid: "384753", data: [[t, -800]] }, // Solar, phase C
    ] as any);
    const { result } = renderHook(() => useTodaySeries(new Date(t)));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(result.current.data!.feedBuckets[0].watts[384752]).toBe(1000);
    expect(result.current.data!.buckets[0].mainW).toBe(2000);
    expect(result.current.data!.buckets[0].solarW).toBe(1600);
  });

  it("fetches a whole past day at a negative offset", async () => {
    const spy = vi.spyOn(api, "fetchSeries").mockResolvedValue([] as any);
    const now = new Date("2026-09-08T05:00:00Z");
    renderHook(() => useTodaySeries(now, -1));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1].startMs).toBe(Date.parse("2026-09-06T14:00:00Z")); // Sep 7 00:00 Brisbane
    expect(spy.mock.calls[0][1].endMs).toBe(Date.parse("2026-09-07T14:00:00Z")); // Sep 8 00:00 Brisbane
  });
});
