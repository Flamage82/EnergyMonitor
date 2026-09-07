import type { MultiFeedSeries } from "../lib/energy";

export type LiveValues = Record<number, number>;

const MINUTE = 60_000;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new Error(`network error contacting proxy: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`proxy responded ${res.status}`);
  return res.json();
}

export async function fetchLive(baseUrl: string, feedIds: number[], signal?: AbortSignal): Promise<LiveValues> {
  const arr = (await getJson(`${baseUrl}/live`, signal)) as (number | null)[];
  const out: LiveValues = {};
  feedIds.forEach((id, i) => { out[id] = Number(arr[i] ?? 0); });
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
  return (await getJson(`${baseUrl}/series?${qs.toString()}`, signal)) as MultiFeedSeries;
}
