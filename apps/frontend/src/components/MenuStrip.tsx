import { MEAL_LABELS, byMeal, type PlannedDish } from '@picalendar/shared';

/**
 * What is planned to be eaten, along the bottom of a day column.
 *
 * The bottom rather than the all-day band at the top, because a meal is not an
 * all-day event — it has no start, no end and no slot on the hour grid — and
 * because that is how the day reads on a wall: the calendar above, dinner
 * underneath.
 *
 * The meal label only appears when more than one meal is planned. A household
 * that plans dinner and improvises the rest should see the dish and not a
 * column of the word "Dinner".
 */
export function MenuStrip({
  menu,
  onOpen,
}: {
  menu: PlannedDish[];
  /** Opens the recipe, for the dishes that have one. */
  onOpen?: (dish: PlannedDish) => void;
}): JSX.Element {
  const groups = byMeal(menu);
  const showMealLabels = groups.length > 1;

  return (
    <div className="menu-strip">
      {groups.map((group) => (
        <div key={group.meal} className="menu-strip__meal">
          {showMealLabels && <span className="menu-strip__label">{MEAL_LABELS[group.meal]}</span>}
          {group.entries.map((dish) => {
            const openable = dish.hasRecipe && onOpen !== undefined;
            return (
              <button
                key={dish.entryId}
                type="button"
                className={`menu-strip__dish ${openable ? 'menu-strip__dish--openable' : ''}`}
                style={{ borderLeftColor: dish.color }}
                disabled={!openable}
                title={dish.note ?? dish.name}
                onClick={openable ? () => onOpen(dish) : undefined}
              >
                <i className={`bi ${dish.icon}`} style={{ color: dish.color }} aria-hidden="true" />
                <span className="menu-strip__name">{dish.name}</span>
                {openable && (
                  <i className="bi bi-journal-text menu-strip__recipe" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
