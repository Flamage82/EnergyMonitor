import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index";

const ctx = () => createExecutionContext();

// Canonical cache keys the worker derives (client query strings are normalized
// away before the key is built).
const LIVE_KEY = "https://cache/live";
const ALL_IDS = "384745,384746,384747,384748,384750,384751,384752,384753,384754,545440";
const BIG_START = 1788184800000;
const BIG_END = BIG_START + 31 * 86400 * 1000;
const seriesKey = (ids: string, start: number, end: number, interval: number) =>
  `https://cache/series?ids=${ids}&start=${start}&end=${end}&interval=${interval}`;
const Q_KEY = seriesKey("384753", 1788184800000, 1788700000000, 300);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[1,2,3]", { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  // Prevent cache bleed: a cached 200 must not shadow a later test's upstream
  // assertion.
  for (const key of [
    LIVE_KEY,
    Q_KEY,
    seriesKey(ALL_IDS, BIG_START, BIG_END, 268),
    seriesKey(ALL_IDS, BIG_START, BIG_END, 900),
  ]) {
    await caches.default.delete(new Request(key));
  }
});

describe("worker /live", () => {
  it("answers OPTIONS with CORS headers", async () => {
    const res = await worker.fetch(new Request("https://w/live", { method: "OPTIONS" }), env, ctx());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("proxies /live to emoncms feed/fetch, keys the array by FEED_IDS, and adds CORS + cache headers", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response("[1,2,3,4,5,6,7,8,9,10]", { status: 200 }),
    );
    const c = ctx();
    const res = await worker.fetch(new Request("https://w/live"), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(200);
    // The id->value pairing must follow FEED_IDS order, position for position.
    // This is the assertion that would have caught the client mis-alignment bug.
    expect(await res.json()).toEqual({
      "384745": 1,
      "384746": 2,
      "384747": 3,
      "384748": 4,
      "384750": 5,
      "384751": 6,
      "384752": 7,
      "384753": 8,
      "384754": 9,
      "545440": 10,
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=10");
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain("emoncms.org/feed/fetch.json");
    expect(calledUrl).toContain("ids=384745");
    expect(calledUrl).toContain("apikey=test-key");
    // apikey is server-side only: it must not leak to the client-facing
    // response or the cache key.
    expect(res.url).not.toContain("apikey");
    expect(JSON.stringify([...res.headers])).not.toContain("test-key");
    const cached = await caches.default.match(new Request(LIVE_KEY));
    expect(cached).toBeTruthy();
    expect(cached!.url).not.toContain("apikey");
    // The cached entry is the transformed object, not the raw upstream array.
    expect(await cached!.json()).toMatchObject({ "384745": 1, "545440": 10 });
  });

  it("serves /live?foo=1 from the same canonical cache entry as /live", async () => {
    const c1 = ctx();
    await worker.fetch(new Request("https://w/live"), env, c1);
    await waitOnExecutionContext(c1);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);

    // /live ignores every query param, so a decorated URL must not miss the cache
    // and re-hit upstream.
    const c2 = ctx();
    const res = await worker.fetch(new Request("https://w/live?foo=1"), env, c2);
    await waitOnExecutionContext(c2);
    expect(res.status).toBe(200);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
  });

  it("maps missing upstream positions to null", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response("[1,2,3]", { status: 200 }));
    const c = ctx();
    const res = await worker.fetch(new Request("https://w/live"), env, c);
    await waitOnExecutionContext(c);
    const body = (await res.json()) as Record<string, number | null>;
    expect(body["384745"]).toBe(1);
    expect(body["545440"]).toBe(null);
  });

  it("returns 502 when the upstream body is not valid JSON", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response("<html>nope</html>", { status: 200 }));
    const c = ctx();
    const res = await worker.fetch(new Request("https://w/live"), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(502);
    const cached = await caches.default.match(new Request(LIVE_KEY));
    expect(cached).toBeFalsy();
  });

  it("returns 502 when the upstream body is valid JSON but not an array", async () => {
    // emoncms occasionally answers feed/fetch.json with `false` or an error
    // object at HTTP 200 (auth hiccup / transient backend error). That must
    // surface as an error, not a cached all-null object.
    for (const bad of ["false", '{"success":false}']) {
      (globalThis.fetch as any).mockResolvedValueOnce(new Response(bad, { status: 200 }));
      const c = ctx();
      const res = await worker.fetch(new Request("https://w/live"), env, c);
      await waitOnExecutionContext(c);
      expect(res.status).toBe(502);
      const cached = await caches.default.match(new Request("https://w/live"));
      expect(cached).toBeFalsy();
    }
  });

  it("rejects POST with 405", async () => {
    const res = await worker.fetch(new Request("https://w/live", { method: "POST" }), env, ctx());
    expect(res.status).toBe(405);
  });

  it("returns 502 when upstream fails", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const c = ctx();
    const res = await worker.fetch(new Request("https://w/live"), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(502);
  });
});

