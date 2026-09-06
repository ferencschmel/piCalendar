import { Router } from 'express';
import { feedInputSchema, feedUpdateSchema } from '@picalendar/shared';
import { getDb } from '../db/index.js';
import * as feeds from '../db/repositories/feeds.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { fetchIcs, normalizeFeedUrl } from '../ingest/icsClient.js';
import { parseIcs } from '../ingest/parser.js';
import { currentWindow, syncFeed } from '../ingest/syncService.js';
import { config } from '../config/index.js';
import { pathParam } from '../util/http.js';

export const feedsRouter: Router = Router();

feedsRouter.get('/', (_req, res) => {
  res.json({ feeds: feeds.listFeeds(getDb()) });
});

feedsRouter.get('/:id', (req, res) => {
  const feed = feeds.getFeed(getDb(), pathParam(req, 'id'));
  if (!feed) throw HttpError.notFound('Feed');
  res.json({ feed, recentRuns: feeds.listRecentSyncRuns(getDb(), feed.id) });
});

feedsRouter.post('/', requireAdmin, (req, res) => {
  const input = feedInputSchema.parse(req.body);
  const feed = feeds.createFeed(getDb(), { ...input, url: normalizeFeedUrl(input.url) });
  res.status(201).json({ feed });
});

feedsRouter.patch('/:id', requireAdmin, (req, res) => {
  const patch = feedUpdateSchema.parse(req.body);
  const feed = feeds.updateFeed(getDb(), pathParam(req, 'id'), {
    ...patch,
    ...(patch.url ? { url: normalizeFeedUrl(patch.url) } : {}),
  });
  if (!feed) throw HttpError.notFound('Feed');
  res.json({ feed });
});

feedsRouter.delete('/:id', requireAdmin, (req, res) => {
  if (!feeds.deleteFeed(getDb(), pathParam(req, 'id'))) throw HttpError.notFound('Feed');
  res.status(204).end();
});

/** Force an immediate refresh, bypassing the feed's own interval. */
feedsRouter.post('/:id/sync', requireAdmin, async (req, res) => {
  const db = getDb();
  const feed = feeds.getFeed(db, pathParam(req, 'id'));
  if (!feed) throw HttpError.notFound('Feed');

  const outcome = await syncFeed(db, feed);
  res.json({ outcome, feed: feeds.getFeed(db, feed.id) });
});

/**
 * Dry-run a URL before saving it, so the admin form can report "found 42
 * events" instead of the operator discovering a typo on the next sync.
 */
feedsRouter.post('/test', requireAdmin, async (req, res) => {
  const { url, sourceType } = feedInputSchema
    .pick({ url: true, sourceType: true })
    .parse({ sourceType: 'ics', ...req.body });

  const result = await fetchIcs(url, { timeoutMs: config.sync.timeoutMs });
  if (result.status === 'not-modified') {
    res.json({ ok: true, eventCount: 0, message: 'Server reported not modified' });
    return;
  }

  const window = currentWindow();
  const events = parseIcs(result.body, {
    windowStart: window.start,
    windowEnd: window.end,
    displayTimezone: config.display.timezone,
  });

  res.json({
    ok: true,
    sourceType,
    eventCount: events.length,
    occurrenceCount: events.reduce((sum, e) => sum + e.occurrences.length, 0),
    sample: events.slice(0, 5).map((e) => ({ summary: e.summary, startsAt: e.startsAt })),
  });
});
