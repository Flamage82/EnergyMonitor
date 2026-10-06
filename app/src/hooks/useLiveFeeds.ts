import { config } from "../config";
import { fetchLive, type LiveValues } from "../api/worker";
import { calibrateLive } from "../lib/calibration";
import { usePolledFetch, type AsyncState } from "./usePolledFetch";

export function useLiveFeeds(): AsyncState<LiveValues> {
  return usePolledFetch<LiveValues>(
    async (signal) => calibrateLive(
      await fetchLive(config.workerBaseUrl, config.allFeedIds, signal),
      config.calibration,
      Date.now(),
    ),
    config.livePollMs,
    [],
  );
}