describe("worker /series", () => {
  const q = "ids=384753&start=1788184800000&end=1788700000000&interval=300";

  it("proxies to feed/data.json forcing average=1 and unixms", async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify([{ feedid: "384753", data: [[1788184800000, -100]] }]), { status: 200 }),
    );
    const c = ctx();
    const res = await worker.fetch(new Request(`https://w/series?${q}`), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(200);
    const calledUrl = (globalThis.fetch as any).mock.calls.at(-1)[0] as string;
    expect(calledUrl).toContain("feed/data.json");
    expect(calledUrl).toContain("average=1");
    expect(calledUrl).toContain("timeformat=unixms");
  });

  it("rejects an unknown feed id with 403", async () => {
    const res = await worker.fetch(
      new Request("https://w/series?ids=999999&start=1&end=2&interval=300"), env, ctx());
    expect(res.status).toBe(403);
  });

  it("rejects a range over 40 days with 400", async () => {
    const res = await worker.fetch(
      new Request(`https://w/series?ids=384753&start=0&end=${41 * 86400 * 1000}&interval=300`), env, ctx());
    expect(res.status).toBe(400);
  });

  it("rejects missing start/end with 400", async () => {
    const res = await worker.fetch(new Request("https://w/series?ids=384753"), env, ctx());
    expect(res.status).toBe(400);
  });

  it("de-duplicates and canonicalizes the ids it forwards upstream", async () => {
    for (const raw of ["384753,384753", "384753.0", " 384753 ,384753"]) {
      const c = ctx();
      const res = await worker.fetch(
        new Request(`https://w/series?ids=${encodeURIComponent(raw)}&start=1788184800000&end=1788700000000&interval=300`),
        env,
        c,
      );
      await waitOnExecutionContext(c);
      expect(res.status).toBe(200);
      const calledUrl = new URL((globalThis.fetch as any).mock.calls.at(-1)[0] as string);
      expect(calledUrl.searchParams.get("ids")).toBe("384753");
      await caches.default.delete(new Request(Q_KEY));
    }
  });

  it("returns 502 and caches nothing when the upstream body is not a JSON array", async () => {
    // emoncms answers an over-large query with HTTP 200 and a PHP fatal-error
    // HTML body; a JSON object body is the other observed failure mode.
    for (const bad of [
      "<br /><b>Fatal error</b>:  Allowed memory size of 134217728 bytes exhausted",
      '{"success":false}',
    ]) {
      (globalThis.fetch as any).mockResolvedValueOnce(new Response(bad, { status: 200 }));
      const c = ctx();
      const res = await worker.fetch(new Request(`https://w/series?${q}`), env, c);
      await waitOnExecutionContext(c);
      expect(res.status).toBe(502);
      expect(await caches.default.match(new Request(Q_KEY))).toBeFalsy();
    }
  });

  it("coarsens a too-fine interval for a large span so upstream cannot be OOM'd", async () => {
    const c = ctx();
    const res = await worker.fetch(
      new Request(`https://w/series?ids=${ALL_IDS}&start=${BIG_START}&end=${BIG_END}&interval=60`),
      env,
      c,
    );
    await waitOnExecutionContext(c);
    expect(res.status).toBe(200);
    // 31 d x 10 feeds at 60 s would be ~446k points; the clamp caps it near 100k.
    const calledUrl = new URL((globalThis.fetch as any).mock.calls.at(-1)[0] as string);
    expect(Number(calledUrl.searchParams.get("interval"))).toBe(268);
  });

  it("leaves the app's own 900s month request alone", async () => {
    const c = ctx();
    const res = await worker.fetch(
      new Request(`https://w/series?ids=${ALL_IDS}&start=${BIG_START}&end=${BIG_END}&interval=900`),
      env,
      c,
    );
    await waitOnExecutionContext(c);
    expect(res.status).toBe(200);
    const calledUrl = new URL((globalThis.fetch as any).mock.calls.at(-1)[0] as string);
    expect(calledUrl.searchParams.get("interval")).toBe("900");
  });
});
