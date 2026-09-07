import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker stub", () => {
  it("responds with ok:true", async () => {
    const res = await SELF.fetch("http://example.com/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
