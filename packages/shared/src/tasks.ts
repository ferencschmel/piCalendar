import { z } from 'zod';
import { dayKeySchema } from './menu.js';

/**
 * Chores: who does what, and on which day.
 *
 * A task names a *day* rather than an instant, which puts it with birthdays
 * and menus rather than with events. Nobody takes the bins out at 18:42 — they
 * take them out on Thursday morning — and anchoring that to an epoch second
 * would have a display east of UTC asking for it on Wednesday. So a task's
 * dates are `YYYY-MM-DD` keys end to end, and nothing here ever pushes one
 * back through a timezone conversion.
 *
 * Recurring tasks are not materialised, for the same reason recurring
 * birthdays are not: they are a handful of integers that generate a day key by
 * arithmetic, and expanding them into rows would cost writes on every window
 * roll while capping them at a window a chore has no reason to respect.
 */

/* --- When in the day ------------------------------------------------------ */

/**
 * The part of the day a chore belongs to. Deliberately coarse: a household
 * runs on "before school" and "after school", and a clock time would invite
 * somebody to be five minutes late for the washing up.
 *
 * Array order is the order of the day, and it is the sort key the board uses,
 * so it lives here rather than being re-derived by a comparator.
 */
export const DAYPARTS = ['morning', 'afternoon'] as const;
export type Daypart = (typeof DAYPARTS)[number];
export const daypartSchema = z.enum(DAYPARTS);

export const DAYPART_LABELS: Record<Daypart, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
};

/** Position of a daypart in the day, for sorting a person's column. */
export function daypartRank(daypart: Daypart): number {
  const index = DAYPARTS.indexOf(daypart);
  return index === -1 ? DAYPARTS.length : index;
}

/* --- How often ------------------------------------------------------------ */

/**
 * `once` is a frequency rather than a separate kind of row, which is what lets
 * one table, one derivation and one completion key serve both. A one-off is
 * then a schedule that happens to produce a single day.
 */
export const TASK_FREQUENCIES = ['once', 'weekly', 'monthly'] as const;
export type TaskFrequency = (typeof TASK_FREQUENCIES)[number];
export const taskFrequencySchema = z.enum(TASK_FREQUENCIES);

export const WEEK_LENGTH = 7;

/**
 * 0 for Monday through 6 for Sunday — the same numbering the month and year
 * grids use, because the household reading the wall starts its week on Monday
 * and a second convention here would eventually put a chore on the wrong
 * column.
 */
export const weekdaySchema = z
  .number()
  .int()
  .min(0)
  .max(WEEK_LENGTH - 1);

/** Monday-first, short enough for a chip on a narrow column. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_LONG_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/**
 * How far back the board looks for chores nobody did.
 *
 * Bounded on purpose, and this is the same decision the occurrence window
 * makes. A recurring task walked back without a limit is an unbounded loop,
 * and a display that never forgets turns into a wall of shame for a bin
 * somebody missed in March — which is read once, despaired of, and then
 * ignored along with everything true beside it. A fortnight is long enough
 * that a chore skipped over a holiday is still asked for, and short enough
 * that the column stays a list of things a person can actually do today.
 *
 * The board reports the day it looked back to, so "nothing overdue" can be
 * distinguished from "nothing we still know about" — the same distinction the
 * density endpoint's coverage window preserves.
 */
export const TASK_OVERDUE_LOOKBACK_DAYS = 14;

/* --- The task itself ------------------------------------------------------ */

