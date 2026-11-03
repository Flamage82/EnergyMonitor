import { useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastUpdated: number | null;
}

const PENDING: AsyncState<unknown> = { data: null, error: null, loading: true, lastUpdated: null };

export function usePolledFetch<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: unknown[],
): AsyncState<T> {
  // Every snapshot is tagged with the deps that produced it. When the deps change
  // (a stepper moving to another month) the old snapshot is a different query's
  // answer, so it is withheld until the new fetch lands — a poll of the *same*
  // deps keeps showing its last good data.
  const key = JSON.stringify([intervalMs, ...deps]);
  const [snapshot, setSnapshot] = useState<{ key: string; state: AsyncState<T> }>({
    key, state: PENDING as AsyncState<T>,
  });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const update = (next: (s: AsyncState<T>) => AsyncState<T>) =>
      setSnapshot((cur) => ({ key, state: next(cur.key === key ? cur.state : (PENDING as AsyncState<T>)) }));

    const run = async () => {
      update((s) => ({ ...s, loading: true }));
      try {
        const data = await loaderRef.current(controller.signal);
        if (!cancelled) update(() => ({ data, error: null, loading: false, lastUpdated: Date.now() }));
      } catch (e) {
        if (!cancelled && (e as Error).name !== "AbortError") {
          update((s) => ({ ...s, error: (e as Error).message, loading: false }));
        }
      }
    };

    run();
    const timer = setInterval(run, intervalMs);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return snapshot.key === key ? snapshot.state : (PENDING as AsyncState<T>);
}
