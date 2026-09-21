import {
  daypartRank,
  taskInstanceId,
  WEEK_LENGTH,
  type Person,
  type Task,
  type TaskColumn,
  type TaskEarningsLine,
  type TaskEarningsPerson,
  type TaskInstance,
  type TaskSchedule,
} from '@picalendar/shared';
import { addDaysToKey, toIso } from './time.js';

/**
 * Which days each task falls on, and how those days divide up between people.
 *
 * Computed rather than stored. A schedule is four integers and a date, and it
 * generates a day key by arithmetic — materialising that into rows would buy
 * nothing and cost writes on every window roll, which is the same trade
 * `util/birthdays.ts` and `util/menu.ts` already refuse. It also means a chore
 * is known outside the occurrence window, so a task planned for a month out is
 * answerable on a day no feed has been expanded for yet.
 *
 * Every date here is a `YYYY-MM-DD` key on both sides of every comparison, and
 * that is the point rather than an omission. The display zone was applied when
 * the board's day key was derived; pushing one back through a conversion is
 * exactly what moves a Thursday chore to Wednesday in zones past UTC+12.
 */

const MILLIS_PER_DAY = 86_400_000;
const MILLIS_PER_WEEK = MILLIS_PER_DAY * WEEK_LENGTH;

/** A day key as UTC midnight millis. Only ever compared with another of these. */
function toMillis(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00Z`);
}

/**
 * 0 for Monday through 6 for Sunday — the numbering the month and year grids
 * already use, because the household reading the wall starts its week on
 * Monday and a second convention here would eventually put a chore a column
 * out.
 */
export function weekdayIndex(dayKey: string): number {
  return (new Date(toMillis(dayKey)).getUTCDay() + WEEK_LENGTH - 1) % WEEK_LENGTH;
}

/** The Monday of a key's week — the unit an "every other week" interval counts. */
function mondayOf(dayKey: string): string {
  return addDaysToKey(dayKey, -weekdayIndex(dayKey));
}

/** How many days that month holds, so the 31st can land in February. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Does this schedule produce this day?
 *
 * Constant time, so the caller walks the days it wants to draw rather than
 * this walking a series forward from its anchor — a chore anchored years ago
 * is then no more work to answer than one anchored last week.
 */
export function occursOn(schedule: TaskSchedule, dayKey: string): boolean {
  if (dayKey < schedule.startsOn) return false;
  if (schedule.endsOn !== null && dayKey > schedule.endsOn) return false;

  if (schedule.frequency === 'once') return dayKey === schedule.startsOn;

  if (schedule.frequency === 'weekly') {
    if (!schedule.weekdays.includes(weekdayIndex(dayKey))) return false;
    // Counted between the Mondays rather than between the dates: an anchor of
    // Wednesday and a chore on Monday are the same week, and subtracting raw
    // days would put them in different ones.
    const weeks = Math.round(
      (toMillis(mondayOf(dayKey)) - toMillis(mondayOf(schedule.startsOn))) / MILLIS_PER_WEEK,
    );
    return weeks % schedule.interval === 0;
  }

  const year = Number(dayKey.slice(0, 4));
  const month = Number(dayKey.slice(5, 7));
  const anchorYear = Number(schedule.startsOn.slice(0, 4));
  const anchorMonth = Number(schedule.startsOn.slice(5, 7));
  const months = (year - anchorYear) * 12 + (month - anchorMonth);
  if (months % schedule.interval !== 0) return false;

  // A chore on the 31st still has to happen in February. Clamping to the last
  // day of a short month is how a household reads "monthly on the 31st", and
  // the alternative — skipping the month — loses the chore entirely.
  const target = Math.min(Number(schedule.startsOn.slice(8, 10)), daysInMonth(year, month));
  return Number(dayKey.slice(8, 10)) === target;
}

/** The days a schedule produces inside an inclusive range of day keys. */
export function taskDays(schedule: TaskSchedule, startKey: string, endKey: string): string[] {
  const days: string[] = [];
  for (let key = startKey; key <= endKey; key = addDaysToKey(key, 1)) {
    if (occursOn(schedule, key)) days.push(key);
  }
  return days;
}

/** A tick, as the repository hands it over: when, keyed by task and day. */
export type CompletionMap = Map<string, number>;

/** The key both the repository and this file store a tick under. */
export function completionKey(taskId: string, dayKey: string): string {
  return taskInstanceId(taskId, dayKey);
}

function toInstance(task: Task, dayKey: string, completions: CompletionMap): TaskInstance {
  const completedAt = completions.get(completionKey(task.id, dayKey));
  return {
    id: taskInstanceId(task.id, dayKey),
    taskId: task.id,
    title: task.title,
    note: task.note,
    icon: task.icon,
    color: task.color,
    // The task's price as it stands, which is what this card would pay if it
    // were ticked now. A tick already recorded carries its own, and the two are
    // deliberately different numbers.
    amountCents: task.amountCents,
    daypart: task.daypart,
    dayKey,
    recurring: task.schedule.frequency !== 'once',
    completed: completedAt !== undefined,
    completedAt: completedAt === undefined ? null : toIso(completedAt),
    missedCount: 1,
    missedSince: dayKey,
  };
}

/**
 * The days of a task that are still worth asking about, out of the days it
 * fell on before the board's own and nobody ticked.
 *
 * Two things happen here, and both come from one observation: a recurring
 * chore is done *once*, not once per day it was skipped. Nobody takes out
 * Tuesday's bins on Thursday; they take out the bins.
 *
 * So a missed day earlier than the task's most recent tick is dropped. Doing
 * the chore clears its backlog, because the backlog was never separately
 * actionable — and without this, ticking the pile would appear to do nothing,
 * as the next day back would simply take its place.
 *
 * What is left is then one card per task rather than one per day. That is not
 * a summary hiding the truth: the count comes with it, and the alternative is a
 * daily chore missed for a fortnight filling a column with fourteen identical
 * rows and pushing today's work off the bottom of a screen nobody can scroll.
 * It is also the only way the column's "left to do" is a number anybody can
 * act on — fourteen cards for one bin is not fourteen things to do.
 */
function overdueInstance(
  task: Task,
  completions: CompletionMap,
  overdueFrom: string,
  day: string,
): TaskInstance | null {
  const before = taskDays(task.schedule, overdueFrom, addDaysToKey(day, -1));
  if (before.length === 0) return null;

  // Includes the board's own day: doing this morning's bins settles last
  // Tuesday's just as surely as doing them on Tuesday would have.
  let lastDone: string | null = null;
  for (const key of [...before, day]) {
    if (completions.has(completionKey(task.id, key))) lastDone = key;
  }

  const missed = before.filter((key) => key > (lastDone ?? ''));
  const latest = missed.at(-1);
  if (latest === undefined) return null;

  // The card *is* the most recent missed day, so ticking it settles every
  // earlier one by the rule above rather than needing a second request.
  return {
    ...toInstance(task, latest, completions),
    missedCount: missed.length,
    missedSince: missed[0]!,
  };
}

/** Morning before afternoon, then by name so two chores never swap places. */
function compareDue(a: TaskInstance, b: TaskInstance): number {
  return daypartRank(a.daypart) - daypartRank(b.daypart) || a.title.localeCompare(b.title, 'en-GB');
}

/**
 * Oldest first. The chore that has been waiting longest is the one to do, and
 * a pile that grew top-down would put last week's bins below this morning's.
 */
function compareOverdue(a: TaskInstance, b: TaskInstance): number {
  return a.dayKey.localeCompare(b.dayKey) || compareDue(a, b);
}

/**
 * The board: one column per person, holding the day's tasks and whatever was
 * left behind.
 *
 * Not narrowed by presence, and that is deliberate in the way birthdays are.
 * The agenda hides a calendar nobody detected is home for, because an empty
 * house has no practices to show; a chore is the opposite — it is waiting
 * *because* somebody is out, and a bin that disappears from the wall while its
 * owner is at football is a bin that nobody takes out.
 *
 * Every active person gets a column even with nothing in it — "nothing to do
 * today" is an answer, and a name that vanishes reads as a fault. Anyone else
 * holding work gets one too: a person retired from the household mid-week, or
 * the unassigned pile, appears only when it has something, which keeps the
 * familiar columns in the positions the household reads them by while still
 * letting nothing waiting go unshown. The unassigned column sits last for the
 * same reason.
 */
export function buildTaskColumns(
  tasks: Task[],
  people: Person[],
  completions: CompletionMap,
  day: string,
  overdueFrom: string,
): TaskColumn[] {
  const due = new Map<string, TaskInstance[]>();
  const overdue = new Map<string, TaskInstance[]>();

  /** Null is a real column here, so the key is folded rather than the value. */
  const UNASSIGNED = '';
  const push = (
    into: Map<string, TaskInstance[]>,
    personId: string | null,
    instance: TaskInstance,
  ): void => {
    const key = personId ?? UNASSIGNED;
    const bucket = into.get(key);
    if (bucket) bucket.push(instance);
    else into.set(key, [instance]);
  };

  for (const task of tasks) {
    if (occursOn(task.schedule, day)) {
      push(due, task.personId, toInstance(task, day, completions));
    }

    // At most one card per task, standing for every day of it still waiting.
    const behind = overdueInstance(task, completions, overdueFrom, day);
    if (behind) push(overdue, task.personId, behind);
  }

  const column = (personId: string | null, displayName: string, color: string): TaskColumn => {
    const key = personId ?? UNASSIGNED;
    const dueHere = (due.get(key) ?? []).sort(compareDue);
    const overdueHere = (overdue.get(key) ?? []).sort(compareOverdue);
    const doneToday = dueHere.filter((instance) => instance.completed).length;

    return {
      personId,
      displayName,
      color,
      due: dueHere,
      overdue: overdueHere,
      outstanding: dueHere.length - doneToday + overdueHere.length,
      doneToday,
    };
  };

  const holdsWork = (key: string): boolean =>
    (due.get(key)?.length ?? 0) + (overdue.get(key)?.length ?? 0) > 0;

  const columns = people
    .filter((person) => person.active || holdsWork(person.id))
    .map((person) => column(person.id, person.displayName, person.color));

  if (holdsWork(UNASSIGNED)) columns.push(column(null, 'Anyone', '#6c757d'));

  return columns;
}

/* --- What it all added up to ---------------------------------------------- */

/**
 * One person's ticks of one task over a range, as SQL groups them.
 *
 * Grouped by the pair rather than handed over row by row: a month of a daily
 * chore is thirty rows that answer one line of the page, and summing them in
 * the database is both fewer rows over the wire and one indexed scan instead of
 * a walk.
 */
export interface EarningsRow {
  person_id: string | null;
  task_id: string;
  title: string;
  icon: string;
  color: string;
  completions: number;
  total_cents: number;
}

/** Biggest earner first, then by name so two equal chores never swap places. */
function compareLines(a: TaskEarningsLine, b: TaskEarningsLine): number {
  return b.totalCents - a.totalCents || a.title.localeCompare(b.title, 'en-GB');
}

/**
 * A month of ticks, divided up the way the board divides a day.
 *
 * Every active person gets a card even with nothing on it, for the same reason
 * every active person gets a column: "you have not earned anything yet this
 * month" is an answer, where a name that has vanished reads as a fault — and on
 * the first of the month that would be every name at once.
 *
 * Anyone else holding earnings gets one too. That covers somebody who has left
 * the household mid-month and the unassigned pile, which here also catches the
 * ticks of anybody deleted since: their rows keep the money and lose the name,
 * exactly as their chores keep the bin and lose the owner.
 */
export function buildEarnings(rows: EarningsRow[], people: Person[]): TaskEarningsPerson[] {
  /** Null is a real bucket here, so the key is folded rather than the value. */
  const UNASSIGNED = '';
  const lines = new Map<string, TaskEarningsLine[]>();

  for (const row of rows) {
    const key = row.person_id ?? UNASSIGNED;
    const line: TaskEarningsLine = {
      taskId: row.task_id,
      title: row.title,
      icon: row.icon,
      color: row.color,
      completions: row.completions,
      totalCents: row.total_cents,
    };
    const bucket = lines.get(key);
    if (bucket) bucket.push(line);
    else lines.set(key, [line]);
  }

  const card = (
    personId: string | null,
    displayName: string,
    color: string,
  ): TaskEarningsPerson => {
    const own = (lines.get(personId ?? UNASSIGNED) ?? []).sort(compareLines);
    return {
      personId,
      displayName,
      color,
      completions: own.reduce((total, line) => total + line.completions, 0),
      totalCents: own.reduce((total, line) => total + line.totalCents, 0),
      tasks: own,
    };
  };

  const earned = (key: string): boolean => (lines.get(key)?.length ?? 0) > 0;

  const cards = people
    .filter((person) => person.active || earned(person.id))
    .map((person) => card(person.id, person.displayName, person.color));

  if (earned(UNASSIGNED)) cards.push(card(null, 'Anyone', '#6c757d'));

  return cards;
}
