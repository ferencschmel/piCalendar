import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import * as feeds from '../src/db/repositories/feeds.js';
import * as people from '../src/db/repositories/people.js';
import {
  groupByDay,
  groupDensityByDay,
  queryOccurrenceDensity,
  queryOccurrences,
  replaceFeedEvents,
} from '../src/db/repositories/events.js';
import { getPresenceState, recordSighting } from '../src/db/repositories/presence.js';
import type { NormalizedEvent } from '../src/ingest/types.js';

const TZ = 'Europe/Budapest';
const DAY = 86_400;

function event(overrides: Partial<NormalizedEvent> & { uid: string }): NormalizedEvent {
  const startsAt = overrides.startsAt ?? Math.floor(Date.parse('2026-06-10T17:00:00Z') / 1000);
  return {
    recurrenceId: '',
    summary: 'Event',
    description: null,
    location: null,
    url: null,
    organizer: null,
    status: null,
    allDay: false,
    endsAt: startsAt + 3600,
    timezone: TZ,
    rrule: null,
    sequence: 0,
    sourceUpdatedAt: null,
    occurrences: [{ startsAt, endsAt: startsAt + 3600, allDay: false }],
    ...overrides,
    startsAt,
  };
}

describe('repositories', () => {
  let db: Db;
  let feedId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    feedId = feeds.createFeed(db, {
      name: 'Team',
      sourceType: 'sportsengine',
      url: 'https://example.com/team.ics',
      enabled: true,
      color: '#ff0000',
      refreshIntervalSeconds: 900,
      personIds: [],
    }).id;
  });

  it('rejects a duplicate feed URL', () => {
    expect(() =>
      feeds.createFeed(db, {
        name: 'Same URL',
        sourceType: 'ics',
        url: 'https://example.com/team.ics',
        enabled: true,
        color: '#00ff00',
        refreshIntervalSeconds: 900,
        personIds: [],
      }),
    ).toThrow(/UNIQUE/i);
  });

  it('reports a feed as due only after its own interval elapses', () => {
    expect(feeds.listDueFeeds(db).map((f) => f.id)).toEqual([feedId]);

    feeds.markSyncResult(db, feedId, 'ok', null);
    expect(feeds.listDueFeeds(db)).toHaveLength(0);

    // Look 16 minutes into the future; the interval is 15.
    const later = Math.floor(Date.now() / 1000) + 16 * 60;
    expect(feeds.listDueFeeds(db, later).map((f) => f.id)).toEqual([feedId]);
  });

  it('does not rewrite rows whose content is unchanged', () => {
    const events = [event({ uid: 'a' }), event({ uid: 'b' })];

    const first = replaceFeedEvents(db, feedId, events);
    expect(first).toMatchObject({ upserted: 2, deleted: 0, changed: true });

    // Re-syncing an identical calendar must be a no-op, not a rewrite.
    const second = replaceFeedEvents(db, feedId, events);
    expect(second).toMatchObject({ upserted: 0, deleted: 0, changed: false });

    const third = replaceFeedEvents(db, feedId, [
      { ...events[0]!, summary: 'Renamed' },
      events[1]!,
    ]);
    expect(third).toMatchObject({ upserted: 1, deleted: 0, changed: true });
  });

  it('deletes events the source stopped publishing', () => {
    replaceFeedEvents(db, feedId, [event({ uid: 'a' }), event({ uid: 'b' })]);
    const result = replaceFeedEvents(db, feedId, [event({ uid: 'a' })]);

    expect(result.deleted).toBe(1);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM event WHERE feed_id = ?').get(feedId),
    ).toMatchObject({ n: 1 });
    // The cascade must take the orphaned occurrences with it.
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_occurrence').get()).toMatchObject({ n: 1 });
  });

  it('cascades deletes from feed to events and occurrences', () => {
    replaceFeedEvents(db, feedId, [event({ uid: 'a' })]);
    feeds.deleteFeed(db, feedId);

    expect(db.prepare('SELECT COUNT(*) AS n FROM event').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_occurrence').get()).toMatchObject({ n: 0 });
  });

  it('returns only occurrences overlapping the requested range', () => {
    const june10 = Math.floor(Date.parse('2026-06-10T17:00:00Z') / 1000);
    replaceFeedEvents(db, feedId, [
      event({ uid: 'inside', startsAt: june10 }),
      event({ uid: 'before', startsAt: june10 - 10 * DAY }),
      event({ uid: 'after', startsAt: june10 + 10 * DAY }),
    ]);

    const found = queryOccurrences(db, june10 - DAY, june10 + DAY);
    expect(found.map((o) => o.uid)).toEqual(['inside']);
    expect(found[0]?.feedName).toBe('Team');
    expect(found[0]?.feedColor).toBe('#ff0000');
  });

  it('hides events from a disabled feed', () => {
    const june10 = Math.floor(Date.parse('2026-06-10T17:00:00Z') / 1000);
    replaceFeedEvents(db, feedId, [event({ uid: 'inside', startsAt: june10 })]);
    feeds.updateFeed(db, feedId, { enabled: false });

    expect(queryOccurrences(db, june10 - DAY, june10 + DAY)).toHaveLength(0);
  });

  it('filters by person through the feed link', () => {
    const alice = people.createPerson(db, {
      displayName: 'Alice',
      color: '#123456',
      active: true,
      email: '',
    });
    const bob = people.createPerson(db, {
      displayName: 'Bob',
      color: '#654321',
      active: true,
      email: '',
    });
    feeds.updateFeed(db, feedId, { personIds: [alice.id] });

    const june10 = Math.floor(Date.parse('2026-06-10T17:00:00Z') / 1000);
    replaceFeedEvents(db, feedId, [event({ uid: 'inside', startsAt: june10 })]);

    expect(
      queryOccurrences(db, june10 - DAY, june10 + DAY, { personIds: [alice.id] }),
    ).toHaveLength(1);
    expect(queryOccurrences(db, june10 - DAY, june10 + DAY, { personIds: [bob.id] })).toHaveLength(
      0,
    );
  });

  it('places a multi-day event in every day it covers', () => {
    const start = Math.floor(Date.parse('2026-06-09T22:00:00Z') / 1000); // 10 June, Budapest
    replaceFeedEvents(db, feedId, [
      event({
        uid: 'trip',
        summary: 'Away tournament',
        allDay: true,
        startsAt: start,
        endsAt: start + 3 * DAY,
        occurrences: [{ startsAt: start, endsAt: start + 3 * DAY, allDay: true }],
      }),
    ]);

    const occurrences = queryOccurrences(db, start - DAY, start + 5 * DAY);
    const days = groupByDay(
      occurrences,
      ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'],
      TZ,
      '2026-06-10',
    );

    expect(days.map((d) => d.occurrences.length)).toEqual([0, 1, 1, 1, 0]);
    expect(days.find((d) => d.date === '2026-06-10')?.isToday).toBe(true);
  });

  it('treats an event ending exactly at midnight as belonging to the earlier day', () => {
    const start = Math.floor(Date.parse('2026-06-10T20:00:00Z') / 1000);
    const end = Math.floor(Date.parse('2026-06-10T22:00:00Z') / 1000); // midnight the 11th
    replaceFeedEvents(db, feedId, [
      event({
        uid: 'late',
        startsAt: start,
        endsAt: end,
        occurrences: [{ startsAt: start, endsAt: end, allDay: false }],
      }),
    ]);

    const days = groupByDay(
      queryOccurrences(db, start - DAY, end + DAY),
      ['2026-06-10', '2026-06-11'],
      TZ,
      '2026-06-10',
    );
    expect(days.map((d) => d.occurrences.length)).toEqual([1, 0]);
  });

  it('collapses a day to one density mark per feed, counting the events behind it', () => {
    const start = Math.floor(Date.parse('2026-06-10T07:00:00Z') / 1000);
    const other = feeds.createFeed(db, {
      name: 'Swim',
      sourceType: 'ics',
      url: 'https://example.com/swim.ics',
      enabled: true,
      color: '#0000ff',
      refreshIntervalSeconds: 900,
      personIds: [],
    }).id;

    replaceFeedEvents(db, feedId, [
      event({ uid: 'a', startsAt: start }),
      event({ uid: 'b', startsAt: start + 7200 }),
    ]);
    replaceFeedEvents(db, other, [event({ uid: 'c', startsAt: start + 3600 })]);

    const days = groupDensityByDay(
      queryOccurrenceDensity(db, start - DAY, start + DAY),
      ['2026-06-10'],
      TZ,
      '2026-06-10',
    );

    const day = days[0]!;
    expect(day.total).toBe(3);
    // Two feeds, ordered by their first event of the day, with the busier one
    // carrying its own count rather than a second dot.
    expect(day.marks.map((m) => [m.color, m.count])).toEqual([
      ['#ff0000', 2],
      ['#0000ff', 1],
    ]);
  });

  it('spreads a multi-day event across density days exactly as the agenda does', () => {
    const start = Math.floor(Date.parse('2026-06-09T22:00:00Z') / 1000); // 10 June, Budapest
    replaceFeedEvents(db, feedId, [
      event({
        uid: 'trip',
        allDay: true,
        startsAt: start,
        endsAt: start + 3 * DAY,
        occurrences: [{ startsAt: start, endsAt: start + 3 * DAY, allDay: true }],
      }),
    ]);

    const dayKeys = ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13'];
    const density = groupDensityByDay(
      queryOccurrenceDensity(db, start - DAY, start + 5 * DAY),
      dayKeys,
      TZ,
      '2026-06-10',
    );
    const agenda = groupByDay(
      queryOccurrences(db, start - DAY, start + 5 * DAY),
      dayKeys,
      TZ,
      '2026-06-10',
    );

    expect(density.map((d) => d.total)).toEqual(agenda.map((d) => d.occurrences.length));
    expect(density.map((d) => d.marks.length)).toEqual([0, 1, 1, 1, 0]);
  });

  it('excludes a disabled feed from the density marks', () => {
    const start = Math.floor(Date.parse('2026-06-10T07:00:00Z') / 1000);
    replaceFeedEvents(db, feedId, [event({ uid: 'a', startsAt: start })]);
    feeds.updateFeed(db, feedId, { enabled: false });

    expect(queryOccurrenceDensity(db, start - DAY, start + DAY)).toHaveLength(0);
  });

  it('counts someone as present only inside the sighting window', () => {
    const person = people.createPerson(db, {
      displayName: 'Alice',
      color: '#123456',
      active: true,
      email: '',
    });

    expect(getPresenceState(db, 300).present).toHaveLength(0);

    recordSighting(db, { personId: person.id, confidence: 0.9, source: 'camera' });
    expect(getPresenceState(db, 300).present.map((p) => p.displayName)).toEqual(['Alice']);

    // A confidence floor above the recorded value rules the sighting out.
    expect(getPresenceState(db, 300, 0.95).present).toHaveLength(0);

    // So does a sighting that has aged past the window: ten minutes ago is
    // outside a five-minute window but inside a fifteen-minute one.
    const stale = people.createPerson(db, {
      displayName: 'Bob',
      color: '#654321',
      active: true,
      email: '',
    });
    recordSighting(db, {
      personId: stale.id,
      confidence: 1,
      source: 'camera',
      detectedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });
    expect(getPresenceState(db, 300).present.map((p) => p.displayName)).toEqual(['Alice']);
    expect(
      getPresenceState(db, 900)
        .present.map((p) => p.displayName)
        .sort(),
    ).toEqual(['Alice', 'Bob']);
  });
});
