import { useCallback, useMemo, useState } from 'react';

export interface PendingTicks {
  /** What to draw for a row: the unconfirmed tick if there is one. */
  resolve: (key: string, confirmed: boolean) => boolean;
  /** Show a tick straight away, before the request has landed. */
  mark: (key: string, checked: boolean) => void;
  /** The request is home. The next poll to arrive is now the truth. */
  settle: (key: string) => void;
  /** Give up on one, because the request failed and the server was right. */
  forget: (key: string) => void;
}

/**
 * Ticks made on screen that the poll has not caught up with yet.
 *
 * A tick has to appear under the finger that made it. The request behind it is
 * a round trip from a phone in a supermarket, and a checkbox that waits for
 * one gets tapped twice.
 *
 * It holds in two stages, and the second is the one that matters. While the
 * request is in flight the tick stands unconditionally — a poll that was
 * already on its way when the tick was made carries the old value, and letting
 * it through would flick the box back. Once the request is home the tick
 * stands only until the next poll lands, whatever that poll says.
 *
 * That second stage is not politeness, it is the correctness condition. The
 * server is entitled to disagree with a tick it accepted: the grocery list is
 * derived, and a tick recorded against six onions for the week is genuinely
 * not a tick against two onions for tonight. An overlay that waited for the
 * server to agree would wait forever and show a line as bought that the shop
 * still has to be walked for.
 */
export function usePendingTicks(lastUpdatedAt: Date | null): PendingTicks {
  const [pending, setPending] = useState<Record<string, { checked: boolean; settledAt: number }>>(
    {},
  );

  /**
   * Derived rather than trimmed in an effect: there is then no second copy of
   * the truth to fall out of step with the poll, and the set only ever holds
   * keys somebody has tapped on this page.
   */
  const applied = useMemo(() => {
    const polledAt = lastUpdatedAt?.getTime() ?? 0;
    return Object.fromEntries(
      Object.entries(pending)
        // A settledAt of 0 is a request still in flight, which no poll outruns.
        .filter(([, tick]) => tick.settledAt === 0 || polledAt <= tick.settledAt)
        .map(([key, tick]) => [key, tick.checked]),
    );
  }, [lastUpdatedAt, pending]);

  const resolve = useCallback(
    (key: string, confirmed: boolean) => applied[key] ?? confirmed,
    [applied],
  );

  const mark = useCallback((key: string, checked: boolean) => {
    setPending((current) => ({ ...current, [key]: { checked, settledAt: 0 } }));
  }, []);

  const settle = useCallback((key: string) => {
    setPending((current) => {
      const tick = current[key];
      if (!tick) return current;
      return { ...current, [key]: { ...tick, settledAt: Date.now() } };
    });
  }, []);

  const forget = useCallback((key: string) => {
    setPending((current) => {
      if (!(key in current)) return current;
      const { [key]: _dropped, ...rest } = current;
      return rest;
    });
  }, []);

  return { resolve, mark, settle, forget };
}
