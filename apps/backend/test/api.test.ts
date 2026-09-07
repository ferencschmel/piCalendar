import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AgendaDensityResponse,
  AgendaResponse,
  Birthday,
  Feed,
  HealthResponse,
  Person,
} from '@picalendar/shared';
import { closeDb, getDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createServer } from '../src/server.js';

let server: Server;
let base: string;

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body: body as T };
}

beforeAll(async () => {
  runMigrations(getDb());
  server = createServer().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
});

beforeEach(() => {
  // Each test starts from an empty dataset; cascades clear the rest.
  getDb().exec(
    'DELETE FROM feed; DELETE FROM person; DELETE FROM presence_sighting; DELETE FROM birthday;',
  );
});

describe('GET /api/health', () => {
  it('reports the database and feed state', async () => {
    const { status, body } = await call<HealthResponse>('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.database.ok).toBe(true);
    expect(body.feeds).toEqual({ total: 0, enabled: 0, failing: 0 });
  });
});

describe('feed CRUD', () => {
  it('creates, lists, patches and deletes a feed', async () => {
    const created = await call<{ feed: Feed }>('/feeds', {
      method: 'POST',
      body: JSON.stringify({
        name: 'U12 Football',
        sourceType: 'sportsengine',
        url: 'https://example.com/u12.ics',
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.feed.name).toBe('U12 Football');
    // Defaults from the shared schema must be applied server-side.
    expect(created.body.feed.refreshIntervalSeconds).toBe(900);
    expect(created.body.feed.enabled).toBe(true);

    const id = created.body.feed.id;

    const listed = await call<{ feeds: Feed[] }>('/feeds');
    expect(listed.body.feeds.map((f) => f.id)).toEqual([id]);

    const patched = await call<{ feed: Feed }>(`/feeds/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    });
    expect(patched.body.feed.enabled).toBe(false);
    expect(patched.body.feed.name).toBe('U12 Football');

    expect((await call(`/feeds/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call<{ feeds: Feed[] }>('/feeds')).body.feeds).toHaveLength(0);
  });

  it('normalises a webcal:// URL to https://', async () => {
    const { body } = await call<{ feed: Feed }>('/feeds', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Shared',
        sourceType: 'icloud',
        url: 'webcal://p01-calendars.icloud.com/published/2/abc',
      }),
    });
    expect(body.feed.url).toBe('https://p01-calendars.icloud.com/published/2/abc');
  });

  it('returns field-level errors for an invalid payload', async () => {
    const { status, body } = await call<{
      error: { code: string; details: Record<string, string[]> };
    }>('/feeds', {
      method: 'POST',
      body: JSON.stringify({ name: '', sourceType: 'nope', url: 'ftp://x' }),
    });
    expect(status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(Object.keys(body.error.details).sort()).toEqual(['name', 'sourceType', 'url']);
  });

  it('rejects a duplicate URL with 409 rather than a 500', async () => {
    const payload = JSON.stringify({
      name: 'A',
      sourceType: 'ics',
      url: 'https://example.com/a.ics',
    });
    expect((await call('/feeds', { method: 'POST', body: payload })).status).toBe(201);

    const duplicate = await call<{ error: { code: string } }>('/feeds', {
      method: 'POST',
      body: JSON.stringify({ name: 'B', sourceType: 'ics', url: 'https://example.com/a.ics' }),
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('conflict');
  });

  it('404s an unknown feed', async () => {
    const { status, body } = await call<{ error: { code: string } }>(
      '/feeds/00000000-0000-4000-8000-000000000000',
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });
});

describe('GET /api/agenda', () => {
  it('returns today plus the requested number of days', async () => {
    const { status, body } = await call<AgendaResponse>('/agenda?days=8');
    expect(status).toBe(200);
    expect(body.days).toHaveLength(8);
    expect(body.timezone).toBe('Europe/Budapest');
    expect(body.days.filter((d) => d.isToday)).toHaveLength(1);
    // The first column is today; the dashboard relies on that ordering.
    expect(body.days[0]?.isToday).toBe(true);
  });

  it('honours an explicit start date', async () => {
    const { body } = await call<AgendaResponse>('/agenda?start=2026-06-10&days=3');
    expect(body.days.map((d) => d.date)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12']);
    expect(body.days.every((d) => d.isToday === false)).toBe(true);
  });

  it('rejects an out-of-range day count', async () => {
    expect((await call('/agenda?days=99')).status).toBe(422);
  });

  it('accepts the six weeks a month grid needs', async () => {
    const { status, body } = await call<AgendaResponse>('/agenda?start=2026-08-31&days=42');
    expect(status).toBe(200);
    expect(body.days).toHaveLength(42);
    expect(body.days.at(-1)?.date).toBe('2026-10-11');
  });
});

describe('GET /api/agenda/density', () => {
  it('returns a mark-only day for every day requested', async () => {
    const { status, body } = await call<AgendaDensityResponse>(
      '/agenda/density?start=2026-06-10&days=3',
    );
    expect(status).toBe(200);
    expect(body.days.map((d) => d.date)).toEqual(['2026-06-10', '2026-06-11', '2026-06-12']);
    expect(body.days.every((d) => d.total === 0 && d.marks.length === 0)).toBe(true);
    expect(body.timezone).toBe('Europe/Budapest');
  });

  it('reports the window occurrences have actually been materialised into', async () => {
    const { body } = await call<AgendaDensityResponse>('/agenda/density?days=1');
    // Without this the year view cannot tell an empty December from an
    // un-fetched one.
    expect(Date.parse(body.coverageStart)).toBeLessThan(Date.now());
    expect(Date.parse(body.coverageEnd)).toBeGreaterThan(Date.now());
  });

  it('accepts a whole leap year', async () => {
    const { status, body } = await call<AgendaDensityResponse>(
      '/agenda/density?start=2028-01-01&days=366',
    );
    expect(status).toBe(200);
    expect(body.days).toHaveLength(366);
    expect(body.days.at(-1)?.date).toBe('2028-12-31');
  });

  it('rejects a range longer than a year', async () => {
    expect((await call('/agenda/density?days=400')).status).toBe(422);
  });
});

describe('people and presence', () => {
  it('creates a person and records a sighting', async () => {
    const person = await call<{ person: Person }>('/people', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Alice', color: '#123456' }),
    });
    expect(person.status).toBe(201);

    const before = await call<{ present: unknown[] }>('/presence');
    expect(before.body.present).toHaveLength(0);

    const sighting = await call('/presence/sightings', {
      method: 'POST',
      body: JSON.stringify({ personId: person.body.person.id, confidence: 0.92 }),
    });
    expect(sighting.status).toBe(201);

    const after = await call<{ present: Array<{ displayName: string }> }>('/presence');
    expect(after.body.present.map((p) => p.displayName)).toEqual(['Alice']);
  });
});

describe('birthdays', () => {
  it('creates, lists, patches and deletes a birthday', async () => {
    const created = await call<{ birthday: Birthday }>('/birthdays', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Ada',
        date: { month: 3, day: 3, year: 2017 },
        icon: 'bi-balloon',
        color: '#123456',
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.birthday.date).toEqual({ month: 3, day: 3, year: 2017 });

    const id = created.body.birthday.id;

    const listed = await call<{ birthdays: Birthday[] }>('/birthdays');
    expect(listed.body.birthdays.map((b) => b.id)).toEqual([id]);

    const patched = await call<{ birthday: Birthday }>(`/birthdays/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ date: { month: 3, day: 3, year: null } }),
    });
    // Dropping the year must not disturb anything else on the record.
    expect(patched.body.birthday.date).toEqual({ month: 3, day: 3, year: null });
    expect(patched.body.birthday.icon).toBe('bi-balloon');

    expect((await call(`/birthdays/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call<{ birthdays: Birthday[] }>('/birthdays')).body.birthdays).toHaveLength(0);
  });

  it('applies the schema defaults server-side', async () => {
    const { body } = await call<{ birthday: Birthday }>('/birthdays', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Ada', date: { month: 3, day: 3 } }),
    });
    expect(body.birthday.date.year).toBeNull();
    expect(body.birthday.icon).toBe('bi-cake2');
    expect(body.birthday.active).toBe(true);
  });

  it('rejects an impossible date, a missing date and a non-Bootstrap icon', async () => {
    const bad = [
      { displayName: 'Ada', date: { month: 2, day: 30 } },
      { displayName: 'Ada' },
      { displayName: 'Ada', date: { month: 3, day: 3 }, icon: 'javascript:alert(1)' },
    ];
    for (const body of bad) {
      expect(
        (await call('/birthdays', { method: 'POST', body: JSON.stringify(body) })).status,
      ).toBe(422);
    }
  });

  it('lands on both agenda views without a feed behind it', async () => {
    await call('/birthdays', {
      method: 'POST',
      body: JSON.stringify({
        displayName: 'Ada',
        date: { month: 3, day: 3, year: 2017 },
        color: '#123456',
      }),
    });

    const agenda = await call<AgendaResponse>('/agenda?start=2026-03-01&days=5');
    const agendaDay = agenda.body.days.find((day) => day.date === '2026-03-03');
    expect(agendaDay?.birthdays.map((b) => [b.displayName, b.age])).toEqual([['Ada', 9]]);
    expect(agendaDay?.occurrences).toHaveLength(0);

    // The overviews must agree with the agenda about the day.
    const density = await call<AgendaDensityResponse>('/agenda/density?start=2026-03-01&days=5');
    const densityDay = density.body.days.find((day) => day.date === '2026-03-03');
    expect(densityDay?.birthdays.map((b) => b.displayName)).toEqual(['Ada']);
  });

  it('is drawn whatever presence narrows the agenda to', async () => {
    const person = await call<{ person: Person }>('/people', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Bob', color: '#654321' }),
    });
    await call('/birthdays', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Nan', date: { month: 3, day: 3 } }),
    });
    await call('/presence/sightings', {
      method: 'POST',
      body: JSON.stringify({ personId: person.body.person.id, confidence: 0.99 }),
    });

    const agenda = await call<AgendaResponse>('/agenda?start=2026-03-01&days=5');
    const day = agenda.body.days.find((d) => d.date === '2026-03-03');
    expect(day?.birthdays.map((b) => b.displayName)).toEqual(['Nan']);
  });

  it('hides an inactive birthday from the calendar but keeps the record', async () => {
    const created = await call<{ birthday: Birthday }>('/birthdays', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Ada', date: { month: 3, day: 3 }, active: false }),
    });
    expect(created.body.birthday.active).toBe(false);

    const agenda = await call<AgendaResponse>('/agenda?start=2026-03-01&days=5');
    expect(agenda.body.days.find((d) => d.date === '2026-03-03')?.birthdays).toEqual([]);
    expect((await call<{ birthdays: Birthday[] }>('/birthdays')).body.birthdays).toHaveLength(1);
  });
});

describe('unknown routes', () => {
  it('returns a JSON error envelope', async () => {
    const { status, body } = await call<{ error: { code: string } }>('/nope');
    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });
});
