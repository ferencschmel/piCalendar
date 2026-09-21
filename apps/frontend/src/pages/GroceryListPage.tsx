import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_GROCERY_DAYS,
  GROCERY_DAY_OPTIONS,
  listProgressLabel,
  type GroceryItem,
} from '@picalendar/shared';
import { api } from '../api/client.js';
import { useClock } from '../hooks/useClock.js';
import { usePendingTicks } from '../hooks/usePendingTicks.js';
import { usePolling } from '../hooks/usePolling.js';
import { TickRow } from '../components/TickRow.js';
import { dateKey, dayKeyRelativeLabel, dayKeyShortLabel } from '../utils/datetime.js';

/**
 * What to buy for the next few days.
 *
 * Every ingredient of every meal planned in the window, added up, one line per
 * thing to buy. It is not editable and there is no "add item" here: the list
 * is what the menu says, and a line typed on top of it would be a second
 * answer that silently wins. Anything else the shop needs goes on a list of
 * its own, which is what the other cards are for.
 */

/**
 * Slow. This is read in a supermarket over a phone connection, and every tick
 * already brings the whole list back with it. The poll is only here so two
 * people shopping from the same list converge.
 */
const GROCERY_POLL_MS = 45_000;

/** The window someone last shopped for, so a phone opens where it left off. */
const DAYS_KEY = 'picalendar.groceryDays';

function loadDays(): number {
  const stored = Number(localStorage.getItem(DAYS_KEY));
  return GROCERY_DAY_OPTIONS.includes(stored as (typeof GROCERY_DAY_OPTIONS)[number])
    ? stored
    : DEFAULT_GROCERY_DAYS;
}

export function GroceryListPage(): JSX.Element {
  const now = useClock();
  const [days, setDays] = useState(loadDays);
  const [error, setError] = useState<string | null>(null);

  const poll = usePolling(() => api.grocery({ days }), GROCERY_POLL_MS, [days]);
  const { data, lastUpdatedAt, refresh } = poll;

  const { mark, settle, forget, resolve } = usePendingTicks(lastUpdatedAt);

  const chooseDays = useCallback((next: number) => {
    setDays(next);
    localStorage.setItem(DAYS_KEY, String(next));
  }, []);

  const toggle = useCallback(
    async (item: GroceryItem, checked: boolean) => {
      mark(item.key, checked);
      setError(null);
      try {
        await api.tickGroceryItem({ days }, item.key, checked);
        settle(item.key);
      } catch {
        forget(item.key);
        setError('That tick did not save. Check the connection?');
      }
      refresh();
    },
    [days, forget, mark, refresh, settle],
  );

  const clearTicks = useCallback(async () => {
    try {
      await api.clearGroceryChecks({ days });
    } catch {
      setError('Could not clear the ticks.');
    }
    refresh();
  }, [days, refresh]);

  const items = data?.items ?? [];
  /**
   * Bought lines sink. What is left to find is the only part of a shopping
   * list anyone is reading, and it belongs at the top of the thumb's reach —
   * the heading below is what makes the row's jump explicable rather than
   * startling.
   */
  const open = items.filter((item) => !resolve(item.key, item.checked));
  const bought = items.filter((item) => resolve(item.key, item.checked));

  const todayKey = data ? dateKey(now.toISOString(), data.timezone) : '';

  return (
    <div className="list-page">
      <div className="list-page__sticky">
        <header className="list-page__header">
          <Link to="/lists" className="list-page__back">
            <i className="bi bi-chevron-left" aria-hidden="true" />
            <span>Lists</span>
          </Link>
          <h1 className="h4 mb-0">Grocery list</h1>
        </header>

        <div className="day-picker" role="group" aria-label="How many days to shop for">
          {GROCERY_DAY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`day-picker__option${option === days ? ' day-picker__option--active' : ''}`}
              aria-pressed={option === days}
              onClick={() => chooseDays(option)}
            >
              {option}
              <span className="day-picker__unit">{option === 1 ? 'day' : 'days'}</span>
            </button>
          ))}
        </div>

        <p className="list-page__summary">
          {data ? (
            <>
              {dayKeyShortLabel(data.start)} – {dayKeyShortLabel(data.end)} ·{' '}
              {listProgressLabel(items.length, bought.length, 'bought')}
            </>
          ) : (
            'Loading…'
          )}
        </p>
      </div>

      {error && (
        <div className="alert alert-warning py-2" role="alert">
          {error}
        </div>
      )}

      {data && items.length === 0 && (
        <div className="list-page__empty">
          <i className="bi bi-basket3 list-page__empty-icon" aria-hidden="true" />
          <p className="mb-1">
            {data.dishCount === 0
              ? 'Nothing is planned for these days.'
              : 'Nothing planned for these days has ingredients written down.'}
          </p>
          <Link to="/menu">Open the menu planner</Link>
        </div>
      )}

      {open.length > 0 && (
        <ul className="tick-list">
          {open.map((item) => (
            <GroceryRow
              key={item.key}
              item={item}
              todayKey={todayKey}
              checked={false}
              onToggle={toggle}
            />
          ))}
        </ul>
      )}

      {bought.length > 0 && (
        <>
          <h2 className="list-page__divider">
            <span>In the basket</span>
            <button type="button" className="btn btn-sm btn-link" onClick={() => void clearTicks()}>
              Clear
            </button>
          </h2>
          <ul className="tick-list">
            {bought.map((item) => (
              <GroceryRow
                key={item.key}
                item={item}
                todayKey={todayKey}
                checked
                onToggle={toggle}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GroceryRow({
  item,
  todayKey,
  checked,
  onToggle,
}: {
  item: GroceryItem;
  todayKey: string;
  checked: boolean;
  onToggle: (item: GroceryItem, checked: boolean) => void;
}): JSX.Element {
  return (
    <TickRow
      name={item.name}
      amount={item.amount}
      meta={<NeededBy item={item} todayKey={todayKey} />}
      checked={checked}
      onToggle={() => onToggle(item, !checked)}
    />
  );
}

/**
 * When the last meal that wants this is, and which meals those are.
 *
 * The *last* day rather than the first, because that is the number a shopper
 * needs at the fish counter: it is how long the thing has to keep, and
 * therefore whether to buy it fresh now, buy it frozen, or come back. The
 * first day is implied by the list being a shopping list — everything on it is
 * needed before the window is out.
 */
function NeededBy({ item, todayKey }: { item: GroceryItem; todayKey: string }): JSX.Element {
  const spans = item.firstNeededOn !== item.lastNeededOn;
  const day = dayKeyRelativeLabel(item.lastNeededOn, todayKey);

  return (
    <>
      <span className="tick-row__when">
        <i className="bi bi-clock-history" aria-hidden="true" />
        {spans ? `until ${day}` : `for ${day}`}
      </span>
      <span className="tick-row__for">{item.dishes.join(', ')}</span>
    </>
  );
}
