import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { usePolledFetch } from "../hooks/usePolledFetch";

// @testing-library's waitFor only drives fake timers when a `jest` global with
// `advanceTimersByTime` exists. Vitest has no `jest` global, so we shim one that
// forwards to Vitest's fake-timer API. Scoped install/remove keeps this from
// leaking into Task 10's own describe block.
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

describe("usePolledFetch", () => {
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
