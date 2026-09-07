import { useMemo } from "react";
import { config } from "../config";
import { fetchSeries } from "../api/worker";
import { buildBuckets, buildFeedBuckets, type FeedBucket, type GroupBucket } from "../lib/energy";
import { effectiveMonthWindow, zonedTimeToUtcMs } from "../lib/time";
import { usePolledFetch, type AsyncState } from "./usePolledFetch";

const seriesIds = [...config.feeds.main, ...config.feeds.nicki, ...config.feeds.solar];

/**
 * Today's data in both shapes the chart needs: `buckets` grouped into
 * main/nicki/solar for the by-house view, `feedBuckets` kept per-circuit for the
 * by-load view. Both are derived from a single `/series` fetch (which already
 * pulls every feed id) so switching views costs no extra request.
 */
export interface TodaySeries {
  buckets: GroupBucket[];
  feedBuckets: FeedBucket[];
}

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

export function useTodaySeries(now: Date = new Date()): AsyncState<TodaySeries> {
  const start = useMemo(() => {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now).split("-").map(Number);
    return zonedTimeToUtcMs(key[0], key[1], key[2], 0, 0, 0, config.timezone);
  }, [now]);
  const end = now.getTime();
  return usePolledFetch<TodaySeries>(
    async (signal) => {
      const series = await fetchSeries(
        config.workerBaseUrl,
        { ids: seriesIds, startMs: start, endMs: end, intervalSeconds: config.bucketSeconds },
        signal,
      );
      return {
        buckets: buildBuckets(series, config.feeds),
        feedBuckets: buildFeedBuckets(series, seriesIds),
      };
    },
    config.todayRefreshMs,
    [start],
  );
}
