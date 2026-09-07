import type { MultiFeedSeries } from "../lib/energy";

export type LiveValues = Record<number, number>;

const MINUTE = 60_000;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`proxy responded ${res.status}`);
    // Parsing inside the try so a non-JSON body (e.g. an upstream HTML error
    // page) becomes a wrapped error, not a bare SyntaxError.
    return await res.json();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    if (e instanceof Error && e.message.startsWith("proxy responded")) throw e;
    throw new Error(`bad response from proxy: ${(e as Error).message}`);
  }
}

export async function fetchLive(baseUrl: string, feedIds: number[], signal?: AbortSignal): Promise<LiveValues> {
  const obj = await getJson(`${baseUrl}/live`, signal);
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("proxy /live returned an unexpected shape");
  }
  const rec = obj as Record<string, number | null>;
  const out: LiveValues = {};
  let present = 0;
  for (const id of feedIds) {
    const v = rec[id];
    if (v != null) present += 1;
    out[id] = Number(v ?? 0);
  }
  // All-null/absent means the proxy answered but knows nothing about our feeds:
  // fail loudly rather than rendering a convincing wall of zeros.
  if (present === 0) throw new Error("proxy /live returned no known feed values");
  return out;
}

export async function fetchSeries(
  baseUrl: string,
  params: { ids: number[]; startMs: number; endMs: number; intervalSeconds: number },
  signal?: AbortSignal,
): Promise<MultiFeedSeries> {
  const start = Math.floor(params.startMs / MINUTE) * MINUTE;
  const end = Math.ceil(params.endMs / MINUTE) * MINUTE;
  const qs = new URLSearchParams({
    ids: params.ids.join(","),
    start: String(start),
    end: String(end),
    interval: String(params.intervalSeconds),
  });
  const data = await getJson(`${baseUrl}/series?${qs.toString()}`, signal);
  if (!Array.isArray(data)) throw new Error("proxy /series returned an unexpected shape");
  return data as MultiFeedSeries;
}
