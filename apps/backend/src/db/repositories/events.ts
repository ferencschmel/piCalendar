import type { AgendaDay, CalendarOccurrence } from '@picalendar/shared';
import type { Db } from '../index.js';
import type { NormalizedEvent } from '../../ingest/types.js';
import { contentHash, newId, occurrenceId } from '../../util/ids.js';
import { nowEpoch, toDayKey } from '../../util/time.js';

export interface WriteResult {
  upserted: number;
  deleted: number;
  /** True when anything the dashboard renders actually changed. */
  changed: boolean;
}

/**
 * Replace a feed's events with the freshly parsed set.
 *
 * Rather than truncating and re-inserting — which would churn the indexes and
 * rewrite pages on the SD card every sync — each event is hashed. Unchanged
 * rows are only touched to stamp the sync token, and rows that the source no
 * longer publishes are deleted by token mismatch.
 */
export function replaceFeedEvents(db: Db, feedId: string, events: NormalizedEvent[]): WriteResult {
  const syncToken = newId();
  const now = nowEpoch();
  let upserted = 0;
  let changed = false;

  const selectExisting = db.prepare<[string, string, string], { id: string; content_hash: string }>(
    'SELECT id, content_hash FROM event WHERE feed_id = ? AND uid = ? AND recurrence_id = ?',
  );
  const insertEvent = db.prepare(
    `INSERT INTO event (id, feed_id, uid, recurrence_id, summary, description, location, url,
       organizer, status, all_day, starts_at, ends_at, timezone, rrule, sequence,
       source_updated_at, content_hash, last_seen_sync, created_at, updated_at)
     VALUES (@id, @feedId, @uid, @recurrenceId, @summary, @description, @location, @url,
       @organizer, @status, @allDay, @startsAt, @endsAt, @timezone, @rrule, @sequence,
       @sourceUpdatedAt, @hash, @syncToken, @now, @now)`,
  );
  const updateEvent = db.prepare(
    `UPDATE event SET summary = @summary, description = @description, location = @location,
       url = @url, organizer = @organizer, status = @status, all_day = @allDay,
       starts_at = @startsAt, ends_at = @endsAt, timezone = @timezone, rrule = @rrule,
       sequence = @sequence, source_updated_at = @sourceUpdatedAt, content_hash = @hash,
       last_seen_sync = @syncToken, updated_at = @now
     WHERE id = @id`,
  );
  const touchEvent = db.prepare('UPDATE event SET last_seen_sync = ? WHERE id = ?');
  const clearOccurrences = db.prepare('DELETE FROM event_occurrence WHERE event_id = ?');
  const insertOccurrence = db.prepare(
    `INSERT INTO event_occurrence (id, event_id, feed_id, starts_at, ends_at, all_day)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       all_day = excluded.all_day`,
  );

  const write = db.transaction(() => {
    for (const event of events) {
      const hash = contentHash(event);
      const existing = selectExisting.get(feedId, event.uid, event.recurrenceId);

      if (existing && existing.content_hash === hash) {
        touchEvent.run(syncToken, existing.id);
        continue;
      }

      const id = existing?.id ?? newId();
      const params = {
        id,
        feedId,
        uid: event.uid,
        recurrenceId: event.recurrenceId,
        summary: event.summary,
        description: event.description,
        location: event.location,
        url: event.url,
        organizer: event.organizer,
        status: event.status,
        allDay: event.allDay ? 1 : 0,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: event.timezone,
        rrule: event.rrule,
        sequence: event.sequence,
        sourceUpdatedAt: event.sourceUpdatedAt,
        hash,
        syncToken,
        now,
      };
      if (existing) updateEvent.run(params);
      else insertEvent.run(params);

      clearOccurrences.run(id);
      for (const occurrence of event.occurrences) {
        insertOccurrence.run(
          occurrenceId(id, occurrence.startsAt),
          id,
          feedId,
          occurrence.startsAt,
          occurrence.endsAt,
          occurrence.allDay ? 1 : 0,
        );
      }
      upserted += 1;
      changed = true;
    }

    const removed = db
      .prepare(
        'DELETE FROM event WHERE feed_id = ? AND (last_seen_sync IS NULL OR last_seen_sync != ?)',
      )
      .run(feedId, syncToken).changes;
    if (removed > 0) changed = true;
    return removed;
  });

  const deleted = write();
  return { upserted, deleted, changed };
}

interface OccurrenceRow {
  id: string;
  event_id: string;
  feed_id: string;
  feed_name: string;
  feed_color: string;
  source_type: string;
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  organizer: string | null;
  status: string | null;
  all_day: number;
  starts_at: number;
  ends_at: number;
  rrule: string | null;
}

export interface AgendaFilters {
  feedIds?: string[];
  personIds?: string[];
}

