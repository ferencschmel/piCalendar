import { config } from './config/index.js';
import { closeDb, getDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { SyncScheduler } from './ingest/scheduler.js';
import { logger } from './logger.js';
import { createServer } from './server.js';

const db = getDb();
runMigrations(db);

const scheduler = new SyncScheduler(db);
const server = createServer().listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, env: config.env }, 'piCalendar listening');
  scheduler.start();
});

/**
 * systemd sends SIGTERM on restart. Draining in-flight requests before closing
 * SQLite avoids leaving a WAL behind that the next boot has to recover.
 */
function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  scheduler.stop();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Do not hang forever on a stuck keep-alive connection.
  setTimeout(() => {
    logger.warn('forced shutdown after timeout');
    closeDb();
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});