/** Same constraint the dish and birthday icons take: a Bootstrap Icons class. */
const taskIconSchema = z
  .string()
  .trim()
  .regex(/^bi-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a Bootstrap icon name, e.g. bi-check2-square')
  .max(60);

const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour, e.g. #4c6ef5');

export const DEFAULT_TASK_ICON = 'bi-check2-square';
export const DEFAULT_TASK_COLOR = '#4c6ef5';

/* --- What it pays --------------------------------------------------------- */

/**
 * The most a single chore can be worth, in cents.
 *
 * A bound rather than a judgement about pocket money: a stray keystroke in a
 * number field is how `$5` becomes `$500`, and the first anyone would know of
 * it is a monthly total nobody can explain. A thousand is far above anything a
 * household pays for taking the bins out and far below a typo.
 */
export const MAX_TASK_AMOUNT_CENTS = 100_000;

/**
 * Money is an integer of minor units everywhere in this codebase, and only
 * becomes a decimal on its way onto a screen. Counting in cents is what keeps a
 * month of 50c chores from summing to $11.999999999999998 — a total nobody can
 * argue with is the entire value of the feature.
 */
export const amountCentsSchema = z
  .number()
  .int('An amount is a whole number of cents')
  .min(0)
  .max(MAX_TASK_AMOUNT_CENTS);

export const DEFAULT_TASK_AMOUNT_CENTS = 0;

/** Offered in the editor's picker. Any valid `bi-*` name is accepted. */
export const suggestedTaskIcons = [
  'bi-check2-square',
  'bi-trash',
  'bi-basket',
  'bi-droplet',
  'bi-flower1',
  'bi-book',
  'bi-backpack',
  'bi-house',
  'bi-brush',
  'bi-bicycle',
  'bi-music-note-beamed',
  'bi-piggy-bank',
] as const;

/**
 * A schedule, before it knows which task it belongs to.
 *
 * `startsOn` carries two jobs, and they are the same job: for a one-off it is
 * the day, and for anything recurring it is the day the pattern is counted
 * from. That is what makes "every other week" answerable — without an anchor,
 * which of two weeks is the odd one is a question with no answer — and it is
 * also where a monthly task gets its date, so there is no second field to
 * contradict it.
 */
const scheduleFields = {
  frequency: taskFrequencySchema.default('once'),
  /**
   * Every *n*-th week or month. Ignored for a one-off, where there is no
   * second occurrence for an interval to count towards.
   */
  interval: z.number().int().min(1).max(12).default(1),
  /**
   * Which days a weekly task lands on. More than one is ordinary — "bins on
   * Tuesday and Friday" is one chore, not two — and the set is what a weekly
   * task has instead of a date.
   */
  weekdays: z.array(weekdaySchema).max(WEEK_LENGTH).default([]),
  startsOn: dayKeySchema,
  /**
   * The last day the task runs, or null for one that runs until somebody
   * retires it. A term-time chore ends when term does, and a task that quietly
   * stops is better than one somebody has to remember to delete.
   */
  endsOn: dayKeySchema.nullable().default(null),
};

export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, 'A task needs a name').max(120),
    /** Who does it. Null is "whoever is about", which is a real answer. */
    personId: z.string().trim().min(1).nullable().default(null),
    note: z.string().trim().max(500).nullable().default(null),
    daypart: daypartSchema.default('morning'),
    icon: taskIconSchema.default(DEFAULT_TASK_ICON),
    color: hexColorSchema.default(DEFAULT_TASK_COLOR),
    /**
     * What doing it once pays, in cents. Zero by default, which is what a
     * household that does not pay for chores never has to think about: nothing
     * draws an amount it does not have, so the feature stays invisible until
     * somebody puts a price on something.
     */
    amountCents: amountCentsSchema.default(DEFAULT_TASK_AMOUNT_CENTS),
    /** Retired rather than deleted, so a chore nobody does any more drops off
     *  the board without erasing the mornings somebody did it. */
    active: z.boolean().default(true),
    ...scheduleFields,
  })
  .superRefine((task, ctx) => {
    // A weekly task with no weekday is a schedule that produces nothing, which
    // would reach the board as a task that silently never appears.
    if (task.frequency === 'weekly' && task.weekdays.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weekdays'],
        message: 'Pick at least one day of the week',
      });
    }
    if (task.endsOn !== null && task.endsOn < task.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsOn'],
        message: 'The last day cannot come before the first',
      });
    }
  });

export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskInputPayload = z.input<typeof taskInputSchema>;

/**
 * A patch. Spelled out rather than `.partial()` because the input schema ends
 * in a `superRefine`, which Zod cannot make partial — and the two cross-field
 * rules are re-checked on the *merged* task in the repository anyway, since a
 * patch that moves `startsOn` past an untouched `endsOn` is only wrong once
 * the two are seen together.
 */
export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  personId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  daypart: daypartSchema.optional(),
  icon: taskIconSchema.optional(),
  color: hexColorSchema.optional(),
  amountCents: amountCentsSchema.optional(),
  active: z.boolean().optional(),
  frequency: taskFrequencySchema.optional(),
  interval: z.number().int().min(1).max(12).optional(),
  weekdays: z.array(weekdaySchema).max(WEEK_LENGTH).optional(),
  startsOn: dayKeySchema.optional(),
  endsOn: dayKeySchema.nullable().optional(),
});
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
export type TaskUpdatePayload = z.input<typeof taskUpdateSchema>;

export interface TaskSchedule {
  frequency: TaskFrequency;
  interval: number;
  /** Monday-first indices, ascending. Empty for anything but a weekly task. */
  weekdays: number[];
  startsOn: string;
  endsOn: string | null;
}

export interface Task {
  id: string;
  title: string;
  personId: string | null;
  /** Denormalised for the editor's list, which would otherwise join by hand. */
  personName: string | null;
  note: string | null;
  daypart: Daypart;
  icon: string;
  color: string;
  /** What one day of it pays, in cents. Zero for a chore nobody is paid for. */
  amountCents: number;
  active: boolean;
  schedule: TaskSchedule;
  createdAt: string;
  updatedAt: string;
}

