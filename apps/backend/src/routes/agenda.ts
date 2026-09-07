import { Router } from 'express';
import {
  agendaDensityQuerySchema,
  agendaQuerySchema,
  type AgendaDensityResponse,
  type AgendaResponse,
} from '@picalendar/shared';
import { config } from '../config/index.js';
import { getDb, type Db } from '../db/index.js';
import {
  groupByDay,
  groupDensityByDay,
  queryOccurrences,
  queryOccurrenceDensity,
} from '../db/repositories/events.js';
import { birthdayRevision, listActiveBirthdays } from '../db/repositories/birthdays.js';
import { getAgendaRevision } from '../db/repositories/settings.js';
import { getPresenceState } from '../db/repositories/presence.js';
import { celebrationsByDay } from '../util/birthdays.js';
import { dayKeyRange, dayStartEpoch, nowEpoch, toDayKey } from '../util/time.js';

export const agendaRouter: Router = Router();

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * With no explicit filter, fall back to whoever the camera currently sees.
 * Until a detector is wired up the presence set is empty and every calendar is
 * shown, which is the right default for a shared family display.
 */
function resolvePersonIds(db: Db, requested: string | string[] | undefined): string[] | undefined {
  const explicit = toArray(requested);
  if (explicit) return explicit;

  const presence = getPresenceState(db, config.presence.windowSeconds);
  return presence.present.length > 0 ? presence.present.map((p) => p.personId) : undefined;
}

/**
 * GET /api/agenda — today plus the following days, bucketed by local date.
 *
 * This is what the wall display polls. The response carries a `revision` that
 * only changes when ingest wrote something, letting the client skip a repaint.
 */
agendaRouter.get('/', (req, res) => {
  const query = agendaQuerySchema.parse(req.query);
  const db = getDb();
  const timezone = config.display.timezone;

  const startKey = query.start ?? toDayKey(nowEpoch(), timezone);
  const dayKeys = dayKeyRange(startKey, query.days);
  const rangeStart = dayStartEpoch(startKey, timezone);
  const rangeEnd = dayStartEpoch(dayKeys.at(-1)!, timezone) + 86_400;

  const personIds = resolvePersonIds(db, query.personId);

  const occurrences = queryOccurrences(db, rangeStart, rangeEnd, {
    feedIds: toArray(query.feedId),
    personIds,
  });

  // Not narrowed by `personIds`: presence selects whose *calendars* are worth
  // the wall's attention, and birthdays are not a person's calendar. Grandma is
  // never in the room and her birthday still belongs on the display.
  const birthdays = celebrationsByDay(listActiveBirthdays(db), dayKeys);

  const response: AgendaResponse = {
    generatedAt: new Date().toISOString(),
    rangeStart: new Date(rangeStart * 1000).toISOString(),
    rangeEnd: new Date(rangeEnd * 1000).toISOString(),
    timezone,
    days: groupByDay(occurrences, dayKeys, timezone, toDayKey(nowEpoch(), timezone), birthdays),
    revision: `${getAgendaRevision(db)}:${birthdayRevision(db)}:${startKey}:${query.days}:${
      personIds?.join(',') ?? 'all'
    }`,
  };

  // The dashboard polls this every minute; a short cache keeps a reloading
  // browser from stampeding the Pi without ever showing stale-by-minutes data.
  res.set('Cache-Control', 'no-cache');
  res.json(response);
});

/**
 * GET /api/agenda/density — the same days, reduced to one coloured mark per
 * feed per day.
 *
 * This is what the month and year overviews poll. They draw dots, not text, and
 * the year asks for 366 days at once; sending full occurrences for that range
 * would push megabytes of descriptions over the wire every minute for a display
 * that never renders them.
 */
agendaRouter.get('/density', (req, res) => {
  const query = agendaDensityQuerySchema.parse(req.query);
  const db = getDb();
  const timezone = config.display.timezone;
  const now = nowEpoch();

  const startKey = query.start ?? toDayKey(now, timezone);
  const dayKeys = dayKeyRange(startKey, query.days);
  const rangeStart = dayStartEpoch(startKey, timezone);
  const rangeEnd = dayStartEpoch(dayKeys.at(-1)!, timezone) + 86_400;

  const personIds = resolvePersonIds(db, query.personId);

  const rows = queryOccurrenceDensity(db, rangeStart, rangeEnd, {
    feedIds: toArray(query.feedId),
    personIds,
  });

  const birthdays = celebrationsByDay(listActiveBirthdays(db), dayKeys);

  // Ingest only expands recurrences inside a rolling window, so a year grid
  // runs off the end of what has been materialised. Reporting the window lets
  // the overview distinguish "nothing on" from "nothing known yet".
  const coverageStart = now - config.sync.windowPastDays * 86_400;
  const coverageEnd = now + config.sync.windowFutureDays * 86_400;

  const response: AgendaDensityResponse = {
    generatedAt: new Date().toISOString(),
    timezone,
    coverageStart: new Date(coverageStart * 1000).toISOString(),
    coverageEnd: new Date(coverageEnd * 1000).toISOString(),
    days: groupDensityByDay(rows, dayKeys, timezone, toDayKey(now, timezone), birthdays),
    revision: `${getAgendaRevision(db)}:${birthdayRevision(db)}:${startKey}:${query.days}:${
      personIds?.join(',') ?? 'all'
    }`,
  };

  res.set('Cache-Control', 'no-cache');
  res.json(response);
});
