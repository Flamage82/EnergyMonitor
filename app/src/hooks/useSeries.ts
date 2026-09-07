import { useMemo } from "react";
import { config } from "../config";
import { fetchSeries } from "../api/worker";
import { buildBuckets, buildFeedBuckets, type FeedBucket, type GroupBucket } from "../lib/energy";
import { dayWindow, monthWindow } from "../lib/time";
import { usePolledFetch, type AsyncState } from "./usePolledFetch";

const seriesIds = [...config.feeds.main, ...config.feeds.nicki, ...config.feeds.solar];

// A day or month in the past is settled data — poll it daily rather than at the
// live-view cadence so paging back doesn't spin up a fast refetch loop.
const STATIC_POLL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Whole-month buckets for the calendar month `monthOffset` months back from
 * `now` (0 = current month-to-date). Past months poll daily rather than at the
 * bill-recompute cadence.
 */
export function useMonthData(now: Date = new Date(), monthOffset = 0): AsyncState<GroupBucket[]> {
  const { startMs, endMs } = useMemo(
    () => monthWindow(now, config.timezone, config.dataStartDate, monthOffset),
    [now, monthOffset],
  );
  const interval = monthOffset === 0 ? config.billRecomputeMs : STATIC_POLL_MS;
  return useBucketRange(startMs, endMs, interval, config.monthBucketSeconds);
}

/**
 * Intraday series for the calendar day `dayOffset` days back from `now`
 * (0 = today, up to `now`; a past day spans its full local midnight-to-midnight).
 */
export function useTodaySeries(now: Date = new Date(), dayOffset = 0): AsyncState<TodaySeries> {
  const { startMs: start, endMs: end } = useMemo(
    () => dayWindow(now, config.timezone, config.dataStartDate, dayOffset),
    [now, dayOffset],
  );
  const interval = dayOffset === 0 ? config.todayRefreshMs : STATIC_POLL_MS;
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
    interval,
    [start],
  );
}
