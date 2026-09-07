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
