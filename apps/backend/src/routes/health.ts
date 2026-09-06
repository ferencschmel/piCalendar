import { Router } from 'express';
import type { HealthResponse } from '@picalendar/shared';
import { config } from '../config/index.js';
import { getDb } from '../db/index.js';
import { logger } from '../logger.js';

export const healthRouter: Router = Router();

/** Liveness plus a quick "are my calendars actually working" summary. */
healthRouter.get('/', (_req, res) => {
  let database = { ok: true, path: config.database.path };
  let feedStats = { total: 0, enabled: 0, failing: 0 };

  try {
    const db = getDb();
    const row = db
      .prepare<[], { total: number; enabled: number; failing: number }>(
        `SELECT COUNT(*) AS total,
                SUM(enabled) AS enabled,
                SUM(CASE WHEN last_status = 'error' THEN 1 ELSE 0 END) AS failing
         FROM feed`,
      )
      .get();
    feedStats = {
      total: row?.total ?? 0,
      enabled: row?.enabled ?? 0,
      failing: row?.failing ?? 0,
    };
  } catch (error) {
    logger.error({ err: error }, 'health check could not read the database');
    database = { ok: false, path: config.database.path };
  }

  const body: HealthResponse = {
    status: database.ok && feedStats.failing === 0 ? 'ok' : 'degraded',
    version: process.env.npm_package_version ?? '0.1.0',
    uptimeSeconds: Math.round(process.uptime()),
    database,
    feeds: feedStats,
    time: new Date().toISOString(),
  };

  // 'degraded' still means the process is alive, so the status code stays 200 —
  // a failing feed should not make a container orchestrator restart the app.
  res.json(body);
});
