import { useMemo, useState } from 'react';
import { lastCookedLabel, type Dish } from '@picalendar/shared';
import { Link } from 'react-router-dom';
import type { Placement } from '../hooks/usePlacement.js';
import type { DragPayload } from './menuDrag.js';

interface Props {
  dishes: Dish[];
  /** Today in the display zone, so "12 days ago" agrees with the calendar. */
  todayKey: string;
  placement: Placement<DragPayload>;
}

/**
 * Everything the household knows how to cook.
 *
 * Every row carries when it was last cooked, which is the single most useful
 * thing a menu planner can say — it is what stops a family eating the same
 * thing three Tuesdays running, and it turns an alphabetical list into
 * something you can actually plan from.
 */
export function DishLibrary({ dishes, todayKey, placement }: Props): JSX.Element {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const active = dishes.filter((dish) => dish.active);
    if (!needle) return active;
    // Ingredients are searched too: "what can I do with aubergine" is a
    // question a household asks far more often than it recalls a dish's name.
    return active.filter(
      (dish) =>
        dish.name.toLowerCase().includes(needle) ||
        dish.ingredients.some((ingredient) => ingredient.name.toLowerCase().includes(needle)),
    );
  }, [dishes, query]);

  return (
    <section className="menu-panel menu-panel--library" aria-label="Dishes">
      <header className="menu-panel__head">
        <span>
          <i className="bi bi-journal-text me-1" aria-hidden="true" />
          Dishes
        </span>
        <Link className="menu-panel__action" to="/menu/dishes/new">
          <i className="bi bi-plus-lg" aria-hidden="true" /> New
        </Link>
      </header>

      <div className="menu-panel__search">
        <input
          id="dish-search"
          type="search"
          className="form-control form-control-sm"
          placeholder="Search dishes or ingredients…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search dishes"
        />
      </div>

      <div className="menu-panel__body">
        {dishes.length === 0 && (
          <p className="menu-panel__hint">
            Nothing in the library yet. <Link to="/menu/dishes/new">Add the first dish</Link> and it
            can be planned from here.
          </p>
        )}
        {dishes.length > 0 && visible.length === 0 && (
          <p className="menu-panel__hint">Nothing matches “{query}”.</p>
        )}

        {visible.map((dish) => {
          const key = `dish:${dish.id}`;
          return (
            <div
              key={dish.id}
              className={`menu-item ${placement.held?.key === key ? 'menu-item--held' : ''}`}
              {...placement.sourceProps(key, { kind: 'dish', dish })}
            >
              <i
                className={`bi ${dish.icon} menu-item__icon`}
                style={{ color: dish.color }}
                aria-hidden="true"
              />
              <span className="menu-item__name">{dish.name}</span>
              <span className="menu-item__meta">
                {lastCookedLabel(dish.lastCookedOn, todayKey)}
              </span>
              <Link
                className="menu-item__edit"
                to={`/menu/dishes/${dish.id}`}
                aria-label={`Edit ${dish.name}`}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <i className="bi bi-pencil" aria-hidden="true" />
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}
