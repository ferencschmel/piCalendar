import { getDb, closeDb } from './index.js';
import { runMigrations } from './migrate.js';
import { logger } from '../logger.js';

const applied = runMigrations(getDb());
logger.info(
  { count: applied.length, applied },
  applied.length ? 'migrations complete' : 'database already up to date',
);
closeDb();
