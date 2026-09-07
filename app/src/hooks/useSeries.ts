import { useMemo } from "react";
import { config } from "../config";
import { fetchSeries } from "../api/worker";
import { buildBuckets, type GroupBucket } from "../lib/energy";
import { effectiveMonthWindow, zonedTimeToUtcMs } from "../lib/time";
import { usePolledFetch, type AsyncState } from "./usePolledFetch";

const seriesIds = [...config.feeds.main, ...config.feeds.nicki, ...config.feeds.solar];

function useBucketRange(
  startMs: number,
  endMs: number,
  intervalMs: number,
  bucketSeconds: number,
): AsyncState<GroupBucket[]> {
  return usePolledFetch<GroupBucket[]>(
    async (signal) => {
      const series = await fetchSeries(
        config.workerBaseUrl,
        { ids: seriesIds, startMs, endMs, intervalSeconds: bucketSeconds },
        signal,
      );
      return buildBuckets(series, config.feeds);
    },
    intervalMs,
    [startMs, bucketSeconds],
  );
}

export function useMonthData(now: Date = new Date()): AsyncState<GroupBucket[]> {
  const start = useMemo(
    () => effectiveMonthWindow(now, config.timezone, config.dataStartDate).startMs,
    [now],
  );
  return useBucketRange(start, now.getTime(), config.billRecomputeMs, config.monthBucketSeconds);
}

export function useTodaySeries(now: Date = new Date()): AsyncState<GroupBucket[]> {
  const start = useMemo(() => {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now).split("-").map(Number);
    return zonedTimeToUtcMs(key[0], key[1], key[2], 0, 0, 0, config.timezone);
  }, [now]);
  return useBucketRange(start, now.getTime(), config.todayRefreshMs, config.bucketSeconds);
}