/* --- One day's worth of a task -------------------------------------------- */

/**
 * A task on a particular day: what the board draws, and what a tick is
 * recorded against.
 *
 * Derived per request, never stored. The tick is stored — see
 * `task_completion` — and it is keyed by the pair, because Monday's bins being
 * out is not a statement about next Monday's.
 */
export interface TaskInstance {
  /** `${taskId}:${dayKey}`. Stable by construction, so it is a React key and
   *  a pending-tick key without a second identity to keep in step. */
  id: string;
  taskId: string;
  title: string;
  note: string | null;
  icon: string;
  color: string;
  /**
   * What this card pays if it is ticked, in cents — the task's rate as it
   * stands, not the rate of any tick already recorded. An overdue card pays it
   * *once* however many days it stands for, for the same reason it is one card:
   * nobody takes out Tuesday's bins on Thursday, they take out the bins.
   */
  amountCents: number;
  daypart: Daypart;
  dayKey: string;
  /** Whether it comes back — a one-off that slipped is a different worry from
   *  a weekly chore that will be asked for again on Thursday. */
  recurring: boolean;
  completed: boolean;
  /** When it was ticked, so "done" can say when. Null while it is not. */
  completedAt: string | null;
  /**
   * How many days this card stands for. Always 1 for a task on its own day;
   * more only in the overdue pile, where every day of one chore still waiting
   * collapses into a single card.
   *
   * A recurring chore is done *once*, not once per day it was skipped — nobody
   * takes out Tuesday's bins on Thursday, they take out the bins — so the days
   * are a count rather than a list of separate things to do. Ticking the card
   * settles all of them, because a tick makes every earlier miss of the same
   * task moot.
   */
  missedCount: number;
  /** The oldest day this card covers; equal to `dayKey` when it covers one. */
  missedSince: string;
}

export function taskInstanceId(taskId: string, dayKey: string): string {
  return `${taskId}:${dayKey}`;
}

/**
 * One person's column on the board.
 *
 * `personId` is null for the column of chores nobody is named on. That column
 * is not a fallback for missing data — "whoever is about" is how a household
 * actually assigns half its work, and dropping those tasks because they have
 * no owner would hide the bins.
 */
export interface TaskColumn {
  personId: string | null;
  displayName: string;
  color: string;
  /** The viewed day's tasks, in daypart then title order. */
  due: TaskInstance[];
  /** Earlier days, still unticked. Oldest first: longest waiting, first asked. */
  overdue: TaskInstance[];
  /** What the column badge counts — everything still to do, due or overdue. */
  outstanding: number;
  /** Of the day's tasks, how many are ticked. For "3 of 4 done". */
  doneToday: number;
}

export interface TaskBoard {
  generatedAt: string;
  timezone: string;
  /** The day the board is for; `due` is this day and `overdue` is before it. */
  day: string;
  /**
   * The earliest day overdue chores were looked for. Anything older is not
   * known to be done — it is simply no longer asked about, and saying so is
   * what keeps an empty overdue list honest.
   */
  overdueFrom: string;
  columns: TaskColumn[];
  /** Across every column, so the page can say so without re-summing. */
  outstanding: number;
  overdueCount: number;
}

export const taskCompletionSchema = z.object({
  dayKey: dayKeySchema,
  completed: z.boolean(),
});
export type TaskCompletionInput = z.infer<typeof taskCompletionSchema>;

/* --- What it all added up to ---------------------------------------------- */

/**
 * `YYYY-MM`. A civil month, and timezone-free for exactly the reason a day key
 * is: the zone was applied when the day key underneath it was derived, and
 * everything here compares and slices strings rather than converting them.
 *
 * A month is the unit pocket money is actually settled in — nobody is paid per
 * fortnight, and a rolling window would give a different answer depending on
 * the day somebody asked.
 */
export const monthKeySchema = z.string().regex(/^\d{4}-\d{2}$/, 'Must be a month like 2026-09');

