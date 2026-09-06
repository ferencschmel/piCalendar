import type { Feed } from '@picalendar/shared';
import { config } from '../config/index.js';
import type { Db } from '../db/index.js';
import * as feeds from '../db/repositories/feeds.js';
import { pruneOccurrences, replaceFeedEvents } from '../db/repositories/events.js';
import { bumpAgendaRevision } from '../db/repositories/settings.js';
import { logger } from '../logger.js';
import { nowEpoch } from '../util/time.js';
import { applyAdapter } from './adapters.js';
import { fetchIcs, IcsFetchError } from './icsClient.js';
import { parseIcs } from './parser.js';

export interface SyncOutcome {
  feedId: string;
  status: 'ok' | 'skipped' | 'error';
  upserted: number;
  deleted: number;
  message: string | null;
}

/** Rolling materialisation window, recomputed on every sync. */
export function currentWindow(now = nowEpoch()): { start: number; end: number } {
  return {
    start: now - config.sync.windowPastDays * 86_400,
    end: now + config.sync.windowFutureDays * 86_400,
  };
}

/**
 * Pull one feed and reconcile it into the database.
 *
 * Short-circuits on a 304 or an unchanged body hash — a wall display polling a
 * dozen calendars every 15 minutes should almost always do no work at all.
 */
export async function syncFeed(db: Db, feed: Feed): Promise<SyncOutcome> {
  const runId = feeds.startSyncRun(db, feed.id);
  const cache = feeds.getFetchState(db, feed.id);

  try {
    const result = await fetchIcs(feed.url, {
      etag: cache.etag,
      lastModified: cache.lastModified,
      timeoutMs: config.sync.timeoutMs,
    });

    if (result.status === 'not-modified') {
      feeds.markSyncResult(db, feed.id, 'ok', null);
      feeds.finishSyncRun(db, runId, 'ok', { upserted: 0, deleted: 0 }, 'not modified');
      return {
        feedId: feed.id,
        status: 'skipped',
        upserted: 0,
        deleted: 0,
        message: 'not modified',
      };
    }

    if (cache.contentHash && cache.contentHash === result.hash) {
      feeds.saveFetchState(db, feed.id, {
        etag: result.etag,
        lastModified: result.lastModified,
        contentHash: result.hash,
      });
      feeds.markSyncResult(db, feed.id, 'ok', null);
      feeds.finishSyncRun(db, runId, 'ok', { upserted: 0, deleted: 0 }, 'unchanged body');
      return { feedId: feed.id, status: 'skipped', upserted: 0, deleted: 0, message: 'unchanged' };
    }

    const window = currentWindow();
    const parsed = parseIcs(result.body, {
      windowStart: window.start,
      windowEnd: window.end,
      displayTimezone: config.display.timezone,
    });
    const events = applyAdapter(feed.sourceType, parsed);
    const written = replaceFeedEvents(db, feed.id, events);

    feeds.saveFetchState(db, feed.id, {
      etag: result.etag,
      lastModified: result.lastModified,
      contentHash: result.hash,
    });
    feeds.markSyncResult(db, feed.id, 'ok', null);
    feeds.finishSyncRun(
      db,
      runId,
      'ok',
      { upserted: written.upserted, deleted: written.deleted },
      `${events.length} events parsed`,
    );
    if (written.changed) bumpAgendaRevision(db);

    logger.info({ feed: feed.name, parsed: events.length, ...written }, 'feed synced');
    return {
      feedId: feed.id,
      status: 'ok',
      upserted: written.upserted,
      deleted: written.deleted,
      message: null,
    };
  } catch (error) {
    const message =
      error instanceof IcsFetchError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown sync failure';
    feeds.markSyncResult(db, feed.id, 'error', message);
    feeds.finishSyncRun(db, runId, 'error', { upserted: 0, deleted: 0 }, message);
    logger.warn({ feed: feed.name, err: message }, 'feed sync failed');
    return { feedId: feed.id, status: 'error', upserted: 0, deleted: 0, message };
  }
}

/**
 * Sync every feed that is due. Feeds run one after another rather than in
 * parallel: the Pi has little RAM, and a serial pass keeps peak memory at one
 * ICS document regardless of how many calendars are configured.
 */
export async function syncDueFeeds(db: Db): Promise<SyncOutcome[]> {
  const due = feeds.listDueFeeds(db);
  if (due.length === 0) return [];

  const outcomes: SyncOutcome[] = [];
  for (const feed of due) {
    outcomes.push(await syncFeed(db, feed));
  }

  const window = currentWindow();
  pruneOccurrences(db, window.start, window.end);
  return outcomes;
}

export async function syncAllFeeds(db: Db): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const feed of feeds.listFeeds(db).filter((f) => f.enabled)) {
    outcomes.push(await syncFeed(db, feed));
  }
  return outcomes;
}
