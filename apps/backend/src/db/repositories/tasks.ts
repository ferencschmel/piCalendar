import {
  taskInstanceId,
  type Daypart,
  type Task,
  type TaskFrequency,
  type TaskInput,
  type TaskUpdate,
} from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { nowEpoch, toIso } from '../../util/time.js';
import type { CompletionMap } from '../../util/tasks.js';

interface TaskRow {
  id: string;
  title: string;
  person_id: string | null;
  person_name: string | null;
  note: string | null;
  daypart: Daypart;
  icon: string;
  color: string;
  frequency: TaskFrequency;
  interval: number;
  weekdays: string;
  starts_on: string;
  ends_on: string | null;
  active: number;
  created_at: number;
  updated_at: number;
}

/**
 * `'0,3'` in, `[0, 3]` out. An empty column is an empty set rather than `['']`,
 * which is what a naive split would hand the weekday check to compare numbers
 * against.
 */
function parseWeekdays(stored: string): number[] {
  if (stored === '') return [];
  return stored
    .split(',')
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
}

/** Stored sorted and de-duplicated, so two equal schedules are equal strings. */
function serialiseWeekdays(weekdays: number[]): string {
  return [...new Set(weekdays)].sort((a, b) => a - b).join(',');
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    personId: row.person_id,
    personName: row.person_name,
    note: row.note,
    daypart: row.daypart,
    icon: row.icon,
    color: row.color,
    active: row.active === 1,
    schedule: {
      frequency: row.frequency,
      interval: row.interval,
      weekdays: parseWeekdays(row.weekdays),
      startsOn: row.starts_on,
      endsOn: row.ends_on,
    },
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

/**
 * The person's name comes along on every read, because every surface that
 * shows a task shows who it is for and the alternative is each of them joining
 * by hand. The join is a `LEFT` one: an unassigned task is not a broken row.
 */
const SELECT_TASK = `
  SELECT t.id, t.title, t.person_id, p.display_name AS person_name, t.note, t.daypart,
         t.icon, t.color, t.frequency, t.interval, t.weekdays, t.starts_on, t.ends_on,
         t.active, t.created_at, t.updated_at
  FROM task t
  LEFT JOIN person p ON p.id = t.person_id`;

export function listTasks(db: Db, { includeRetired = true } = {}): Task[] {
  return db
    .prepare<[], TaskRow>(
      `${SELECT_TASK}
       ${includeRetired ? '' : 'WHERE t.active = 1'}
       ORDER BY t.active DESC, t.title COLLATE NOCASE`,
    )
    .all()
    .map(toTask);
}

export function getTask(db: Db, id: string): Task | null {
  const row = db.prepare<[string], TaskRow>(`${SELECT_TASK} WHERE t.id = ?`).get(id);
  return row ? toTask(row) : null;
}

/**
 * Every task that could produce a day inside a window.
 *
 * Retired tasks are excluded here rather than filtered afterwards, and so are
 * the two ends of a task's own run — a chore that ends at half term cannot
 * appear in November, and one anchored in December cannot appear today. What
 * is left is a set small enough that the derivation walks it per day without
 * thinking about it.
 */
export function tasksInWindow(db: Db, startKey: string, endKey: string): Task[] {
  return db
    .prepare<[string, string], TaskRow>(
      `${SELECT_TASK}
       WHERE t.active = 1
         AND t.starts_on <= ?
         AND (t.ends_on IS NULL OR t.ends_on >= ?)
       ORDER BY t.title COLLATE NOCASE`,
    )
    .all(endKey, startKey)
    .map(toTask);
}

export function createTask(db: Db, input: TaskInput): Task {
  const id = newId();
  const now = nowEpoch();

  db.prepare(
    `INSERT INTO task (id, title, person_id, note, daypart, icon, color, frequency,
       interval, weekdays, starts_on, ends_on, active, created_at, updated_at)
     VALUES (@id, @title, @personId, @note, @daypart, @icon, @color, @frequency,
       @interval, @weekdays, @startsOn, @endsOn, @active, @now, @now)`,
  ).run({
    id,
    title: input.title,
    personId: input.personId,
    note: input.note,
    daypart: input.daypart,
    icon: input.icon,
    color: input.color,
    frequency: input.frequency,
    interval: input.frequency === 'once' ? 1 : input.interval,
    // A one-off has no weekdays to keep, and a monthly task takes its date from
    // the anchor. Dropping them on the way in means a task switched between
    // frequencies never carries a stale set that only reappears if it is
    // switched back.
    weekdays: input.frequency === 'weekly' ? serialiseWeekdays(input.weekdays) : '',
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    active: input.active ? 1 : 0,
    now,
  });

  return getTask(db, id)!;
}

/**
 * Patched against the task as it stands, which is also where the two
 * cross-field rules are enforced: a patch that moves `startsOn` past an
 * untouched `endsOn`, or switches a task to weekly without naming a day, is
 * only wrong once the merged schedule is seen whole. `null` here is the caller
 * saying "no such task"; the invalid cases throw so the route can answer 422
 * the way the schema would have.
 */
export function updateTask(db: Db, id: string, patch: TaskUpdate): Task | null {
  const existing = getTask(db, id);
  if (!existing) return null;

  const frequency = patch.frequency ?? existing.schedule.frequency;
  const weekdays = patch.weekdays ?? existing.schedule.weekdays;
  const startsOn = patch.startsOn ?? existing.schedule.startsOn;
  const endsOn = patch.endsOn === undefined ? existing.schedule.endsOn : patch.endsOn;

  if (frequency === 'weekly' && weekdays.length === 0) {
    throw new TaskScheduleError('weekdays', 'Pick at least one day of the week');
  }
  if (endsOn !== null && endsOn < startsOn) {
    throw new TaskScheduleError('endsOn', 'The last day cannot come before the first');
  }

  db.prepare(
    `UPDATE task SET title = @title, person_id = @personId, note = @note, daypart = @daypart,
       icon = @icon, color = @color, frequency = @frequency, interval = @interval,
       weekdays = @weekdays, starts_on = @startsOn, ends_on = @endsOn, active = @active,
       updated_at = @now
     WHERE id = @id`,
  ).run({
    id,
    title: patch.title ?? existing.title,
    personId: patch.personId === undefined ? existing.personId : patch.personId,
    note: patch.note === undefined ? existing.note : patch.note,
    daypart: patch.daypart ?? existing.daypart,
    icon: patch.icon ?? existing.icon,
    color: patch.color ?? existing.color,
    frequency,
    interval: frequency === 'once' ? 1 : (patch.interval ?? existing.schedule.interval),
    weekdays: frequency === 'weekly' ? serialiseWeekdays(weekdays) : '',
    startsOn,
    endsOn,
    active: (patch.active ?? existing.active) ? 1 : 0,
    now: nowEpoch(),
  });

  return getTask(db, id);
}

/** A merged schedule that contradicts itself, carrying the field to blame. */
export class TaskScheduleError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'TaskScheduleError';
  }
}

