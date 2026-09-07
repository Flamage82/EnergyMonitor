import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import worker from "../src/index";

const ctx = () => createExecutionContext();

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[1,2,3]", { status: 200 })));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  // Prevent cache bleed: a cached /live 200 must not shadow a later test's
  // upstream assertion.
  await caches.default.delete(new Request("https://w/live"));
  await caches.default.delete(
    new Request(
      "https://w/series?ids=384753&start=1788184800000&end=1788700000000&interval=300",
    ),
  );
});

describe("worker /live", () => {
  it("answers OPTIONS with CORS headers", async () => {
    const res = await worker.fetch(new Request("https://w/live", { method: "OPTIONS" }), env, ctx());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("proxies /live to emoncms feed/fetch and adds CORS + cache headers", async () => {
    const c = ctx();
    const res = await worker.fetch(new Request("https://w/live"), env, c);
    await waitOnExecutionContext(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([1, 2, 3]);
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
    const cached = await caches.default.match(new Request("https://w/live"));
    expect(cached).toBeTruthy();
    expect(cached!.url).not.toContain("apikey");
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
});
