import { z } from 'zod';

/**
 * A birthday is a *civil* date, not an instant, so it is held as its parts
 * rather than as the unix seconds everything else in the app uses. There is no
 * timezone at which someone stops having been born on the 3rd of March, and
 * anchoring one to an instant would make a Pi in Auckland celebrate a day early.
 *
 * `year` is optional because a household knows perfectly well when to wish a
 * neighbour happy birthday without knowing how old they are turning.
 */
export const birthdayDateSchema = z
  .object({
    /** 1 = January, as it reads in a `YYYY-MM-DD` key. */
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    year: z.number().int().min(1900).max(2200).nullable().default(null),
  })
  .refine(({ month, day }) => day <= daysInMonth(month), {
    message: 'That day does not exist in that month',
    path: ['day'],
  });
export type BirthdayDate = z.infer<typeof birthdayDateSchema>;

/**
 * Days in a month, ignoring the year — 29 February is always allowed because a
 * birthday may carry no year to check it against. {@link birthdayDayKey}
 * handles what that means for the three years in four that lack the date.
 */
function daysInMonth(month: number): number {
  return [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
}

/**
 * A Bootstrap Icons class name, which is what the dashboard renders directly
 * into `class`. Constrained to the library's own naming so a stray value cannot
 * smuggle extra classes onto the element.
 */
export const iconSchema = z
  .string()
  .trim()
  .regex(/^bi-[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a Bootstrap icon name, e.g. bi-cake2')
  .max(60);

/** Offered in the admin picker. Any valid `bi-*` name is accepted regardless. */
export const suggestedIcons = [
  'bi-cake2',
  'bi-balloon',
  'bi-gift',
  'bi-star',
  'bi-heart',
  'bi-emoji-smile',
  'bi-person',
  'bi-person-hearts',
  'bi-flower1',
  'bi-rocket',
  'bi-controller',
  'bi-music-note-beamed',
  'bi-trophy',
  'bi-palette',
] as const;

export const DEFAULT_BIRTHDAY_ICON = 'bi-cake2';
export const DEFAULT_BIRTHDAY_COLOR = '#d63384';

export const birthdayInputSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(120),
  date: birthdayDateSchema,
  /** Bootstrap icon shown beside the name on the calendar. */
  icon: iconSchema.default(DEFAULT_BIRTHDAY_ICON),
  /** Tints the entry, so a household reads whose day it is by hue alone. */
  color: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour, e.g. #d63384')
    .default(DEFAULT_BIRTHDAY_COLOR),
  /** Hidden from the calendar but kept, the way an inactive person is. */
  active: z.boolean().default(true),
});
/** The parsed record, with every default filled in. What the server works with. */
export type BirthdayInput = z.infer<typeof birthdayInputSchema>;
/** What a client may send: anything carrying a default can be left out. */
export type BirthdayInputPayload = z.input<typeof birthdayInputSchema>;

export const birthdayUpdateSchema = birthdayInputSchema.partial();
export type BirthdayUpdate = z.infer<typeof birthdayUpdateSchema>;
export type BirthdayUpdatePayload = z.input<typeof birthdayUpdateSchema>;

/**
 * Someone whose birthday belongs on the calendar.
 *
 * Deliberately not a `Person`. A `Person` is a member of the household that
 * feeds are attributed to and that the camera will one day recognise; the
 * grandparents, cousins and school friends whose birthdays a family calendar
 * carries are none of those things, and giving them `person` rows would put
 * them in the presence set and the feed-attribution picker for no reason.
 */
export interface Birthday {
  id: string;
  displayName: string;
  date: BirthdayDate;
  /** Bootstrap icon class, e.g. `bi-cake2`. */
  icon: string;
  color: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One birthday as it falls on one day of the calendar being drawn.
 *
 * Never materialised into `event_occurrence` — it is derived from the birthday
 * record at request time. That keeps a steady-state sync writing nothing, and
 * it means birthdays are known for *any* date the dashboard can ask about
 * rather than only inside the rolling occurrence window.
 */
export interface BirthdayCelebration {
  birthdayId: string;
  displayName: string;
  color: string;
  icon: string;
  /** The `YYYY-MM-DD` this celebration is drawn on. */
  date: string;
  /** Age being turned, or `null` when the birth year is unknown. */
  age: number | null;
  /**
   * True when the person was born on 29 February and this year has none, so the
   * celebration has been moved to the 28th. Worth saying out loud rather than
   * quietly showing a date the birth certificate disagrees with.
   */
  observed: boolean;
}

/**
 * The `YYYY-MM-DD` a birthday falls on in a given year.
 *
 * A 29 February birthday is observed on the 28th in a common year. The
 * alternative — 1 March — would push the celebration into the next month, which
 * looks like a mistake on a month grid.
 */
export function birthdayDayKey(date: BirthdayDate, year: number): string {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = date.month === 2 && date.day === 29 && !isLeap ? 28 : date.day;
  return `${year}-${String(date.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** `Ada turns 9` / `Ada's birthday` when no year is on file. */
export function birthdayLabel(celebration: BirthdayCelebration): string {
  return celebration.age === null
    ? `${celebration.displayName}'s birthday`
    : `${celebration.displayName} turns ${celebration.age}`;
}
