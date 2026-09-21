import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type TaskInstance } from '@picalendar/shared';
import { api } from '../api/client.js';
import { useClock } from '../hooks/useClock.js';
import { usePendingTicks } from '../hooks/usePendingTicks.js';
import { usePolling } from '../hooks/usePolling.js';
import { TaskColumn } from '../components/TaskColumn.js';
import { addDays } from '../utils/calendarGrid.js';
import { dateKey, dayKeyLabel } from '../utils/datetime.js';

/**
 * Who has to do what today.
 *
 * The board is one column per person, side by side, because that is the
 * question a household asks a wall: not "what is outstanding" but "what is
 * *mine*". Somebody walking past finds their own name and reads down, which
 * works from across a room in a way a single mixed list never does.
 *
 * Under each name sits the day, and above it whatever nobody did — the overdue
 * pile is the whole reason this is a board rather than a checklist. A chore
 * that quietly stopped being asked for is a chore that does not get done.
 */

/** The wall's own cadence: the same as the agenda's, and for the same reason. */
const BOARD_POLL_MS = 60_000;

/**
 * How long a board left on another day waits before returning to today.
 *
 * The day is an *override*, exactly as the dashboard's period anchor is:
 * nobody is looking after this display, and a board left on Thursday by
 * whoever last walked past would still be showing Thursday on Saturday —
 * with Saturday's chores nowhere and Thursday's ticks reading as today's.
 */
const IDLE_RESET_MS = 120_000;

export function TasksPage(): JSX.Element {
  const now = useClock();
  /** Null means "whatever day it is", which is what an unattended wall wants. */
  const [dayOverride, setDayOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const poll = usePolling(
    () => api.taskBoard(dayOverride ? { day: dayOverride } : {}),
    BOARD_POLL_MS,
    [dayOverride],
  );
  const { data, lastUpdatedAt, refresh } = poll;

  const { mark, settle, forget, resolve } = usePendingTicks(lastUpdatedAt);

  // Re-armed by every step, because each one changes `dayOverride` and so
  // re-runs this effect; it cancels itself once the board is home again.
  useEffect(() => {
    if (dayOverride === null) return;
    const timer = window.setTimeout(() => setDayOverride(null), IDLE_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [dayOverride]);

  const toggle = useCallback(
    async (instance: TaskInstance, completed: boolean) => {
      mark(instance.id, completed);
      setError(null);
      try {
        await api.tickTask(
          dayOverride ? { day: dayOverride } : {},
          instance.taskId,
          // The instance's own day, never the board's: the overdue pile is
          // full of other days, and ticking Tuesday's bins as today's would
          // leave that row sitting there while inventing a completion for now.
          instance.dayKey,
          completed,
        );
        settle(instance.id);
      } catch {
        forget(instance.id);
        setError('That did not save. Check the connection?');
      }
      refresh();
    },
    [dayOverride, forget, mark, refresh, settle],
  );

  /** Today as the *display* reckons it, which is what "overdue" is measured from. */
  const todayKey = data ? dateKey(now.toISOString(), data.timezone) : '';
  const day = data?.day ?? todayKey;
  const step = useCallback(
    (days: number) => setDayOverride((current) => addDays(current ?? day, days)),
    [day],
  );

  /**
   * The unconfirmed ticks folded back in before anything is drawn, so a card
   * ticked on the wall changes under the hand that ticked it rather than on
   * the next poll — and so the counts above it agree with the cards below.
   */
  const columns = (data?.columns ?? []).map((column) => {
    const due = column.due.map((instance) => ({
      ...instance,
      completed: resolve(instance.id, instance.completed),
    }));
    const overdue = column.overdue
      .map((instance) => ({ ...instance, completed: resolve(instance.id, instance.completed) }))
      // An overdue card that has just been ticked has been dealt with; leaving
      // it in a pile headed "still to do" would argue with its own tick.
      .filter((instance) => !instance.completed);
    const doneToday = due.filter((instance) => instance.completed).length;

    return {
      ...column,
      due,
      overdue,
      doneToday,
      outstanding: due.length - doneToday + overdue.length,
    };
  });

  const outstanding = columns.reduce((total, column) => total + column.outstanding, 0);

  return (
    <div className="task-board">
      <header className="task-board__header">
        <div className="task-board__title">
          <h1 className="h4 mb-0">Tasks</h1>
          <span className="task-board__outstanding">
            {data === null
              ? 'Loading…'
              : outstanding === 0
                ? 'Nothing outstanding'
                : `${outstanding} to do`}
          </span>
        </div>

        <div className="task-board__day">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            aria-label="Previous day"
            onClick={() => step(-1)}
          >
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
          <span className="task-board__date">{day ? dayKeyLabel(day) : ''}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            aria-label="Next day"
            onClick={() => step(1)}
          >
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
          {/* Only once somebody has wandered off today, for the same reason the
              dashboard's is: on an unattended display it is otherwise dead
              chrome that never lights up. */}
          {dayOverride !== null && dayOverride !== todayKey && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setDayOverride(null)}
            >
              Today
            </button>
          )}
        </div>

        <div className="task-board__links">
          {/* Beside "Manage" rather than in the nav bar: this is a question
              about the board, asked once a month, not a fifth place to be. */}
          <Link to="/tasks/earnings" className="btn btn-sm btn-outline-secondary">
            <i className="bi bi-piggy-bank me-1" aria-hidden="true" />
            Earnings
          </Link>
          <Link to="/tasks/all" className="btn btn-sm btn-outline-secondary">
            <i className="bi bi-sliders me-1" aria-hidden="true" />
            Manage
          </Link>
        </div>
      </header>

      {error && (
        <div className="alert alert-warning py-2 mb-2" role="alert">
          {error}
        </div>
      )}

      {poll.error && !data && (
        <div className="alert alert-warning" role="alert">
          Could not load the tasks.
        </div>
      )}

      {data && columns.length === 0 && (
        <div className="task-board__empty">
          <i className="bi bi-check2-square task-board__empty-icon" aria-hidden="true" />
          <p className="mb-1">Nobody has any tasks yet.</p>
          <p className="text-body-secondary mb-3">
            Tasks are assigned to people, so a household needs both.
          </p>
          <span className="d-inline-flex gap-2">
            <Link to="/tasks/new" className="btn btn-primary">
              Add a task
            </Link>
            <Link to="/admin" className="btn btn-outline-secondary">
              Add a person
            </Link>
          </span>
        </div>
      )}

      {columns.length > 0 && (
        <div className="task-board__columns">
          {columns.map((column) => (
            <TaskColumn
              key={column.personId ?? 'anyone'}
              column={column}
              todayKey={todayKey}
              overdueFrom={data?.overdueFrom ?? ''}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      <Link to="/tasks/new" className="task-board__add" aria-label="Add a task">
        <i className="bi bi-plus-lg" aria-hidden="true" />
      </Link>
    </div>
  );
}
