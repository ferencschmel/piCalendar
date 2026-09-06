import { z } from 'zod';

/**
 * A single materialised occurrence of an event — a recurring event yields one
 * of these per instance. Timestamps are ISO-8601 UTC; `allDay` occurrences are
 * anchored to the feed's timezone at ingest so they never drift a day.
 */
export interface CalendarOccurrence {
  id: string;
  eventId: string;
  feedId: string;
  feedName: string;
  feedColor: string;
  sourceType: string;
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  organizer: string | null;
  status: string | null;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  isRecurring: boolean;
  people: Array<{ id: string; displayName: string; color: string }>;
}

/** Occurrences grouped into calendar days for the dashboard's day columns. */
export interface AgendaDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  isToday: boolean;
  occurrences: CalendarOccurrence[];
}

export interface AgendaResponse {
  /** Server time when the agenda was computed, for staleness display. */
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  timezone: string;
  days: AgendaDay[];
  /**
   * Changes to any of these invalidate the agenda; the dashboard compares it
   * across polls to decide whether a re-render is warranted.
   */
  revision: string;
}

export const agendaQuerySchema = z.object({
  /** Inclusive start date `YYYY-MM-DD`; defaults to today in the server tz. */
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Number of days to return, including the start day. */
  days: z.coerce.number().int().min(1).max(31).default(8),
  /** Restrict to these people (used by the presence-driven view). */
  personId: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
  feedId: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional(),
});
export type AgendaQuery = z.infer<typeof agendaQuerySchema>;
