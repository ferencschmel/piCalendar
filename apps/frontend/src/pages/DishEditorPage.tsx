import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  COURSES,
  COURSE_LABELS,
  DEFAULT_DISH_COLOR,
  DEFAULT_DISH_ICON,
  SUGGESTED_UNITS,
  suggestedDishIcons,
  type Course,
  type Dish,
  type DishInputPayload,
  type Ingredient,
  type IngredientSuggestion,
} from '@picalendar/shared';
import { api, ApiError } from '../api/client.js';
import { dayKeyLabel } from '../utils/datetime.js';

/**
 * Entering and editing a dish.
 *
 * A route of its own rather than a dialog on the planner. A recipe with a
 * dozen ingredients does not fit in a modal, and a route survives a refresh, a
 * bookmark and the back button — all of which a household will use, because
 * this is the screen someone sits down with once and fills in properly.
 */

/**
 * The form's shape. Ingredients carry a client-side key so React can track a
 * row through a rename: keying on the name would remount the input on every
 * keystroke and lose the caret.
 */
interface Row extends Ingredient {
  key: string;
  /** The quantity as typed, so a half-entered "1." survives the keystroke. */
  quantityText?: string;
}

let rowCounter = 0;
function newRow(ingredient: Ingredient = { name: '', quantity: null, unit: '' }): Row {
  rowCounter += 1;
  return { ...ingredient, key: `row-${rowCounter}` };
}

/**
 * What the user typed in a quantity box, kept as text until it is saved.
 *
 * A number input that reads back as a number cannot tell "" from 0, and cannot
 * hold "1." while someone is still typing "1.5" — both of which make the field
 * fight the person using it.
 */
function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

interface Draft {
  name: string;
  recipe: string;
  sourceUrl: string;
  defaultCourse: Course;
  icon: string;
  color: string;
  active: boolean;
  ingredients: Row[];
}

function emptyDraft(): Draft {
  return {
    name: '',
    recipe: '',
    sourceUrl: '',
    defaultCourse: 'main',
    icon: DEFAULT_DISH_ICON,
    color: DEFAULT_DISH_COLOR,
    active: true,
    // One blank row to type into, so adding the first ingredient needs no tap.
    ingredients: [newRow()],
  };
}

function draftOf(dish: Dish): Draft {
  return {
    name: dish.name,
    recipe: dish.recipe ?? '',
    sourceUrl: dish.sourceUrl ?? '',
    defaultCourse: dish.defaultCourse,
    icon: dish.icon,
    color: dish.color,
    active: dish.active,
    ingredients: [...dish.ingredients.map((i) => newRow(i)), newRow()],
  };
}

/**
 * Remounted per dish, which is what keeps the form honest.
 *
 * Editing one dish and then another is a different subject, not a change to
 * the current one — without the key, a half-typed recipe would survive the
 * navigation and be saved onto whichever dish was opened next.
 */
export function DishEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <DishEditor key={id ?? 'new'} id={id} />;
}

