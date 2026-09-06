import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** Last time a fetch actually succeeded — drives the staleness indicator. */
  lastUpdatedAt: Date | null;
  refresh: () => void;
}

interface Snapshot<T> {
  data: T | null;
  error: Error | null;
  lastUpdatedAt: Date | null;
}

/**
 * Poll an endpoint on an interval, keeping the previous value visible while a
 * refresh is in flight so the wall display never flashes a spinner.
 *
 * Polling pauses while the tab is hidden and fires immediately on wake — a
 * kiosk browser that was asleep should not show yesterday's agenda for a
 * minute after the screen comes back.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): PollingState<T> {
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({
    data: null,
    error: null,
    lastUpdatedAt: null,
  });
  /** Bumping this re-runs the polling effect, which is how `refresh` works. */
  const [nonce, setNonce] = useState(0);

  // Callers usually pass an inline closure, so the identity changes every
  // render. Holding it in a ref keeps the interval stable while still calling
  // the newest closure.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    // Discards a response from a previous dependency set that lands after a
    // newer one has already been applied.
    let cancelled = false;

    const run = async (): Promise<void> => {
      try {
        const result = await fetcherRef.current();
        if (!cancelled) setSnapshot({ data: result, error: null, lastUpdatedAt: new Date() });
      } catch (caught) {
        // Keep the stale data on screen; a transient network blip on a Pi
        // should not blank a wall display.
        if (!cancelled) {
          setSnapshot((prev) => ({
            ...prev,
            error: caught instanceof Error ? caught : new Error(String(caught)),
          }));
        }
      }
    };

    void run();

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, intervalMs);

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void run();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, nonce, ...deps]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  return {
    ...snapshot,
    // Only the very first load has nothing to show; every later refresh keeps
    // rendering the previous agenda.
    loading: snapshot.data === null && snapshot.error === null,
    refresh,
  };
}
