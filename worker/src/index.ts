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
  // carry the credential we attach to the upstream request below.
  const cacheKey = new Request(clientUrl);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamURL.toString(), {
      // Key in a header, not a query param: Cloudflare records subrequest URLs,
      // so `?apikey=` would surface the key in `wrangler tail` and Workers Logs.
      headers: { Accept: "application/json", Authorization: `Bearer ${env.EMONCMS_KEY}` },
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
      // /live ignores every query param, so the cache key is a constant — a
      // decorated URL must not miss the cache and re-hit upstream.
      return proxy("https://cache/live", upstream, env, ctx, 10, (text) => {
        const arr = JSON.parse(text) as (number | null)[];
        if (!Array.isArray(arr)) throw new Error("upstream /live body is not an array");
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

      // Normalize before validating or forwarding: dedupe, drop non-integers and
      // sort, so `384753,384753` and `384753.0` collapse onto one cache entry.
      const ids = [...new Set(idsRaw.map((s) => Number(s)))]
        .filter((n) => Number.isInteger(n))
        .sort((a, b) => a - b);
      if (ids.length === 0) return jsonError("ids required", env, 400);

      const allowed = new Set<number>(FEED_IDS as readonly number[]);
      if (!ids.every((id) => allowed.has(id))) return jsonError("unknown feed id", env, 403);

      const startMs = Number(start);
      const endMs = Number(end);
      const span = endMs - startMs;
      if (!Number.isFinite(span) || span <= 0 || span > 40 * 86400 * 1000) {
        return jsonError("bad range", env, 400);
      }

      let interval = Number(url.searchParams.get("interval") ?? "300");
      if (!Number.isFinite(interval) || interval < 60) interval = 60;
      // emoncms answers an over-large feed/data.json query with HTTP 200 and a
      // PHP "Allowed memory size exhausted" HTML body — a memory limit roughly
      // proportional to the total datapoint count. Cap the request near 100k
      // points by coarsening the interval; the app's own 900 s month request is
      // already well under this.
      const spanSeconds = span / 1000;
      const minInterval = Math.ceil((spanSeconds * ids.length) / 100_000);
      interval = Math.max(interval, 60, minInterval);

      const upstream = new URL(`${EMONCMS}/feed/data.json`);
      upstream.searchParams.set("ids", ids.join(","));
      upstream.searchParams.set("start", String(startMs));
      upstream.searchParams.set("end", String(endMs));
      upstream.searchParams.set("interval", String(interval));
      upstream.searchParams.set("average", "1");
      upstream.searchParams.set("timeformat", "unixms");

      // Cache key built from the normalized + clamped values, never the raw
      // client URL (and never the API key, which proxy() sends as an
      // Authorization header on the upstream request only).
      const cacheKey =
        `https://cache/series?ids=${ids.join(",")}&start=${startMs}&end=${endMs}&interval=${interval}`;

      return proxy(cacheKey, upstream, env, ctx, 60, (text) => {
        // An HTML fatal-error body throws here -> 502, nothing cached.
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error("upstream /series body is not an array");
        return text;
      });
    }

    return jsonError("not found", env, 404);
  },
} satisfies ExportedHandler<Env>;
