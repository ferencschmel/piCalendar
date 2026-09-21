import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DAYPARTS,
  DAYPART_LABELS,
  DEFAULT_TASK_COLOR,
  DEFAULT_TASK_ICON,
  MAX_TASK_AMOUNT_CENTS,
  TASK_FREQUENCIES,
  WEEKDAY_LABELS,
  WEEKDAY_LONG_LABELS,
  formatMoney,
  scheduleLabel,
  suggestedTaskIcons,
  type Daypart,
  type Person,
  type Task,
  type TaskFrequency,
  type TaskInputPayload,
} from '@picalendar/shared';
import { api, ApiError } from '../api/client.js';
import { dayKeyLabel, dayKeyShortLabel } from '../utils/datetime.js';

/**
 * Writing up a chore: what it is, whose it is, and how often it comes round.
 *
 * A route of its own rather than a dialog on the board, for the same reasons
 * the dish editor is one: a schedule is more than fits in a modal, and a route
 * survives a refresh and the back button. Remounted per id, so a half-typed
 * chore cannot follow anyone onto the next one.
 */
export function TaskEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <TaskEditor key={id ?? 'new'} id={id} />;
}

const FREQUENCY_LABELS: Record<TaskFrequency, string> = {
  once: 'Just once',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

interface Draft {
  title: string;
  personId: string;
  note: string;
  daypart: Daypart;
  icon: string;
  color: string;
  /**
   * Held as the characters in the box rather than as cents, because a
   * half-typed `1.` is a state a number cannot hold — rounding it to cents on
   * every keystroke would delete the decimal point under the hand typing it.
   */
  amount: string;
  active: boolean;
  frequency: TaskFrequency;
  interval: number;
  weekdays: number[];
  startsOn: string;
  endsOn: string;
}

/** `250` to `2.50`, for putting a stored amount back in the box. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * What is in the box, as cents. Blank and nonsense both mean nothing — the
 * default a chore has when nobody has priced it.
 *
 * Rounded rather than truncated, and rounded *once*: a third of a dollar typed
 * as `0.333` is a cent question, and floating point is only allowed to touch
 * money on this line.
 */
function centsFromInput(amount: string): number {
  const dollars = Number(amount.trim());
  if (amount.trim() === '' || !Number.isFinite(dollars) || dollars < 0) return 0;
  return Math.min(Math.round(dollars * 100), MAX_TASK_AMOUNT_CENTS);
}

/** Today as a day key, read off the browser only to seed an empty form. */
function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function emptyDraft(): Draft {
  return {
    title: '',
    personId: '',
    note: '',
    daypart: 'morning',
    icon: DEFAULT_TASK_ICON,
    color: DEFAULT_TASK_COLOR,
    amount: '',
    active: true,
    frequency: 'once',
    interval: 1,
    weekdays: [],
    startsOn: todayKey(),
    endsOn: '',
  };
}

function draftOf(task: Task): Draft {
  return {
    title: task.title,
    personId: task.personId ?? '',
    note: task.note ?? '',
    daypart: task.daypart,
    icon: task.icon,
    color: task.color,
    // A chore nobody is paid for shows an empty box, not `0` — the placeholder
    // says what an empty one means, and a household not using this never has a
    // zero to wonder about.
    amount: task.amountCents === 0 ? '' : centsToInput(task.amountCents),
    active: task.active,
    frequency: task.schedule.frequency,
    interval: task.schedule.interval,
    weekdays: task.schedule.weekdays,
    startsOn: task.schedule.startsOn,
    endsOn: task.schedule.endsOn ?? '',
  };
}

function TaskEditor({ id }: { id?: string }): JSX.Element {
  const isNew = id === undefined;
  const navigate = useNavigate();

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [task, setTask] = useState<Task | null>(null);
  const [lastCompletedOn, setLastCompletedOn] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  useEffect(() => {
    if (isNew || id === undefined) return;
    let cancelled = false;

    api
      .getTask(id)
      .then((loaded) => {
        if (cancelled) return;
        setTask(loaded.task);
        setDraft(draftOf(loaded.task));
        setLastCompletedOn(loaded.lastCompletedOn);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load that task.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const patch = useCallback((changes: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  /**
   * Switching to weekly with no day chosen would be a schedule that produces
   * nothing, so the day the task already starts on is ticked for them. It is
   * the answer they almost certainly want, and it keeps the form from being
   * unsubmittable the instant it is changed.
   */
  const chooseFrequency = useCallback((frequency: TaskFrequency) => {
    setDraft((current) => {
      if (frequency !== 'weekly' || current.weekdays.length > 0) {
        return { ...current, frequency };
      }
      const anchor = new Date(`${current.startsOn}T00:00:00Z`);
      const weekday = (anchor.getUTCDay() + 6) % 7;
      return { ...current, frequency, weekdays: [weekday] };
    });
  }, []);

  const toggleWeekday = useCallback((index: number) => {
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(index)
        ? current.weekdays.filter((day) => day !== index)
        : [...current.weekdays, index].sort((a, b) => a - b),
    }));
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload: TaskInputPayload = {
      title: draft.title,
      // The picker's blank option is "Anyone", which is a real answer and not
      // a missing one — it goes to the wire as an explicit null.
      personId: draft.personId === '' ? null : draft.personId,
      note: draft.note.trim() === '' ? null : draft.note.trim(),
      daypart: draft.daypart,
      icon: draft.icon,
      color: draft.color,
      amountCents: centsFromInput(draft.amount),
      active: draft.active,
      frequency: draft.frequency,
      interval: draft.interval,
      weekdays: draft.weekdays,
      startsOn: draft.startsOn,
      endsOn: draft.endsOn === '' ? null : draft.endsOn,
    };

    try {
      if (isNew) await api.createTask(payload);
      else await api.updateTask(id!, payload);
      navigate('/tasks');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the task');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!task) return;
    // Says what it takes with it. Retiring keeps the history; deleting does
    // not, and "are you sure" on its own does not tell anyone that.
    if (
      !window.confirm(
        `Delete “${task.title}”?\n\nThis also forgets every day it was ticked off. ` +
          'Retiring it instead keeps that and takes it off the board.',
      )
    ) {
      return;
    }

    try {
      await api.deleteTask(task.id);
      navigate('/tasks');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete the task');
    }
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading the task…</span>
        </div>
      </div>
    );
  }

  const preview = scheduleLabel({
    frequency: draft.frequency,
    interval: draft.interval,
    weekdays: draft.weekdays,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn === '' ? null : draft.endsOn,
  });

  return (
    <form className="task-editor" onSubmit={(event) => void handleSubmit(event)}>
      <header className="task-editor__header">
        <div className="task-editor__crumb">
          <Link to="/tasks">
            <i className="bi bi-chevron-left" aria-hidden="true" /> Tasks
          </Link>
          <span aria-hidden="true">/</span>
          <span className="fw-semibold">{isNew ? 'New task' : task?.title}</span>
        </div>

        <div className="d-flex gap-2">
          {task && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => patch({ active: !draft.active })}
            >
              {draft.active ? 'Retire' : 'Bring back'}
            </button>
          )}
          {task && (
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

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {!draft.active && (
        <div className="alert alert-secondary py-2" role="status">
          Retired. It keeps every day it was ticked off, but will not appear on the board.
        </div>
      )}

      <div className="task-editor__body">
        <div className="task-editor__main">
          <div>
            <label className="form-label" htmlFor="task-title">
              Task
            </label>
            <input
              id="task-title"
              className="form-control form-control-lg"
              value={draft.title}
              maxLength={120}
              required
              placeholder="Take the bins out"
              onChange={(event) => patch({ title: event.target.value })}
            />
          </div>

          <div>
            <label className="form-label" htmlFor="task-person">
              Who does it
            </label>
            <select
              id="task-person"
              className="form-select"
              value={draft.personId}
              onChange={(event) => patch({ personId: event.target.value })}
            >
              {/* First, not last: a chore nobody is named on is an ordinary
                  answer, and burying it under the names would make it read as
                  a failure to choose. */}
              <option value="">Anyone</option>
              {people
                .filter((person) => person.active || person.id === draft.personId)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
            </select>
            {people.length === 0 && (
              <p className="form-text">
                No people yet — <Link to="/admin">add the household</Link> to give this to somebody.
              </p>
            )}
          </div>

          <fieldset>
            <legend className="form-label">When in the day</legend>
            <div className="btn-group" role="group">
              {DAYPARTS.map((daypart) => (
                <button
                  key={daypart}
                  type="button"
                  className={`btn ${draft.daypart === daypart ? 'btn-primary' : 'btn-outline-secondary'}`}
                  aria-pressed={draft.daypart === daypart}
                  onClick={() => patch({ daypart })}
                >
                  {DAYPART_LABELS[daypart]}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="form-label" htmlFor="task-amount">
              Worth <span className="text-body-secondary">(optional)</span>
            </label>
            <div className="input-group task-editor__amount">
              <span className="input-group-text">$</span>
              <input
                id="task-amount"
                type="number"
                inputMode="decimal"
                className="form-control"
                min={0}
                max={MAX_TASK_AMOUNT_CENTS / 100}
                step={0.25}
                value={draft.amount}
                placeholder="0"
                onChange={(event) => patch({ amount: event.target.value })}
              />
            </div>
            <p className="form-text">
              {/* Spelled out because a recurring chore's price is per *day* it
                  is done, which is the one thing somebody could read either
                  way — and the difference between 50c and $26 a year. */}
              {centsFromInput(draft.amount) === 0
                ? 'Chores are worth nothing unless you say otherwise.'
                : `${formatMoney(centsFromInput(draft.amount))} each time it is ticked off.`}
            </p>
          </div>

          <fieldset className="task-editor__schedule">
            <legend className="form-label">How often</legend>
            <div className="btn-group mb-3" role="group">
              {TASK_FREQUENCIES.map((frequency) => (
                <button
                  key={frequency}
                  type="button"
                  className={`btn ${draft.frequency === frequency ? 'btn-primary' : 'btn-outline-secondary'}`}
                  aria-pressed={draft.frequency === frequency}
                  onClick={() => chooseFrequency(frequency)}
                >
                  {FREQUENCY_LABELS[frequency]}
                </button>
              ))}
            </div>

            {draft.frequency === 'weekly' && (
              <div className="mb-3">
                <span className="form-label d-block">On these days</span>
                <div className="task-editor__weekdays">
                  {WEEKDAY_LABELS.map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      className={`task-editor__weekday${
                        draft.weekdays.includes(index) ? ' task-editor__weekday--on' : ''
                      }`}
                      aria-pressed={draft.weekdays.includes(index)}
                      aria-label={WEEKDAY_LONG_LABELS[index]}
                      onClick={() => toggleWeekday(index)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {draft.frequency !== 'once' && (
              <div className="mb-3">
                <label className="form-label" htmlFor="task-interval">
                  {draft.frequency === 'weekly' ? 'Every how many weeks' : 'Every how many months'}
                </label>
                <select
                  id="task-interval"
                  className="form-select"
                  value={draft.interval}
                  onChange={(event) => patch({ interval: Number(event.target.value) })}
                >
                  {[1, 2, 3, 4, 6, 12].map((value) => (
                    <option key={value} value={value}>
                      {value === 1
                        ? draft.frequency === 'weekly'
                          ? 'Every week'
                          : 'Every month'
                        : value === 2
                          ? draft.frequency === 'weekly'
                            ? 'Every other week'
                            : 'Every other month'
                          : `Every ${value} ${draft.frequency === 'weekly' ? 'weeks' : 'months'}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="row g-3">
              <div className="col-sm-6">
                <label className="form-label" htmlFor="task-starts">
                  {draft.frequency === 'once' ? 'On' : 'Starting'}
                </label>
                <input
                  id="task-starts"
                  type="date"
                  className="form-control"
                  value={draft.startsOn}
                  required
                  onChange={(event) => patch({ startsOn: event.target.value })}
                />
                {draft.frequency === 'monthly' && (
                  /* Spelled out because it is the one field doing two jobs: a
                     monthly task takes its date from here, so moving the start
                     moves every occurrence. */
                  <p className="form-text">This is also the day of the month it repeats on.</p>
                )}
              </div>

              {draft.frequency !== 'once' && (
                <div className="col-sm-6">
                  <label className="form-label" htmlFor="task-ends">
                    Until <span className="text-body-secondary">(optional)</span>
                  </label>
                  <input
                    id="task-ends"
                    type="date"
                    className="form-control"
                    value={draft.endsOn}
                    min={draft.startsOn}
                    onChange={(event) => patch({ endsOn: event.target.value })}
                  />
                  <p className="form-text">A term-time chore can stop by itself.</p>
                </div>
              )}
            </div>

            <p className="task-editor__preview">
              <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
              {draft.frequency === 'once'
                ? `Once, on ${dayKeyLabel(draft.startsOn)}`
                : `${preview}, from ${dayKeyShortLabel(draft.startsOn)}`}
              {draft.frequency !== 'once' &&
                draft.endsOn !== '' &&
                ` until ${dayKeyShortLabel(draft.endsOn)}`}
            </p>
          </fieldset>

          <div>
            <label className="form-label" htmlFor="task-note">
              Note <span className="text-body-secondary">(optional)</span>
            </label>
            <textarea
              id="task-note"
              className="form-control"
              rows={2}
              maxLength={500}
              value={draft.note}
              placeholder="Green bin this week"
              onChange={(event) => patch({ note: event.target.value })}
            />
          </div>
        </div>

        <aside className="task-editor__side">
          <div>
            <span className="form-label d-block">Icon</span>
            <div className="task-editor__icons">
              {suggestedTaskIcons.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`task-editor__icon${icon === draft.icon ? ' task-editor__icon--on' : ''}`}
                  aria-label={icon}
                  aria-pressed={icon === draft.icon}
                  onClick={() => patch({ icon })}
                >
                  <i className={`bi ${icon}`} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="form-label d-block" htmlFor="task-color">
              Colour
            </label>
            <input
              id="task-color"
              type="color"
              className="form-control form-control-color"
              value={draft.color}
              onChange={(event) => patch({ color: event.target.value })}
            />
          </div>

          {lastCompletedOn && (
            <p className="task-editor__last">
              <i className="bi bi-clock-history me-1" aria-hidden="true" />
              Last done {dayKeyShortLabel(lastCompletedOn)}
            </p>
          )}
        </aside>
      </div>
    </form>
  );
}
