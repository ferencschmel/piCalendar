import { Link } from 'react-router-dom';
import { formatMoney, type TaskInstance } from '@picalendar/shared';
import { dayKeyRelativeLabel } from '../utils/datetime.js';

/**
 * One chore on one day.
 *
 * The whole card is the tick target, for the same reason a list row is — this
 * is reached by an arm stretched at a wall, not by a mouse — and the edit link
 * sits outside that target so a pencil cannot be hit while aiming for a tick.
 *
 * A ticked card stays where it is rather than sinking the way a bought grocery
 * line does. A shopping list is walked down once and the open items are all
 * anyone is reading; a chore board is read repeatedly by the same people all
 * day, and a card that moved under the hand that ticked it would cost them the
 * place they had learned.
 */
export function TaskCard({
  instance,
  todayKey,
  onToggle,
}: {
  instance: TaskInstance;
  /** For wording an overdue card's day as "yesterday" rather than a date. */
  todayKey: string;
  onToggle: (instance: TaskInstance, completed: boolean) => void;
}): JSX.Element {
  const overdue = instance.dayKey < todayKey && !instance.completed;

  return (
    <li className={`task-card${instance.completed ? ' task-card--done' : ''}`}>
      <button
        type="button"
        className="task-card__toggle"
        style={{ '--pical-task-color': instance.color } as React.CSSProperties}
        aria-pressed={instance.completed}
        onClick={() => onToggle(instance, !instance.completed)}
      >
        <span className="task-card__box" aria-hidden="true">
          <i className={`bi bi-${instance.completed ? 'check-lg' : ''}`} />
        </span>
        <i className={`bi ${instance.icon} task-card__icon`} aria-hidden="true" />
        <span className="task-card__text">
          <span className="task-card__title">
            {instance.title}
            {/* Only when there is one to show. A household that does not pay
                for chores never sees a `$0` it has to learn to ignore — and on
                a board that does, the number beside the words is the whole
                reason somebody walks over. */}
            {instance.amountCents > 0 && (
              <span className="task-card__worth">{formatMoney(instance.amountCents)}</span>
            )}
          </span>
          {instance.note && <span className="task-card__note">{instance.note}</span>}
          {overdue && (
            <span className="task-card__overdue">
              <i className="bi bi-exclamation-circle" aria-hidden="true" />
              {/* One card can stand for a fortnight of a daily chore, and the
                  count is the part that matters — "missed 13 times" is what
                  makes it worth walking over to, where a single date reads as
                  an ordinary slip. */}
              {instance.missedCount > 1
                ? `missed ${instance.missedCount} times since ${dayKeyRelativeLabel(instance.missedSince, todayKey)}`
                : dayKeyRelativeLabel(instance.dayKey, todayKey)}
            </span>
          )}
        </span>
      </button>
      <Link
        to={`/tasks/${instance.taskId}`}
        className="task-card__edit"
        aria-label={`Edit ${instance.title}`}
      >
        <i className="bi bi-pencil" aria-hidden="true" />
      </Link>
    </li>
  );
}
