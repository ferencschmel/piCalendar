import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseIcs } from '../src/ingest/parser.js';
import { applyAdapter } from '../src/ingest/adapters.js';
import type { NormalizedEvent } from '../src/ingest/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const body = fs.readFileSync(path.join(here, 'fixtures', 'sample.ics'), 'utf8');

const OPTIONS = {
  windowStart: Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000),
  windowEnd: Math.floor(Date.parse('2027-01-01T00:00:00Z') / 1000),
  displayTimezone: 'Europe/Budapest',
};

describe('parseIcs', () => {
  let events: NormalizedEvent[];
  const byUid = (uid: string): NormalizedEvent =>
    events.find((e) => e.uid === uid) ??
    (() => {
      throw new Error(`missing ${uid}`);
    })();

  beforeAll(() => {
    events = parseIcs(body, OPTIONS);
  });

  it('reads a zoned event as the correct absolute instant', () => {
    const event = byUid('single-timed@example.com');
    // 19:00 Budapest in June (UTC+2) is 17:00Z.
    expect(new Date(event.startsAt * 1000).toISOString()).toBe('2026-06-10T17:00:00.000Z');
    expect(event.endsAt - event.startsAt).toBe(90 * 60);
    expect(event.location).toBe('Ferencvaros pitch 2');
    expect(event.allDay).toBe(false);
  });

  it('anchors an all-day event to local midnight, not UTC midnight', () => {
    const event = byUid('all-day@example.com');
    expect(event.allDay).toBe(true);
    // The 12th in Budapest starts at 22:00Z on the 11th. Anchoring to UTC
    // midnight instead would push the event onto the wrong day column.
    expect(new Date(event.startsAt * 1000).toISOString()).toBe('2026-06-11T22:00:00.000Z');
    expect(event.endsAt - event.startsAt).toBe(86_400);
  });

  it('treats a missing DTEND as instantaneous', () => {
    const event = byUid('no-dtend@example.com');
    expect(event.endsAt).toBe(event.startsAt);
  });

  it('expands a recurring series and holds the wall-clock time across DST', () => {
    const event = byUid('weekly@example.com');
    expect(event.rrule).toContain('FREQ=WEEKLY');
    expect(event.occurrences).toHaveLength(8);

    const starts = event.occurrences.map((o) => new Date(o.startsAt * 1000).toISOString());
    // 2026-03-02 is before the 29 March DST switch (UTC+1) — 18:00 local = 17:00Z.
    expect(starts[0]).toBe('2026-03-02T17:00:00.000Z');
    // 2026-04-06 is after it (UTC+2) — 18:00 local = 16:00Z. A naive expansion
    // that adds fixed 7-day offsets would report 17:00Z and drift by an hour.
    expect(starts.at(-1)).toBe('2026-04-20T16:00:00.000Z');

    for (const occurrence of event.occurrences) {
      expect(occurrence.endsAt - occurrence.startsAt).toBe(90 * 60);
    }
  });

  it('gives a non-recurring event exactly one occurrence', () => {
    expect(byUid('single-timed@example.com').occurrences).toHaveLength(1);
  });

  it('confines expansion to the requested window', () => {
    const narrow = parseIcs(body, {
      ...OPTIONS,
      windowStart: Math.floor(Date.parse('2026-03-01T00:00:00Z') / 1000),
      windowEnd: Math.floor(Date.parse('2026-03-31T00:00:00Z') / 1000),
    });
    const weekly = narrow.find((e) => e.uid === 'weekly@example.com')!;
    expect(weekly.occurrences.length).toBeGreaterThan(0);
    expect(weekly.occurrences.length).toBeLessThan(8);
    // The June events fall outside the window and materialise nothing.
    expect(narrow.find((e) => e.uid === 'all-day@example.com')!.occurrences).toHaveLength(0);
  });

  it('survives a malformed calendar without losing the good events', () => {
    const damaged = body.replace('UID:no-dtend@example.com', 'UID:');
    const parsed = parseIcs(damaged, OPTIONS);
    expect(parsed.find((e) => e.uid === 'single-timed@example.com')).toBeDefined();
    expect(parsed.find((e) => e.uid === '')).toBeUndefined();
  });
});

describe('adapters', () => {
  it('drops cancelled events from iCloud feeds but keeps them for generic ICS', () => {
    const events = parseIcs(body, OPTIONS);
    const uids = (list: NormalizedEvent[]): string[] => list.map((e) => e.uid);

    expect(uids(applyAdapter('icloud', events))).not.toContain('cancelled@example.com');
    expect(uids(applyAdapter('ics', events))).toContain('cancelled@example.com');
  });

  it('strips SportsEngine home/away suffixes from the summary', () => {
    const [cleaned] = applyAdapter('sportsengine', [
      {
        uid: 'x',
        recurrenceId: '',
        summary: 'Tigers vs Lions (Home)',
        description: 'Kickoff 10am\n\nPowered by SportsEngine',
        location: null,
        url: null,
        organizer: null,
        status: null,
        allDay: false,
        startsAt: 0,
        endsAt: 0,
        timezone: null,
        rrule: null,
        sequence: 0,
        sourceUpdatedAt: null,
        occurrences: [],
      },
    ]);
    expect(cleaned!.summary).toBe('Tigers vs Lions');
    expect(cleaned!.description).toBe('Kickoff 10am');
  });
});

describe('series exceptions', () => {
  const events = parseIcs(
    fs.readFileSync(path.join(here, 'fixtures', 'sample.ics'), 'utf8'),
    OPTIONS,
  );
  const forUid = (uid: string): NormalizedEvent[] => events.filter((e) => e.uid === uid);

  it('drops an EXDATE instance from the expansion', () => {
    const master = forUid('series-with-exceptions@example.com').find((e) => e.recurrenceId === '');
    const starts = master!.occurrences.map((o) => new Date(o.startsAt * 1000).toISOString());

    // COUNT=5 weekly from 5 May, minus the excluded 19 May, minus the 12 May
    // instance that a RECURRENCE-ID override replaces.
    expect(starts).toEqual([
      '2026-05-05T15:00:00.000Z',
      '2026-05-26T15:00:00.000Z',
      '2026-06-02T15:00:00.000Z',
    ]);
  });

  it('stores a modified instance separately, at its new time', () => {
    const override = forUid('series-with-exceptions@example.com').find(
      (e) => e.recurrenceId !== '',
    );
    expect(override).toBeDefined();
    expect(override!.summary).toBe('Piano lesson (moved later)');
    // Moved from 17:00 to 19:30 local, i.e. 17:30Z in CEST.
    expect(new Date(override!.startsAt * 1000).toISOString()).toBe('2026-05-12T17:30:00.000Z');
    expect(override!.occurrences).toHaveLength(1);
  });

  it('renders the series exactly once per date across master and overrides', () => {
    const all = forUid('series-with-exceptions@example.com')
      .flatMap((e) => e.occurrences)
      .map((o) => new Date(o.startsAt * 1000).toISOString().slice(0, 10))
      .sort();
    // No date appears twice: the override does not duplicate the master's slot.
    expect(all).toEqual([...new Set(all)]);
    expect(all).toEqual(['2026-05-05', '2026-05-12', '2026-05-26', '2026-06-02']);
  });
});
