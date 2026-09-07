import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLive, fetchSeries } from "../api/worker";

afterEach(() => vi.unstubAllGlobals());

describe("fetchLive", () => {
  it("maps the feed-id-keyed object onto the requested feed ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ "1": 10, "2": 20, "3": 30 }), { status: 200 })),
    );
    const v = await fetchLive("https://w", [1, 2, 3]);
    expect(v).toEqual({ 1: 10, 2: 20, 3: 30 });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 502 })));
    await expect(fetchLive("https://w", [1])).rejects.toThrow(/502/);
  });

  it("throws when the proxy returns an array instead of an id-keyed object", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[1,2,3]", { status: 200 })));
    await expect(fetchLive("https://w", [1, 2, 3])).rejects.toThrow(/unexpected shape/);
  });

  it("throws when none of the requested feed ids are present", async () => {
    // Silently returning all-zeros here would render a plausible-looking but
    // wrong dashboard; it has to surface as an error banner instead.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(fetchLive("https://w", [1, 2, 3])).rejects.toThrow(/no known feed values/);
  });

  it("throws when the proxy body is not JSON at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<b>Fatal error</b>", { status: 200 })));
    await expect(fetchLive("https://w", [1])).rejects.toThrow(/bad response from proxy/);
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
    const spy = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify([{ feedid: "1", data: [] }]), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await fetchSeries("https://w", { ids: [1, 2], startMs: 1788184801234, endMs: 1788184999999, intervalSeconds: 300 });
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain("https://w/series?");
    expect(url).toContain("ids=1%2C2");
    expect(url).toContain("start=1788184800000"); // floored to minute
    expect(url).toContain("end=1788185040000");   // ceiled to minute
    expect(url).toContain("interval=300");
  });

  it("throws when the proxy body is not a JSON array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"success":false}', { status: 200 })));
    await expect(
      fetchSeries("https://w", { ids: [1], startMs: 0, endMs: 60_000, intervalSeconds: 300 }),
    ).rejects.toThrow(/unexpected shape/);
  });

  it("throws when the proxy body is not JSON at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    await expect(
      fetchSeries("https://w", { ids: [1], startMs: 0, endMs: 60_000, intervalSeconds: 300 }),
    ).rejects.toThrow(/bad response from proxy/);
  });
});
