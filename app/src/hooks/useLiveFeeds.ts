import { config } from "../config";
import { fetchLive, type LiveValues } from "../api/worker";
import { usePolledFetch, type AsyncState } from "./usePolledFetch";

export function useLiveFeeds(): AsyncState<LiveValues> {
  return usePolledFetch<LiveValues>(
    (signal) => fetchLive(config.workerBaseUrl, config.allFeedIds, signal),
    config.livePollMs,
    [],
  );
}
