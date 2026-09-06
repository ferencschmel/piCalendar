import type { Db } from '../index.js';
import { nowEpoch } from '../../util/time.js';

const AGENDA_REVISION = 'agenda_revision';

export function getSetting(db: Db, key: string): string | null {
  const row = db
    .prepare<[string], { value: string }>('SELECT value FROM setting WHERE key = ?')
    .get(key);
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, nowEpoch());
}

/**
 * Monotonic counter bumped whenever ingest changes anything the dashboard
 * renders. The polling client compares it and skips re-rendering when it has
 * not moved, which keeps the Pi's browser from repainting every 60 seconds.
 */
export function bumpAgendaRevision(db: Db): string {
  const next = String(Number(getSetting(db, AGENDA_REVISION) ?? '0') + 1);
  setSetting(db, AGENDA_REVISION, next);
  return next;
}

export function getAgendaRevision(db: Db): string {
  return getSetting(db, AGENDA_REVISION) ?? '0';
}