/**
 * The dashboard's hot path. One indexed range scan over `event_occurrence`,
 * joined to the parent event and feed for display metadata.
 *
 * The overlap predicate (`starts_at < end AND ends_at > start`) keeps multi-day
 * events visible on every day they cover. It stays cheap because the table only
 * ever holds the rolling materialisation window, so `starts_at < end` cannot
 * degenerate into a full scan of all history.
 */
export function queryOccurrences(
  db: Db,
  rangeStart: number,
  rangeEnd: number,
  filters: AgendaFilters = {},
): CalendarOccurrence[] {
  const clauses = ['o.starts_at < ?', 'o.ends_at > ?', 'f.enabled = 1'];
  const params: Array<string | number> = [rangeEnd, rangeStart];

  if (filters.feedIds?.length) {
    clauses.push(`o.feed_id IN (${filters.feedIds.map(() => '?').join(', ')})`);
    params.push(...filters.feedIds);
  }
  if (filters.personIds?.length) {
    clauses.push(
      `o.feed_id IN (SELECT feed_id FROM feed_person WHERE person_id IN (${filters.personIds
        .map(() => '?')
        .join(', ')}))`,
    );
    params.push(...filters.personIds);
  }

  const rows = db
    .prepare<Array<string | number>, OccurrenceRow>(
      `SELECT o.id, o.event_id, o.feed_id, o.starts_at, o.ends_at, o.all_day,
              f.name AS feed_name, f.color AS feed_color, f.source_type,
              e.uid, e.summary, e.description, e.location, e.url, e.organizer, e.status, e.rrule
       FROM event_occurrence o
       JOIN event e ON e.id = o.event_id
       JOIN feed f ON f.id = o.feed_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY o.starts_at ASC, o.all_day DESC, e.summary COLLATE NOCASE`,
    )
    .all(...params);

  if (rows.length === 0) return [];

  const people = peopleByFeed(db, [...new Set(rows.map((r) => r.feed_id))]);

  return rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    feedId: row.feed_id,
    feedName: row.feed_name,
    feedColor: row.feed_color,
    sourceType: row.source_type,
    uid: row.uid,
    summary: row.summary,
    description: row.description,
    location: row.location,
    url: row.url,
    organizer: row.organizer,
    status: row.status,
    allDay: row.all_day === 1,
    startsAt: new Date(row.starts_at * 1000).toISOString(),
    endsAt: new Date(row.ends_at * 1000).toISOString(),
    isRecurring: Boolean(row.rrule),
    people: people.get(row.feed_id) ?? [],
  }));
}

function peopleByFeed(
  db: Db,
  feedIds: string[],
): Map<string, Array<{ id: string; displayName: string; color: string }>> {
  const map = new Map<string, Array<{ id: string; displayName: string; color: string }>>();
  if (feedIds.length === 0) return map;

  const rows = db
    .prepare<string[], { feed_id: string; id: string; display_name: string; color: string }>(
      `SELECT fp.feed_id, p.id, p.display_name, p.color
       FROM feed_person fp
       JOIN person p ON p.id = fp.person_id
       WHERE fp.feed_id IN (${feedIds.map(() => '?').join(', ')})
       ORDER BY p.display_name COLLATE NOCASE`,
    )
    .all(...feedIds);

  for (const row of rows) {
    const list = map.get(row.feed_id) ?? [];
    list.push({ id: row.id, displayName: row.display_name, color: row.color });
    map.set(row.feed_id, list);
  }
  return map;
}

/**
 * Bucket occurrences into day columns. An occurrence appears under every day it
 * overlaps, which is what a wall display should show for a multi-day trip.
 */
export function groupByDay(
  occurrences: CalendarOccurrence[],
  dayKeys: string[],
  timezone: string,
  todayKey: string,
): AgendaDay[] {
  const buckets = new Map<string, CalendarOccurrence[]>(dayKeys.map((key) => [key, []]));

  for (const occurrence of occurrences) {
    const start = Math.floor(new Date(occurrence.startsAt).getTime() / 1000);
    const end = Math.floor(new Date(occurrence.endsAt).getTime() / 1000);
    // An event ending exactly at midnight belongs to the previous day only.
    const lastKey = toDayKey(Math.max(start, end - 1), timezone);
    let key = toDayKey(start, timezone);

    for (;;) {
      buckets.get(key)?.push(occurrence);
      if (key === lastKey) break;
      const next = nextKey(key);
      if (!buckets.has(next) && next > (dayKeys.at(-1) ?? next)) break;
      key = next;
    }
  }

  return dayKeys.map((date) => ({
    date,
    isToday: date === todayKey,
    occurrences: buckets.get(date) ?? [],
  }));
}

function nextKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/** Drops occurrences that have fallen out of the rolling window. */
export function pruneOccurrences(db: Db, before: number, after: number): number {
  return db
    .prepare('DELETE FROM event_occurrence WHERE ends_at < ? OR starts_at > ?')
    .run(before, after).changes;
}
