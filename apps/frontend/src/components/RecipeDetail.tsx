import { useEffect, useState } from 'react';
import { formatAmount, type Dish, type PlannedDish } from '@picalendar/shared';
import { api } from '../api/client.js';

/**
 * The recipe, on the wall, for a dish planned today.
 *
 * Fetched on open rather than shipped with the agenda: a wall display renders
 * a name and an icon all day and the prose only when someone asks, so sending
 * every recipe on every one-minute poll would be kilobytes an hour for text
 * nothing is showing.
 *
 * No auto-close timer, unlike the event popup. Somebody has opened this to
 * cook from it and is standing at the counter with their hands full.
 */
export function RecipeDetail({
  dish,
  onClose,
}: {
  dish: PlannedDish;
  onClose: () => void;
}): JSX.Element {
  const [full, setFull] = useState<Dish | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getDish(dish.dishId)
      .then((loaded) => {
        if (!cancelled) setFull(loaded);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dish.dishId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="recipe-overlay" role="dialog" aria-modal="true" aria-label={dish.name}>
      <div className="recipe-card">
        <header className="recipe-card__head">
          <h2 className="h4 mb-0">
            <i
              className={`bi ${dish.icon} me-2`}
              style={{ color: dish.color }}
              aria-hidden="true"
            />
            {dish.name}
          </h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </header>

        {failed && <p className="text-body-secondary mb-0">Could not load the recipe.</p>}

        {full && (
          <div className="recipe-card__body">
            {full.ingredients.length > 0 && (
              <section>
                <h3 className="recipe-card__subhead">Ingredients</h3>
                <ul className="recipe-card__ingredients">
                  {full.ingredients.map((ingredient, index) => (
                    <li key={`${ingredient.name}-${index}`}>
                      <span>{ingredient.name}</span>
                      <span className="text-body-secondary">{formatAmount(ingredient)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {full.recipe && (
              <section>
                <h3 className="recipe-card__subhead">Method</h3>
                {/* Pre-wrapped rather than parsed: this is prose from a recipe
                    card, and its line breaks are the only structure it has. */}
                <p className="recipe-card__method">{full.recipe}</p>
              </section>
            )}

            {full.sourceUrl && (
              <a href={full.sourceUrl} target="_blank" rel="noreferrer" className="small">
                <i className="bi bi-box-arrow-up-right me-1" aria-hidden="true" />
                Original recipe
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
