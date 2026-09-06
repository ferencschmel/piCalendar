import { useEffect, useState } from 'react';

/**
 * Ticking clock for the dashboard header. Re-aligns to the top of each minute
 * rather than using a fixed 60s interval, so the displayed time never lags.
 */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number;

    const schedule = (): void => {
      const msToNextMinute = 60_000 - (Date.now() % 60_000);
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, msToNextMinute + 50);
    };

    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return now;
}
