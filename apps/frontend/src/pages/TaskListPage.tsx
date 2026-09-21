import { Link } from 'react-router-dom';
import { formatMoney, scheduleLabel, DAYPART_LABELS, type Task } from '@picalendar/shared';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { dayKeyShortLabel } from '../utils/datetime.js';

/**
 * Every chore the household has written down, including the retired ones.
 *
 * The board answers "what do I have to do today" and is the page anybody
 * actually looks at. This one answers "what have we set up", which is asked
 * once in a while by whoever is changing it — and it is the only way back to a
 * retired task, which by design is nowhere on the board.
 */
const TASKS_POLL_MS = 30_000;

export function TaskListPage(): JSX.Element {
  const poll = usePolling(() => api.listTasks(), TASKS_POLL_MS);
  const tasks = poll.data ?? [];

  const active = tasks.filter((task) => task.active);
  const retired = tasks.filter((task) => !task.active);

  return (
    <div className="list-page">
      <div className="list-page__sticky">
        <header className="list-page__header">
          <Link to="/tasks" className="list-page__back">
            <i className="bi bi-chevron-left" aria-hidden="true" />
            <span>Board</span>
          </Link>
          <h1 className="h4 mb-0">All tasks</h1>
          <Link to="/tasks/new" className="btn btn-primary btn-sm ms-auto">
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            New
          </Link>
        </header>
      </div>

      {poll.loading && <p className="text-body-secondary">Loading…</p>}

      {poll.error && !poll.data && (
        <div className="alert alert-warning" role="alert">
          Could not load the tasks.
        </div>
      )}

      {poll.data && tasks.length === 0 && (
        <div className="list-page__empty">
          <i className="bi bi-check2-square list-page__empty-icon" aria-hidden="true" />
          <p className="mb-1">No tasks yet.</p>
          <Link to="/tasks/new">Write the first one up</Link>
        </div>
      )}

      {active.length > 0 && (
        <ul className="task-index">
          {active.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      {retired.length > 0 && (
        <>
          <h2 className="list-page__divider">
            <span>Retired</span>
          </h2>
          <ul className="task-index">
            {retired.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: Task }): JSX.Element {
  return (
    <li>
      <Link
        to={`/tasks/${task.id}`}
        className={`task-index__row${task.active ? '' : ' task-index__row--retired'}`}
      >
        <span className="task-index__icon" style={{ backgroundColor: task.color }}>
          <i className={`bi ${task.icon}`} aria-hidden="true" />
        </span>
        <span className="task-index__text">
          <span className="task-index__title">{task.title}</span>
          <span className="task-index__meta">
            {/* An unassigned chore says so rather than showing a blank, because
                "Anyone" is the answer and a gap reads as missing data. */}
            {task.personName ?? 'Anyone'} · {DAYPART_LABELS[task.daypart].toLowerCase()} ·{' '}
            {task.schedule.frequency === 'once'
              ? dayKeyShortLabel(task.schedule.startsOn)
              : scheduleLabel(task.schedule)}
            {/* Last, and only when priced: this list is read to find a chore,
                not to audit the rates, and an unpaid one has nothing to say. */}
            {task.amountCents > 0 && ` · ${formatMoney(task.amountCents)}`}
          </span>
        </span>
        <i className="bi bi-chevron-right task-index__chevron" aria-hidden="true" />
      </Link>
    </li>
  );
}