/** Takes the task's completions with it, by the foreign key's cascade. */
export function deleteTask(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM task WHERE id = ?').run(id).changes > 0;
}

/* --- Ticks ---------------------------------------------------------------- */

/**
 * Every tick between two day keys, across every task, in one range scan.
 *
 * Keyed by task *and* day, because completion belongs to the occurrence:
 * Monday's bins being out says nothing about next Monday's.
 */
export function completionsInWindow(db: Db, startKey: string, endKey: string): CompletionMap {
  const rows = db
    .prepare<[string, string], { task_id: string; day_key: string; completed_at: number }>(
      `SELECT task_id, day_key, completed_at FROM task_completion
       WHERE day_key BETWEEN ? AND ?`,
    )
    .all(startKey, endKey);

  return new Map(rows.map((row) => [taskInstanceId(row.task_id, row.day_key), row.completed_at]));
}

/**
 * Tick a task off for a day, or take the tick back.
 *
 * Re-ticking leaves the original time alone, exactly as a list item's does:
 * nothing was done twice, and overwriting it would lose the answer to "when
 * did the bins last go out" on the second tap of a touchscreen.
 */
export function setTaskCompletion(
  db: Db,
  taskId: string,
  dayKey: string,
  completed: boolean,
): void {
  if (completed) {
    db.prepare(
      `INSERT INTO task_completion (task_id, day_key, completed_at) VALUES (?, ?, ?)
       ON CONFLICT (task_id, day_key) DO NOTHING`,
    ).run(taskId, dayKey, nowEpoch());
  } else {
    db.prepare('DELETE FROM task_completion WHERE task_id = ? AND day_key = ?').run(taskId, dayKey);
  }
}

/** When a task was last ticked, for the editor's "last done" line. */
export function lastCompletedOn(db: Db, taskId: string): string | null {
  const row = db
    .prepare<[string], { day_key: string }>(
      'SELECT day_key FROM task_completion WHERE task_id = ? ORDER BY day_key DESC LIMIT 1',
    )
    .get(taskId);
  return row?.day_key ?? null;
}
