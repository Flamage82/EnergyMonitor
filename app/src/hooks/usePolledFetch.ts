import { useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastUpdated: number | null;
}

export function usePolledFetch<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: unknown[],
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null, error: null, loading: true, lastUpdated: null,
  });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const data = await loaderRef.current(controller.signal);
        if (!cancelled) setState({ data, error: null, loading: false, lastUpdated: Date.now() });
      } catch (e) {
        if (!cancelled && (e as Error).name !== "AbortError") {
          setState((s) => ({ ...s, error: (e as Error).message, loading: false }));
        }
      }
    };

    run();
    const timer = setInterval(run, intervalMs);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return state;
}
