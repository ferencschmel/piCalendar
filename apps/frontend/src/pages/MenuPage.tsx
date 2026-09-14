import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MEALS,
  MEAL_LABELS,
  type Course,
  type Dish,
  type Meal,
  type MenuResponse,
  type Person,
  type PlannedDish,
  type Wish,
} from '@picalendar/shared';
import { api, ApiError } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useClock } from '../hooks/useClock.js';
import { usePlacement } from '../hooks/usePlacement.js';
import { DishLibrary } from '../components/DishLibrary.js';
import { MenuWeek } from '../components/MenuWeek.js';
import { WishList } from '../components/WishList.js';
import {
  WISHLIST_TARGET,
  parseTargetKey,
  payloadLabel,
  type DragPayload,
} from '../components/menuDrag.js';
import { addDays, weekdayIndex } from '../utils/calendarGrid.js';
import { dateKey } from '../utils/datetime.js';

/**
 * Slower than the dashboard: this page is driven by what someone is doing to
 * it, not by the clock. The poll exists so two people planning from two rooms
 * converge, and every mutation refreshes immediately anyway.
 */
const MENU_POLL_MS = 20_000;

const WEEK_DAYS = 7;

/** Which meal rows are on screen. Set once per household, so it is remembered. */
const MEALS_KEY = 'picalendar.menuMeals';

function loadVisibleMeals(): Meal[] {
  try {
    const stored = localStorage.getItem(MEALS_KEY);
    if (!stored) return [...MEALS];
    const parsed: unknown = JSON.parse(stored);
    const meals = MEALS.filter((meal) => Array.isArray(parsed) && parsed.includes(meal));
    // Never leave the grid with no rows at all — an empty page reads as broken
    // on a display nobody is looking after.
    return meals.length > 0 ? meals : [...MEALS];
  } catch {
    return [...MEALS];
  }
}

const WISHING_AS_KEY = 'picalendar.wishingAs';

interface MenuData {
  menu: MenuResponse;
  dishes: Dish[];
  wishes: Wish[];
  people: Person[];
}

