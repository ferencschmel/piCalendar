import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index.js';
import { logger } from '../logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, 'migrations');

interface MigrationFile {
  name: string;
  sql: string;
}

function loadMigrations(dir = migrationsDir): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  return (
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      // Filenames are zero-padded (`001_init.sql`) so lexical order is apply order.
      .sort()
      .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }))
  );
}

/**
 * Forward-only migrations. Each file runs inside a transaction together with
 * the bookkeeping insert, so a failure mid-file leaves nothing half-applied.
 */
export function runMigrations(db: Db, dir = migrationsDir): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name       TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare<[], { name: string }>('SELECT name FROM schema_migration')
      .all()
      .map((row) => row.name),
  );

  const pending = loadMigrations(dir).filter((m) => !applied.has(m.name));
  const record = db.prepare('INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)');

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.name, Math.floor(Date.now() / 1000));
    });
    apply();
    logger.info({ migration: migration.name }, 'migration applied');
  }

  return pending.map((m) => m.name);
}
