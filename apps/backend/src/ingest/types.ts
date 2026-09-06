/** Provider-agnostic shape produced by the ICS adapters and consumed by the DB. */
export interface NormalizedOccurrence {
  startsAt: number;
  endsAt: number;
  allDay: boolean;
}

export interface NormalizedEvent {
  uid: string;
  /** '' for a plain event or series master; set for an overridden instance. */
  recurrenceId: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  organizer: string | null;
  status: string | null;
  allDay: boolean;
  startsAt: number;
  endsAt: number;
  timezone: string | null;
  rrule: string | null;
  sequence: number;
  sourceUpdatedAt: number | null;
  /** Concrete instances inside the materialisation window. */
  occurrences: NormalizedOccurrence[];
}