export function MenuPage(): JSX.Element {
  const now = useClock();
  const [error, setError] = useState<string | null>(null);

  /**
   * `null` means "the week today falls in", the same override the dashboard's
   * period anchors use and for the same reason: an unattended display left on
   * next week should roll back on its own.
   */
  const [weekOverride, setWeekOverride] = useState<string | null>(null);

  const [visibleMeals, setVisibleMeals] = useState<Meal[]>(loadVisibleMeals);
  const [wishingAs, setWishingAs] = useState<string | null>(
    () => localStorage.getItem(WISHING_AS_KEY) || null,
  );

  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const todayKey = dateKey(now.toISOString(), timezone);
  const thisWeekStart = addDays(todayKey, -weekdayIndex(todayKey));
  const weekStart = weekOverride ?? thisWeekStart;

  const data = usePolling<MenuData>(
    async () => {
      const [menu, dishes, wishes, people] = await Promise.all([
        api.menu({ start: weekStart, days: WEEK_DAYS }),
        api.listDishes(),
        api.listWishes(),
        api.listPeople(),
      ]);
      return { menu, dishes, wishes, people };
    },
    MENU_POLL_MS,
    [weekStart],
  );

  const reportedTimezone = data.data?.menu.timezone;
  if (reportedTimezone && reportedTimezone !== timezone) setTimezone(reportedTimezone);

  const refresh = data.refresh;

  const run = useCallback(
    async (action: () => Promise<unknown>, failure: string): Promise<void> => {
      setError(null);
      try {
        await action();
        refresh();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : failure);
      }
    },
    [refresh],
  );

  /**
   * Which day each planned entry is currently on.
   *
   * `PlannedDish` carries no date of its own: on the wire it arrives inside the
   * day that holds it, which is what keeps the agenda from repeating a key on
   * every entry. The drop handler needs it to recognise a move that moves
   * nothing, so it is rebuilt here rather than added to the payload.
   */
  const entryDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of data.data?.menu.days ?? []) {
      for (const entry of day.entries) map.set(entry.entryId, day.date);
    }
    return map;
  }, [data.data]);

  /**
   * One handler for every combination of source and target.
   *
   * A dish and a wish both *become* a planned entry, and an entry dropped
   * elsewhere *moves*; keeping that in one place is what stops the page
   * growing a separate code path per pairing.
   */
  const handlePlace = useCallback(
    (payload: DragPayload, target: string) => {
      if (target === WISHLIST_TARGET) {
        // An already-planned dish dropped on the wishlist is someone asking for
        // it again, not a request to unplan it, so the entry is left alone.
        const dishId = payload.kind === 'wish' ? null : dishIdOf(payload);
        if (!dishId) return;
        void run(
          () => api.createWish({ dishId, personId: wishingAs }),
          'Could not add that to the wishlist',
        );
        return;
      }

      const cell = parseTargetKey(target);
      if (!cell) return;

      if (payload.kind === 'entry') {
        // Dropping an entry back on the cell it already occupies is a gesture
        // that changed nothing, and should not cost a write on the SD card.
        if (payload.entry.meal === cell.meal && entryDay.get(payload.entry.entryId) === cell.dayKey)
          return;

        void run(
          () => api.moveEntry(payload.entry.entryId, { dayKey: cell.dayKey, meal: cell.meal }),
          'Could not move that dish',
        );
        return;
      }

      const dishId = dishIdOf(payload);
      void run(
        () =>
          api.planDish({
            dayKey: cell.dayKey,
            dishId,
            meal: cell.meal,
            // Planning straight off the wishlist fulfils the wish in the same
            // request, so it cannot linger as "nobody has acted on this".
            ...(payload.kind === 'wish' ? { wishId: payload.wish.id } : {}),
          }),
        'Could not plan that dish',
      );
    },
    [run, wishingAs, entryDay],
  );

  const placement = usePlacement<DragPayload>(handlePlace);

  const onChangeCourse = useCallback(
    (entry: PlannedDish, course: Course) =>
      void run(() => api.moveEntry(entry.entryId, { course }), 'Could not change the course'),
    [run],
  );

  const onUnplan = useCallback(
    (entry: PlannedDish) =>
      void run(() => api.unplanEntry(entry.entryId), 'Could not remove that dish'),
    [run],
  );

  const onRemoveWish = useCallback(
    (wish: Wish) => void run(() => api.deleteWish(wish.id), 'Could not remove that wish'),
    [run],
  );

  const toggleMeal = useCallback((meal: Meal) => {
    setVisibleMeals((current) => {
      const next = current.includes(meal)
        ? current.filter((m) => m !== meal)
        : MEALS.filter((m) => m === meal || current.includes(m));
      const resolved = next.length > 0 ? next : current;
      try {
        localStorage.setItem(MEALS_KEY, JSON.stringify(resolved));
      } catch {
        // A kiosk browser with storage blocked still plans dinner fine; the
        // choice just does not survive a reload.
      }
      return resolved;
    });
  }, []);

  const changeWishingAs = useCallback((personId: string | null) => {
    setWishingAs(personId);
    try {
      if (personId) localStorage.setItem(WISHING_AS_KEY, personId);
      else localStorage.removeItem(WISHING_AS_KEY);
    } catch {
      /* see above */
    }
  }, []);

  const days = data.data?.menu.days ?? [];
  const rangeLabel = useMemo(() => weekLabel(weekStart), [weekStart]);
  const isThisWeek = weekStart === thisWeekStart;

  const held = placement.held;
  const ghost = held ? payloadLabel(held.payload) : null;

  return (
    <div className="menu-page d-flex flex-column">
      <header className="menu-page__header">
        <div className="menu-page__nav">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setWeekOverride(addDays(weekStart, -WEEK_DAYS))}
            aria-label="Previous week"
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
          <span className="menu-page__range">{rangeLabel}</span>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setWeekOverride(addDays(weekStart, WEEK_DAYS))}
            aria-label="Next week"
          >
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={isThisWeek}
            onClick={() => setWeekOverride(null)}
          >
            This week
          </button>
        </div>

        <div className="menu-page__meals" role="group" aria-label="Meals shown">
          {MEALS.map((meal) => (
            <button
              key={meal}
              type="button"
              className={`btn btn-sm ${
                visibleMeals.includes(meal) ? 'btn-primary' : 'btn-outline-secondary'
              }`}
              aria-pressed={visibleMeals.includes(meal)}
              onClick={() => toggleMeal(meal)}
            >
              {MEAL_LABELS[meal]}
            </button>
          ))}
        </div>

        <div className="menu-page__status">
          {held ? (
            <span className="badge text-bg-primary">
              <i className="bi bi-hand-index me-1" aria-hidden="true" />
              Tap a day to place {ghost?.name}
              <button
                type="button"
                className="btn-close btn-close-white ms-2"
                aria-label="Put it back"
                onClick={placement.cancel}
              />
            </span>
          ) : (
            <Link className="btn btn-sm btn-outline-secondary" to="/menu/dishes/new">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />
              New dish
            </Link>
          )}
        </div>
      </header>

      {(error || (data.error && !data.data)) && (
        <div className="alert alert-danger mx-3 mb-2 py-2" role="alert">
          {error ?? 'Could not load the menu.'}
        </div>
      )}

      <div className="menu-page__body">
        {data.data ? (
          <MenuWeek
            days={days}
            meals={visibleMeals}
            placement={placement}
            onChangeCourse={onChangeCourse}
            onUnplan={onUnplan}
          />
        ) : (
          <div className="flex-grow-1 d-flex align-items-center justify-content-center">
            {!data.error && (
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading the menu…</span>
              </div>
            )}
          </div>
        )}

        <aside className="menu-page__rail">
          <WishList
            wishes={data.data?.wishes ?? []}
            people={data.data?.people ?? []}
            wishingAs={wishingAs}
            onWishingAsChange={changeWishingAs}
            placement={placement}
            onRemove={onRemoveWish}
          />
          <DishLibrary dishes={data.data?.dishes ?? []} todayKey={todayKey} placement={placement} />
        </aside>
      </div>

      {/* Follows the finger during a drag. Rendered here rather than inside the
          source so it is not clipped by the panel's own scroll container. */}
      {held?.point && ghost && (
        <div
          className="menu-ghost"
          style={{ left: held.point.x, top: held.point.y, borderLeftColor: ghost.color }}
          aria-hidden="true"
        >
          <i className={`bi ${ghost.icon}`} style={{ color: ghost.color }} />
          <span>{ghost.name}</span>
        </div>
      )}
    </div>
  );
}

function dishIdOf(payload: DragPayload): string {
  switch (payload.kind) {
    case 'dish':
      return payload.dish.id;
    case 'wish':
      return payload.wish.dishId;
    case 'entry':
      return payload.entry.dishId;
  }
}

/** `14 – 20 September`, collapsing the month when the week does not cross one. */
function weekLabel(weekStart: string): string {
  const end = addDays(weekStart, WEEK_DAYS - 1);
  const startDate = new Date(`${weekStart}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const sameMonth = weekStart.slice(0, 7) === end.slice(0, 7);

  const start = startDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
    timeZone: 'UTC',
  });
  const finish = endDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return `${start} – ${finish}`;
}
