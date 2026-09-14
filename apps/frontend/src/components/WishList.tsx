import type { Person, Wish } from '@picalendar/shared';
import type { Placement } from '../hooks/usePlacement.js';
import { WISHLIST_TARGET, type DragPayload } from './menuDrag.js';

interface Props {
  wishes: Wish[];
  people: Person[];
  /** Who new wishes are attributed to; `null` means nobody in particular. */
  wishingAs: string | null;
  onWishingAsChange: (personId: string | null) => void;
  placement: Placement<DragPayload>;
  onRemove: (wish: Wish) => void;
}

/**
 * What the household has asked for, waiting for a day.
 *
 * A drop target as well as a source: dragging a dish in from the library is
 * how a wish is made, which is the whole gesture the list exists for.
 *
 * Attribution is a single "wishing as" selector at the top rather than a
 * prompt on each wish. Asking who is wishing in the middle of a drag would
 * interrupt the one gesture this panel is built around, and a household at a
 * fridge sets this once and forgets it.
 */
export function WishList({
  wishes,
  people,
  wishingAs,
  onWishingAsChange,
  placement,
  onRemove,
}: Props): JSX.Element {
  const isHolding = placement.held !== null;
  const isHover = placement.hoverTarget === WISHLIST_TARGET;

  return (
    <section
      className={[
        'menu-panel',
        'menu-panel--wish',
        isHolding ? 'menu-panel--open' : '',
        isHover ? 'menu-panel--hover' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Wishlist"
      {...placement.targetProps(WISHLIST_TARGET)}
    >
      <header className="menu-panel__head">
        <span>
          <i className="bi bi-stars me-1" aria-hidden="true" />
          Wishlist
        </span>
        <span className="menu-panel__count">{wishes.length}</span>
      </header>

      <label className="menu-panel__as">
        <span className="text-body-secondary">Wishing as</span>
        <select
          className="form-select form-select-sm"
          value={wishingAs ?? ''}
          onChange={(event) => onWishingAsChange(event.target.value || null)}
        >
          <option value="">Anyone</option>
          {people
            .filter((person) => person.active)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
        </select>
      </label>

      <div className="menu-panel__body">
        {wishes.length === 0 && !isHolding && (
          <p className="menu-panel__hint">
            Drag a dish here, or tap one and tap this panel, to ask for it.
          </p>
        )}

        {wishes.map((wish) => {
          const key = `wish:${wish.id}`;
          return (
            <div
              key={wish.id}
              className={`menu-item ${placement.held?.key === key ? 'menu-item--held' : ''}`}
              {...placement.sourceProps(key, { kind: 'wish', wish })}
            >
              <i
                className={`bi ${wish.icon} menu-item__icon`}
                style={{ color: wish.color }}
                aria-hidden="true"
              />
              <span className="menu-item__name">{wish.dishName}</span>
              {wish.personName && (
                <span
                  className="menu-item__person"
                  style={{ backgroundColor: wish.personColor ?? undefined }}
                >
                  {wish.personName}
                </span>
              )}
              <button
                type="button"
                className="menu-item__remove"
                aria-label={`Remove ${wish.dishName} from the wishlist`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onRemove(wish)}
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </div>
          );
        })}

        {isHolding && <span className="menu-panel__drop">Add to the wishlist</span>}
      </div>
    </section>
  );
}