function DishEditor({ id }: { id: string | undefined }): JSX.Element {
  const navigate = useNavigate();
  const isNew = id === undefined || id === 'new';

  const [dish, setDish] = useState<Dish | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  /** Set when the name collides, so the message can link to the existing dish. */
  const [collision, setCollision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  /**
   * Every ingredient already written down anywhere in the library.
   *
   * Fetched once on open rather than per keystroke: it is one small list for a
   * household's worth of recipes, and a datalist filters it in the browser.
   */
  const [suggestions, setSuggestions] = useState<IngredientSuggestion[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .listIngredientSuggestions()
      .then((loaded) => {
        if (!cancelled) setSuggestions(loaded);
      })
      // A missing suggestion list costs autocomplete, not the ability to save.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Only ever *fetches*. The blank draft is the initial state above, so there
  // is no branch here that synchronises React state with React state.
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    api
      .getDish(id)
      .then((loaded) => {
        if (cancelled) return;
        setDish(loaded);
        setDraft(draftOf(loaded));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load that dish.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  /**
   * Units this library already uses, offered ahead of the generic list — a
   * household that measures in "tin" and "punnet" should see those first.
   */
  const usedUnits = useMemo(
    () => [...new Set(suggestions.map((s) => s.unit).filter((unit) => unit !== ''))],
    [suggestions],
  );

  const patch = useCallback((changes: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  /**
   * Typing in the trailing blank row appends another one, so a cook fills in a
   * recipe without ever reaching for an "add ingredient" button.
   */
  const editRow = useCallback(
    (index: number, changes: Partial<Row>) => {
      setDraft((current) => {
        const ingredients = current.ingredients.map((row, i) => {
          if (i !== index) return row;
          const next = { ...row, ...changes };

          // Naming an ingredient the library already knows fills in the unit it
          // is usually measured in — the point of suggesting from what is
          // written down is that the second recipe agrees with the first. Only
          // ever fills a blank, so it cannot overwrite a deliberate choice.
          if (changes.name !== undefined && next.unit === '') {
            const known = suggestions.find(
              (s) => s.name.toLowerCase() === changes.name?.trim().toLowerCase(),
            );
            if (known) next.unit = known.unit;
          }
          return next;
        });

        const last = ingredients.at(-1);
        if (last && (last.name.trim() !== '' || last.unit !== '' || last.quantityText)) {
          ingredients.push(newRow());
        }
        return { ...current, ingredients };
      });
    },
    [suggestions],
  );

  const removeRow = useCallback((index: number) => {
    setDraft((current) => {
      const ingredients = current.ingredients.filter((_, i) => i !== index);
      return {
        ...current,
        ingredients: ingredients.length > 0 ? ingredients : [newRow()],
      };
    });
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCollision(null);

    // The trailing blank row is a typing affordance, not an ingredient.
    const ingredients = draft.ingredients
      .map((row) => ({
        name: row.name.trim(),
        // The text box is the source of truth while the form is open; an
        // unparseable "1.2.3" saves as unquantified rather than as a guess.
        quantity: row.quantityText === undefined ? row.quantity : parseQuantity(row.quantityText),
        unit: row.unit.trim(),
      }))
      .filter((row) => row.name !== '');

    const payload: DishInputPayload = {
      name: draft.name,
      recipe: draft.recipe.trim() || null,
      sourceUrl: draft.sourceUrl.trim() || null,
      defaultCourse: draft.defaultCourse,
      icon: draft.icon,
      color: draft.color,
      active: draft.active,
      ingredients,
    };

    try {
      if (isNew) await api.createDish(payload);
      else await api.updateDish(id, payload);
      navigate('/menu');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setCollision(draft.name.trim());
        setError(null);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not save the dish');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!dish) return;
    // Says what it will take with it. A dish deleted a year into a household's
    // history takes every evening it was served on with it, and "are you sure"
    // on its own does not tell anyone that.
    const cost =
      dish.timesCooked > 0
        ? `\n\nThis will also remove it from ${dish.timesCooked} planned ${
            dish.timesCooked === 1 ? 'meal' : 'meals'
          }.`
        : '';
    if (!window.confirm(`Delete “${dish.name}” from the library?${cost}`)) return;

    try {
      await api.deleteDish(dish.id);
      navigate('/menu');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete the dish');
    }
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading the dish…</span>
        </div>
      </div>
    );
  }

  return (
    <form className="dish-editor" onSubmit={(event) => void handleSubmit(event)}>
      <header className="dish-editor__header">
        <div className="dish-editor__crumb">
          <Link to="/menu">
            <i className="bi bi-chevron-left" aria-hidden="true" /> Menu
          </Link>
          <span aria-hidden="true">/</span>
          <span className="fw-semibold">{isNew ? 'New dish' : dish?.name}</span>
        </div>

        <div className="d-flex gap-2">
          {dish && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => patch({ active: !draft.active })}
            >
              {draft.active ? 'Retire' : 'Bring back'}
            </button>
          )}
          {dish && (
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={() => void handleDelete()}
            >
              Delete
            </button>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {collision && (
        <div className="alert alert-warning" role="alert">
          “{collision}” is already in the library. <Link to="/menu">Open the dish list</Link> to
          edit the one that is there, or give this one a different name.
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {!draft.active && (
        <div className="alert alert-secondary py-2" role="status">
          Retired. It keeps every evening it was served on, but will not appear in the planner.
        </div>
      )}

      <div className="dish-editor__body">
        <div className="dish-editor__main">
          <div>
            <label className="form-label" htmlFor="dish-name">
              Name
            </label>
            <input
              id="dish-name"
              className="form-control form-control-lg"
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
              required
              maxLength={120}
              autoFocus={isNew}
            />
          </div>

          <div className="row g-3">
            <div className="col-sm-4">
              <label className="form-label" htmlFor="dish-course">
                Usually a
              </label>
              <select
                id="dish-course"
                className="form-select"
                value={draft.defaultCourse}
                onChange={(event) => patch({ defaultCourse: event.target.value as Course })}
              >
                {COURSES.map((course) => (
                  <option key={course} value={course}>
                    {COURSE_LABELS[course]}
                  </option>
                ))}
              </select>
              <div className="form-text">Where it lands when dropped on a day.</div>
            </div>

            <div className="col-sm-5">
              <label className="form-label" htmlFor="dish-icon">
                Icon
              </label>
              <div className="input-group">
                <span className="input-group-text">
                  <i
                    className={`bi ${draft.icon}`}
                    style={{ color: draft.color }}
                    aria-hidden="true"
                  />
                </span>
                <select
                  id="dish-icon"
                  className="form-select"
                  value={draft.icon}
                  onChange={(event) => patch({ icon: event.target.value })}
                >
                  {[...new Set([draft.icon, ...suggestedDishIcons])].map((icon) => (
                    <option key={icon} value={icon}>
                      {icon.replace('bi-', '')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="col-sm-3">
              <label className="form-label" htmlFor="dish-color">
                Colour
              </label>
              <input
                id="dish-color"
                type="color"
                className="form-control form-control-color w-100"
                value={draft.color}
                onChange={(event) => patch({ color: event.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="form-label" htmlFor="dish-recipe">
              Recipe
            </label>
            <textarea
              id="dish-recipe"
              className="form-control dish-editor__recipe"
              value={draft.recipe}
              onChange={(event) => patch({ recipe: event.target.value })}
              rows={12}
              maxLength={8000}
              placeholder="However it would be written on a recipe card."
            />
          </div>

          <div>
            <label className="form-label" htmlFor="dish-source">
              Where it came from
            </label>
            <input
              id="dish-source"
              type="url"
              className="form-control"
              value={draft.sourceUrl}
              onChange={(event) => patch({ sourceUrl: event.target.value })}
              placeholder="https://…"
            />
          </div>
        </div>

        <aside className="dish-editor__side">
          <section className="card">
            <div className="card-header d-flex justify-content-between align-items-center">
              <span>Ingredients</span>
              <span className="text-body-secondary small">
                {draft.ingredients.filter((row) => row.name.trim()).length}
              </span>
            </div>
            <div className="card-body dish-editor__ingredients">
              {draft.ingredients.map((row, index) => {
                const isTrailing = index === draft.ingredients.length - 1;
                const isBlank =
                  !row.name && !row.unit && !row.quantityText && row.quantity === null;
                return (
                  <div className="input-group input-group-sm" key={row.key}>
                    <input
                      className="form-control"
                      value={row.name}
                      placeholder={isTrailing ? 'Ingredient' : ''}
                      aria-label={`Ingredient ${index + 1}`}
                      // Suggests what the library already knows, and accepts
                      // anything: a datalist offers, it does not constrain.
                      list="known-ingredients"
                      autoComplete="off"
                      onChange={(event) => editRow(index, { name: event.target.value })}
                      maxLength={120}
                    />
                    <input
                      className="form-control dish-editor__quantity"
                      // Text, not number: a number input cannot hold "1." while
                      // someone is still typing "1.5", and its spinners are a
                      // poor target on a touchscreen.
                      inputMode="decimal"
                      value={
                        row.quantityText ?? (row.quantity === null ? '' : String(row.quantity))
                      }
                      placeholder={isTrailing ? 'qty' : ''}
                      aria-label={`Quantity for ingredient ${index + 1}`}
                      onChange={(event) =>
                        editRow(index, {
                          quantityText: event.target.value,
                          quantity: parseQuantity(event.target.value),
                        })
                      }
                      maxLength={10}
                    />
                    <input
                      className="form-control dish-editor__unit"
                      value={row.unit}
                      placeholder={isTrailing ? 'unit' : ''}
                      aria-label={`Unit for ingredient ${index + 1}`}
                      list="known-units"
                      autoComplete="off"
                      onChange={(event) => editRow(index, { unit: event.target.value })}
                      maxLength={20}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => removeRow(index)}
                      aria-label={`Remove ingredient ${index + 1}`}
                      disabled={isTrailing && isBlank}
                    >
                      <i className="bi bi-x" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}

              {/* One list for the whole form rather than one per row: the rows
                  offer the same suggestions, and a datalist per row would put a
                  copy of the library in the DOM for every ingredient. */}
              <datalist id="known-ingredients">
                {suggestions.map((suggestion) => (
                  <option key={suggestion.name} value={suggestion.name}>
                    {suggestion.unit
                      ? `${suggestion.unit} · used in ${suggestion.uses}`
                      : `used in ${suggestion.uses}`}
                  </option>
                ))}
              </datalist>
              <datalist id="known-units">
                {[...new Set([...usedUnits, ...SUGGESTED_UNITS])].map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>

              <p className="form-text mb-0">
                Leave the quantity blank for things measured by eye — “salt, a pinch”.
              </p>
            </div>
          </section>

          {dish && (
            <section className="card">
              <div className="card-header">History</div>
              <div className="card-body">
                <dl className="row mb-0 small">
                  <dt className="col-6">Last cooked</dt>
                  <dd className="col-6">
                    {dish.lastCookedOn ? dayKeyLabel(dish.lastCookedOn) : 'never'}
                  </dd>
                  <dt className="col-6">Planned</dt>
                  <dd className="col-6">
                    {dish.timesCooked} {dish.timesCooked === 1 ? 'time' : 'times'}
                  </dd>
                  <dt className="col-6">Wished for by</dt>
                  <dd className="col-6">
                    {dish.wishedBy.length === 0
                      ? 'nobody'
                      : dish.wishedBy.map((w) => w.displayName ?? 'someone').join(', ')}
                  </dd>
                </dl>
              </div>
            </section>
          )}
        </aside>
      </div>
    </form>
  );
}