/** The month a day key falls in. A prefix, never a conversion. */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/** How many days a month holds, so January steps back to a 28th of February. */
function daysInMonthKey(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `2026-09` a few months either way, rolling the year over with it. */
export function addMonthsToKey(monthKey: string, months: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  // Counted in months from year zero and split back, which rolls December to
  // January without a branch and works identically for a negative step.
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = total - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

/**
 * The first and last day of a month, as day keys — the range a month's ticks
 * are looked for in.
 *
 * Both ends are inclusive and both are keys, so the lookup is a text range scan
 * over the completion index and nothing is converted on the way.
 */
export function monthDayRange(monthKey: string): { start: string; end: string } {
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(daysInMonthKey(monthKey)).padStart(2, '0')}`,
  };
}

/**
 * What one chore paid somebody over a month.
 *
 * The breakdown exists because a total on its own is not a number anybody can
 * check. "You earned $14" is an assertion; "the bins nine times at 50c and the
 * dishwasher nineteen times at 50c" is an answer to the question that follows
 * it, which on pocket-money day is always asked.
 */
export interface TaskEarningsLine {
  taskId: string;
  title: string;
  icon: string;
  color: string;
  /** How many days of it were ticked in the month. */
  completions: number;
  /**
   * What those ticks paid, each at the rate it was ticked at. Not
   * `completions` times the task's price today — see `TaskEarningsPerson`.
   */
  totalCents: number;
}

/**
 * One person's month.
 *
 * Every figure here comes from the ticks themselves, which carry the price and
 * the person they were made under. That is what makes a past month a settled
 * number rather than a live one: raising the bins from 50c to $1 in September
 * does not re-price March, and handing the chore to a sibling does not hand
 * them the month somebody else spent doing it.
 *
 * `personId` is null for work nobody was named on, the same column the board
 * keeps for it — including anything done by somebody who has since left, whose
 * ticks lose their name the way their chores do.
 */
export interface TaskEarningsPerson {
  personId: string | null;
  displayName: string;
  color: string;
  /** Chore-days ticked, across every task. */
  completions: number;
  totalCents: number;
  /** What made it up, biggest earner first. */
  tasks: TaskEarningsLine[];
}

export interface TaskEarnings {
  generatedAt: string;
  timezone: string;
  /** `YYYY-MM`; defaults to the month the display is currently in. */
  month: string;
  /** Everyone who did something, plus every active person, so a blank month
   *  reads as "nothing yet" under a name rather than as a missing name. */
  people: TaskEarningsPerson[];
  completions: number;
  totalCents: number;
}

/* --- Words ---------------------------------------------------------------- */

/** `1st`, `2nd`, `23rd` — for "every month on the 23rd". */
export function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
  return `${value}${suffix}`;
}

/**
 * The chosen weekdays, named the way somebody would say them out loud.
 *
 * The two sets a household actually uses get their own words, because "Mon &
 * Tue & Wed & Thu & Fri & Sat & Sun" is a list where "day" is the word — and a
 * schedule nobody can read at a glance is one nobody checks.
 */
function namedDays(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === WEEK_LENGTH) return 'day';
  if (days.length === 5 && days.every((day) => day < 5)) return 'weekday';

  const names = days.map((index) => WEEKDAY_LABELS[index] ?? '?');
  if (names.length <= 1) return names.join('');
  // Commas until the last, which takes an ampersand: three or more joined only
  // by "&" reads as one long word rather than as a list.
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

/**
 * How often, in words: `One-off`, `Every Mon & Thu`, `Every other week on Fri`,
 * `Every day`, `Every month on the 5th`.
 *
 * The day a one-off falls on is left to the caller, which formats a day key
 * with the locale rather than having this file grow a date formatter — the
 * same split `dayKeyShortLabel` already keeps.
 */
export function scheduleLabel(schedule: TaskSchedule): string {
  if (schedule.frequency === 'once') return 'One-off';

  if (schedule.frequency === 'weekly') {
    const days = namedDays(schedule.weekdays);
    if (schedule.interval === 1) return `Every ${days}`;
    // "Every other" reads as English where "every 2 weeks" reads as a form.
    if (schedule.interval === 2) return `Every other week on ${days}`;
    return `Every ${schedule.interval} weeks on ${days}`;
  }

  const day = ordinal(Number(schedule.startsOn.slice(8, 10)));
  if (schedule.interval === 1) return `Every month on the ${day}`;
  return `Every ${schedule.interval} months on the ${day}`;
}

/**
 * `$0`, `$2`, `$2.50` — cents on their way onto a screen, and the only place
 * they stop being an integer. Named for money rather than for amounts, because
 * `formatAmount` is already the menu's ingredient quantities.
 *
 * The pence are dropped when there are none, because `$2` is what somebody
 * says out loud and a column of `$2.00` is a column of noise on a display read
 * from across a room. Two digits otherwise, so `$2.50` never renders as
 * `$2.5`.
 */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const part = absolute % 100;
  return part === 0 ? `${sign}$${whole}` : `${sign}$${whole}.${String(part).padStart(2, '0')}`;
}

/** `4 left`, `All done`, `Nothing today` — under a column heading. */
export function taskProgressLabel(total: number, outstanding: number): string {
  if (total === 0) return 'Nothing today';
  if (outstanding === 0) return 'All done';
  return `${outstanding} left`;
}
