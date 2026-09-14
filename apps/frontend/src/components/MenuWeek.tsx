import {
  COURSES,
  COURSE_LABELS,
  MEAL_LABELS,
  type Course,
  type Meal,
  type MenuDay,
  type PlannedDish,
} from '@picalendar/shared';
import type { Placement } from '../hooks/usePlacement.js';
import type { DragPayload } from './menuDrag.js';
import { targetKey } from './menuDrag.js';

interface Props {
  days: MenuDay[];
  meals: Meal[];
  placement: Placement<DragPayload>;
  onChangeCourse: (entry: PlannedDish, course: Course) => void;
  onUnplan: (entry: PlannedDish) => void;
}

/**
 * The week as a matrix: meals down, days across.
 *
 * Stacking the meals *inside* each day column was the obvious alternative and
 * it is worse on this display — it makes every drop target a third of a
 * seventh of the screen, which is smaller than a finger. As rows, a cell is
 * the full width of a day and a third of the grid's height, and the eye reads
 * "what are we eating for dinner this week" straight across.
 */
export function MenuWeek({ days, meals, placement, onChangeCourse, onUnplan }: Props): JSX.Element {
  const isHolding = placement.held !== null;

  return (
    <div className="menu-week" style={{ '--menu-week-rows': meals.length } as React.CSSProperties}>
      <div className="menu-week__corner" aria-hidden="true" />
      {days.map((day) => (
        <div
          key={`head-${day.date}`}
          className={`menu-week__dayhead ${day.isToday ? 'menu-week__dayhead--today' : ''}`}
        >
          <span className="menu-week__weekday">
            {new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', {
              weekday: 'short',
              timeZone: 'UTC',
            })}
          </span>
          <span className="menu-week__daynum">{Number(day.date.slice(8, 10))}</span>
        </div>
      ))}

      {meals.map((meal) => (
        <div key={meal} className="menu-week__row" role="row">
          <div className="menu-week__mealhead">{MEAL_LABELS[meal]}</div>

          {days.map((day) => {
            const target = targetKey(day.date, meal);
            const entries = day.entries.filter((entry) => entry.meal === meal);
            const isHover = placement.hoverTarget === target;

            return (
              <div
                key={`${day.date}-${meal}`}
                className={[
                  'menu-week__cell',
                  day.isToday ? 'menu-week__cell--today' : '',
                  isHolding ? 'menu-week__cell--open' : '',
                  isHover ? 'menu-week__cell--hover' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`${MEAL_LABELS[meal]} on ${day.date}`}
                {...placement.targetProps(target)}
              >
                {entries.map((entry) => (
                  <MenuChip
                    key={entry.entryId}
                    entry={entry}
                    placement={placement}
                    onChangeCourse={onChangeCourse}
                    onUnplan={onUnplan}
                  />
                ))}

                {/* Only rendered while something is in hand: an empty cell on a
                    wall display should read as "nothing planned", not as a row
                    of buttons nobody is being asked to press. */}
                {isHolding && <span className="menu-week__drop">Add here</span>}
                {!isHolding && entries.length === 0 && (
                  <span className="menu-week__empty" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * A planned dish. Draggable to another day, and carrying its own course picker
 * so correcting a drop that guessed wrong is one touch rather than a trip
 * through a dialog.
 */
function MenuChip({
  entry,
  placement,
  onChangeCourse,
  onUnplan,
}: {
  entry: PlannedDish;
  placement: Placement<DragPayload>;
  onChangeCourse: (entry: PlannedDish, course: Course) => void;
  onUnplan: (entry: PlannedDish) => void;
}): JSX.Element {
  const key = `entry:${entry.entryId}`;
  const isHeld = placement.held?.key === key;
  // Spread first and merge the style, rather than the other way round: the drag
  // handlers carry a `touch-action` of their own, and either ordering as a bare
  // pair silently drops one of the two.
  const source = placement.sourceProps(key, { kind: 'entry', entry });

  return (
    <div
      className={`menu-chip ${isHeld ? 'menu-chip--held' : ''}`}
      {...source}
      style={{ ...source.style, borderLeftColor: entry.color }}
    >
      {/* The name gets the whole width and the course sits under it. Side by
          side, the select squeezed every dish down to "Rak…" — and the name is
          the one thing on this chip a person is actually reading. */}
      <div className="menu-chip__top">
        <i className={`bi ${entry.icon} menu-chip__icon`} aria-hidden="true" />
        <span className="menu-chip__name" title={entry.name}>
          {entry.name}
        </span>
        <button
          type="button"
          className="menu-chip__remove"
          aria-label={`Remove ${entry.name}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onUnplan(entry)}
        >
          <i className="bi bi-x" aria-hidden="true" />
        </button>
      </div>

      <select
        className="menu-chip__course"
        value={entry.course}
        aria-label={`Course for ${entry.name}`}
        onChange={(event) => onChangeCourse(entry, event.target.value as Course)}
        // The chip owns the pointer for dragging; without this a press on the
        // select would lift the dish instead of opening the list.
        onPointerDown={(event) => event.stopPropagation()}
      >
        {COURSES.map((course) => (
          <option key={course} value={course}>
            {COURSE_LABELS[course]}
          </option>
        ))}
      </select>
    </div>
  );
}
