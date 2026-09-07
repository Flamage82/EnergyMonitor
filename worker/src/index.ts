import { FEED_IDS } from "./feeds";

export interface Env {
  EMONCMS_KEY: string;
  ALLOWED_ORIGIN: string;
}

const EMONCMS = "https://emoncms.org";

export function cors(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

export function jsonError(message: string, env: Env, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });
}

export async function proxy(
  clientUrl: string,
  upstreamURL: URL,
  env: Env,
  ctx: ExecutionContext,
  ttl: number,
  transform?: (upstreamText: string) => string,
): Promise<Response> {
  const cache = caches.default;
  // Cache key is derived from the client-facing URL only — it must never
  // contain the apikey we add below.
  const cacheKey = new Request(clientUrl);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  upstreamURL.searchParams.set("apikey", env.EMONCMS_KEY);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamURL.toString(), {
      headers: { Accept: "application/json" },
    });
  } catch {
    return jsonError("upstream fetch failed", env, 502);
  }
  if (!upstreamRes.ok) return jsonError(`upstream ${upstreamRes.status}`, env, 502);

  let body = await upstreamRes.text();
  if (transform) {
    try {
      body = transform(body);
    } catch {
      // Bad upstream body — don't cache or return garbage.
      return jsonError("upstream returned an unparseable body", env, 502);
    }
  }
  const res = new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, s-maxage=${ttl}`,
      ...cors(env),
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors(env), "Access-Control-Allow-Headers": "Content-Type" },
      });
    }
    if (request.method !== "GET") return jsonError("method not allowed", env, 405);

    const url = new URL(request.url);

    if (url.pathname === "/live") {
      const upstream = new URL(`${EMONCMS}/feed/fetch.json`);
      upstream.searchParams.set("ids", FEED_IDS.join(","));
      // Return an object keyed by feed id (zipping FEED_IDS with the upstream
      // positional array) so the client mapping is order-independent forever.
      return proxy(request.url, upstream, env, ctx, 10, (text) => {
        const arr = JSON.parse(text) as (number | null)[];
        const obj: Record<string, number | null> = {};
        FEED_IDS.forEach((id, i) => {
          obj[id] = arr[i] ?? null;
        });
        return JSON.stringify(obj);
      });
    }

    if (url.pathname === "/series") {
      const idsRaw = (url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (idsRaw.length === 0 || !start || !end) return jsonError("ids, start, end required", env, 400);

      const allowed = new Set<number>(FEED_IDS as readonly number[]);
      if (!idsRaw.every((id) => allowed.has(Number(id)))) return jsonError("unknown feed id", env, 403);

      const startMs = Number(start);
      const endMs = Number(end);
      const span = endMs - startMs;
      if (!Number.isFinite(span) || span <= 0 || span > 40 * 86400 * 1000) {
        return jsonError("bad range", env, 400);
      }

      let interval = Number(url.searchParams.get("interval") ?? "300");
      if (!Number.isFinite(interval) || interval < 60) interval = 60;

      const upstream = new URL(`${EMONCMS}/feed/data.json`);
      upstream.searchParams.set("ids", idsRaw.join(","));
      upstream.searchParams.set("start", String(startMs));
      upstream.searchParams.set("end", String(endMs));
      upstream.searchParams.set("interval", String(interval));
      upstream.searchParams.set("average", "1");
      upstream.searchParams.set("timeformat", "unixms");
      return proxy(request.url, upstream, env, ctx, 60);
    }

    return jsonError("not found", env, 404);
  },
} satisfies ExportedHandler<Env>;
