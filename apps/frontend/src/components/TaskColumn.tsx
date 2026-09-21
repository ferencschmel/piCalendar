import {
  DAYPARTS,
  DAYPART_LABELS,
  taskProgressLabel,
  type Daypart,
  type TaskColumn as Column,
  type TaskInstance,
} from '@picalendar/shared';
import { TaskCard } from './TaskCard.js';
import { dayKeyShortLabel } from '../utils/datetime.js';

/**
 * One person's share of the day.
 *
 * The overdue pile comes first and is the only part of the board that is
 * allowed to shout. Everything below it is today, split by daypart — the two
 * headings are always drawn once a daypart has anything in it, because
 * "morning" and "afternoon" are how a household reads its own day and an
 * unlabelled run of cards would make somebody guess which end of it they are
 * looking at.
 *
 * The column scrolls its own body rather than the page: the headings name
 * whose column it is, and a board that scrolled as one would take somebody
 * else's name off the screen to reach the bottom of yours.
 */
export function TaskColumn({
  column,
  todayKey,
  overdueFrom,
  onToggle,
}: {
  column: Column;
  todayKey: string;
  /** How far back the board looked, so an empty pile can say what it means. */
  overdueFrom: string;
  onToggle: (instance: TaskInstance, completed: boolean) => void;
}): JSX.Element {
  const byDaypart = DAYPARTS.map((daypart) => ({
    daypart,
    instances: column.due.filter((instance) => instance.daypart === daypart),
  })).filter((group) => group.instances.length > 0);

  const empty = column.due.length === 0 && column.overdue.length === 0;

  return (
    <section className="task-column" aria-label={column.displayName}>
      <header className="task-column__header">
        <span
          className="task-column__swatch"
          style={{ backgroundColor: column.color }}
          aria-hidden="true"
        />
        <span className="task-column__name">{column.displayName}</span>
        <span
          className={`task-column__count${column.outstanding === 0 ? ' task-column__count--clear' : ''}`}
        >
          {taskProgressLabel(column.due.length + column.overdue.length, column.outstanding)}
        </span>
      </header>

      <div className="task-column__body">
        {column.overdue.length > 0 && (
          <>
            <h3 className="task-column__heading task-column__heading--overdue">
              <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
              Still to do
            </h3>
            <ul className="task-column__list">
              {column.overdue.map((instance) => (
                <TaskCard
                  key={instance.id}
                  instance={instance}
                  todayKey={todayKey}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </>
        )}

        {byDaypart.map((group) => (
          <DaypartGroup
            key={group.daypart}
            daypart={group.daypart}
            instances={group.instances}
            todayKey={todayKey}
            onToggle={onToggle}
          />
        ))}

        {empty && (
          <p className="task-column__empty">
            <i className="bi bi-emoji-smile" aria-hidden="true" />
            Nothing to do
            {/* An empty pile is only as honest as the window behind it, which is
                the same reason the year view draws uncovered days as unknown
                rather than free. */}
            <span className="task-column__since">
              checked back to {dayKeyShortLabel(overdueFrom)}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function DaypartGroup({
  daypart,
  instances,
  todayKey,
  onToggle,
}: {
  daypart: Daypart;
  instances: TaskInstance[];
  todayKey: string;
  onToggle: (instance: TaskInstance, completed: boolean) => void;
}): JSX.Element {
  return (
    <>
      <h3 className="task-column__heading">{DAYPART_LABELS[daypart]}</h3>
      <ul className="task-column__list">
        {instances.map((instance) => (
          <TaskCard key={instance.id} instance={instance} todayKey={todayKey} onToggle={onToggle} />
        ))}
      </ul>
    </>
  );
}
