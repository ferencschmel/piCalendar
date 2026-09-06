import { Router } from 'express';
import { agendaQuerySchema, type AgendaResponse } from '@picalendar/shared';
import { config } from '../config/index.js';
import { getDb } from '../db/index.js';
import { groupByDay, queryOccurrences } from '../db/repositories/events.js';
import { getAgendaRevision } from '../db/repositories/settings.js';
import { getPresenceState } from '../db/repositories/presence.js';
import { dayKeyRange, dayStartEpoch, nowEpoch, toDayKey } from '../util/time.js';

export const agendaRouter: Router = Router();

function toArray(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
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

  let personIds = toArray(query.personId);

  // With no explicit filter, fall back to whoever the camera currently sees.
  // Until a detector is wired up the presence set is empty and every calendar
  // is shown, which is the right default for a shared family display.
  if (!personIds) {
    const presence = getPresenceState(db, config.presence.windowSeconds);
    if (presence.present.length > 0) {
      personIds = presence.present.map((p) => p.personId);
    }
  }

  const occurrences = queryOccurrences(db, rangeStart, rangeEnd, {
    feedIds: toArray(query.feedId),
    personIds,
  });

  const response: AgendaResponse = {
    generatedAt: new Date().toISOString(),
    rangeStart: new Date(rangeStart * 1000).toISOString(),
    rangeEnd: new Date(rangeEnd * 1000).toISOString(),
    timezone,
    days: groupByDay(occurrences, dayKeys, timezone, toDayKey(nowEpoch(), timezone)),
    revision: `${getAgendaRevision(db)}:${startKey}:${query.days}:${personIds?.join(',') ?? 'all'}`,
  };

  // The dashboard polls this every minute; a short cache keeps a reloading
  // browser from stampeding the Pi without ever showing stale-by-minutes data.
  res.set('Cache-Control', 'no-cache');
  res.json(response);
});
