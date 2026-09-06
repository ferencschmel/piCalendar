import { config } from '../config/index.js';
import type { Db } from '../db/index.js';
import { pruneSyncRuns } from '../db/repositories/feeds.js';
import { pruneSightings } from '../db/repositories/presence.js';
import { logger } from '../logger.js';
import { syncDueFeeds } from './syncService.js';

/**
 * Single-timer scheduler. Each tick asks the database which feeds are due
 * according to their own refresh interval, so per-feed cadence is a data
 * concern rather than one timer per feed.
 *
 * Ticks never overlap: a slow sync delays the next tick instead of stacking up.
 */
export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private ticks = 0;

  constructor(private readonly db: Db) {}

  start(): void {
    if (this.timer || !config.sync.enabled) {
      if (!config.sync.enabled) logger.warn('background sync disabled by configuration');
      return;
    }
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), config.sync.tickSeconds * 1000);
    // Do not hold the event loop open purely for the poller.
    this.timer.unref();
    logger.info({ everySeconds: config.sync.tickSeconds }, 'sync scheduler started');

    if (config.sync.onStartup) void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Exposed so the admin "sync now" endpoint can share the overlap guard. */
  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const outcomes = await syncDueFeeds(this.db);
      if (outcomes.length > 0) {
        logger.debug({ feeds: outcomes.length }, 'sync tick complete');
      }
      // Housekeeping once an hour's worth of ticks, not on every pass.
      this.ticks += 1;
      if (this.ticks % Math.max(1, Math.floor(3600 / config.sync.tickSeconds)) === 0) {
        pruneSyncRuns(this.db);
        pruneSightings(this.db, 7 * 86_400);
      }
    } catch (error) {
      logger.error({ err: error }, 'sync tick failed');
    } finally {
      this.running = false;
    }
  }
}
