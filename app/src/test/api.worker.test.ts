import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLive, fetchSeries } from "../api/worker";

afterEach(() => vi.unstubAllGlobals());

describe("fetchLive", () => {
  it("maps the positional array onto feed ids", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[10,20,30]", { status: 200 })));
    const v = await fetchLive("https://w", [1, 2, 3]);
    expect(v).toEqual({ 1: 10, 2: 20, 3: 30 });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 502 })));
    await expect(fetchLive("https://w", [1])).rejects.toThrow(/502/);
  });

  it("propagates AbortError without wrapping", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw abortErr; }));
    try {
      await fetchLive("https://w", [1]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toEqual(abortErr);
      expect((e as Error).name).toBe("AbortError");
    }
  });
});

describe("fetchSeries", () => {
  it("requests the series endpoint with minute-rounded bounds", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify([{ feedid: "1", data: [] }]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchSeries("https://w", { ids: [1, 2], startMs: 1788184801234, endMs: 1788184999999, intervalSeconds: 300 });
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("https://w/series?");
    expect(url).toContain("ids=1%2C2");
    expect(url).toContain("start=1788184800000"); // floored to minute
    expect(url).toContain("end=1788185040000");   // ceiled to minute
    expect(url).toContain("interval=300");
  });
});
