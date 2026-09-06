import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config/index.js';
import { logger } from '../logger.js';

export type Db = Database.Database;

let instance: Db | null = null;

/**
 * Pragmas chosen for a Raspberry Pi running off an SD card:
 * - WAL lets the dashboard read while the sync worker writes.
 * - `synchronous = NORMAL` is the WAL-safe setting and removes an fsync per
 *   commit, which is the single biggest win on slow flash storage.
 * - A 64 MB mmap and 8 MB page cache keep the hot agenda index in memory.
 */
function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -8000');
  db.pragma('mmap_size = 67108864');
  db.pragma('temp_store = MEMORY');
}

export function openDatabase(databasePath: string = config.database.path): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  applyPragmas(db);
  return db;
}

/** Process-wide connection. better-sqlite3 is synchronous, so one is enough. */
export function getDb(): Db {
  if (!instance) {
    instance = openDatabase();
    logger.info({ path: config.database.path }, 'database opened');
  }
  return instance;
}

export function closeDb(): void {
  if (instance) {
    // Fold the WAL back into the main file so backups are a single-file copy.
    instance.pragma('wal_checkpoint(TRUNCATE)');
    instance.close();
    instance = null;
  }
}
