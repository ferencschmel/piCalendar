import type { Feed, FeedInput, FeedSyncStatus, FeedUpdate, SyncRun } from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { nowEpoch, toIso } from '../../util/time.js';

interface FeedRow {
  id: string;
  name: string;
  source_type: Feed['sourceType'];
  url: string;
  enabled: number;
  color: string;
  refresh_interval_seconds: number;
  http_etag: string | null;
  http_last_modified: string | null;
  content_hash: string | null;
  last_status: FeedSyncStatus;
  last_synced_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

/** Cache validators, kept out of the public `Feed` shape the API returns. */
export interface FeedFetchState {
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
}

function personIdsFor(db: Db, feedId: string): string[] {
  return db
    .prepare<[string], { person_id: string }>(
      'SELECT person_id FROM feed_person WHERE feed_id = ? ORDER BY person_id',
    )
    .all(feedId)
    .map((r) => r.person_id);
}

function eventCountFor(db: Db, feedId: string): number {
  return (
    db
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM event WHERE feed_id = ?')
      .get(feedId)?.count ?? 0
  );
}

function toFeed(db: Db, row: FeedRow): Feed {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.source_type,
    url: row.url,
    enabled: row.enabled === 1,
    color: row.color,
    refreshIntervalSeconds: row.refresh_interval_seconds,
    personIds: personIdsFor(db, row.id),
    lastStatus: row.last_status,
    lastSyncedAt: toIso(row.last_synced_at),
    lastError: row.last_error,
    eventCount: eventCountFor(db, row.id),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function replacePeople(db: Db, feedId: string, personIds: string[]): void {
  db.prepare('DELETE FROM feed_person WHERE feed_id = ?').run(feedId);
  const link = db.prepare('INSERT OR IGNORE INTO feed_person (feed_id, person_id) VALUES (?, ?)');
  for (const personId of personIds) link.run(feedId, personId);
}

export function listFeeds(db: Db): Feed[] {
  return db
    .prepare<[], FeedRow>('SELECT * FROM feed ORDER BY name COLLATE NOCASE')
    .all()
    .map((row) => toFeed(db, row));
}

export function getFeed(db: Db, id: string): Feed | null {
  const row = db.prepare<[string], FeedRow>('SELECT * FROM feed WHERE id = ?').get(id);
  return row ? toFeed(db, row) : null;
}

export function createFeed(db: Db, input: FeedInput): Feed {
  const id = newId();
  const now = nowEpoch();
  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO feed
         (id, name, source_type, url, enabled, color, refresh_interval_seconds,
          last_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      id,
      input.name,
      input.sourceType,
      input.url,
      input.enabled ? 1 : 0,
      input.color,
      input.refreshIntervalSeconds,
      now,
      now,
    );
    replacePeople(db, id, input.personIds);
  });
  insert();
  return getFeed(db, id)!;
}

export function updateFeed(db: Db, id: string, patch: FeedUpdate): Feed | null {
  const existing = getFeed(db, id);
  if (!existing) return null;

  const merged = {
    name: patch.name ?? existing.name,
    sourceType: patch.sourceType ?? existing.sourceType,
    url: patch.url ?? existing.url,
    enabled: patch.enabled ?? existing.enabled,
    color: patch.color ?? existing.color,
    refreshIntervalSeconds: patch.refreshIntervalSeconds ?? existing.refreshIntervalSeconds,
  };
  // A changed URL invalidates the cached validators and the stored body hash.
  const urlChanged = merged.url !== existing.url;

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE feed SET name = ?, source_type = ?, url = ?, enabled = ?, color = ?,
         refresh_interval_seconds = ?, updated_at = ?
         ${urlChanged ? ", http_etag = NULL, http_last_modified = NULL, content_hash = NULL, last_status = 'pending', last_synced_at = NULL, last_error = NULL" : ''}
       WHERE id = ?`,
    ).run(
      merged.name,
      merged.sourceType,
      merged.url,
      merged.enabled ? 1 : 0,
      merged.color,
      merged.refreshIntervalSeconds,
      nowEpoch(),
      id,
    );
    if (patch.personIds) replacePeople(db, id, patch.personIds);
  });
  apply();
  return getFeed(db, id);
}

export function deleteFeed(db: Db, id: string): boolean {
  // Events and occurrences go with it via ON DELETE CASCADE.
  return db.prepare('DELETE FROM feed WHERE id = ?').run(id).changes > 0;
}

export function getFetchState(db: Db, id: string): FeedFetchState {
  const row = db
    .prepare<[string], Pick<FeedRow, 'http_etag' | 'http_last_modified' | 'content_hash'>>(
      'SELECT http_etag, http_last_modified, content_hash FROM feed WHERE id = ?',
    )
    .get(id);
  return {
    etag: row?.http_etag ?? null,
    lastModified: row?.http_last_modified ?? null,
    contentHash: row?.content_hash ?? null,
  };
}

export function saveFetchState(db: Db, id: string, state: FeedFetchState): void {
  db.prepare(
    'UPDATE feed SET http_etag = ?, http_last_modified = ?, content_hash = ? WHERE id = ?',
  ).run(state.etag, state.lastModified, state.contentHash, id);
}

export function markSyncResult(
  db: Db,
  id: string,
  status: FeedSyncStatus,
  error: string | null,
): void {
  db.prepare(
    'UPDATE feed SET last_status = ?, last_synced_at = ?, last_error = ?, updated_at = ? WHERE id = ?',
  ).run(status, nowEpoch(), error, nowEpoch(), id);
}

/**
 * Feeds whose own refresh interval has elapsed. Never-synced feeds sort first
 * so a freshly added calendar appears on the wall within one tick.
 */
export function listDueFeeds(db: Db, now = nowEpoch()): Feed[] {
  return db
    .prepare<[number], FeedRow>(
      `SELECT * FROM feed
       WHERE enabled = 1
         AND (last_synced_at IS NULL OR last_synced_at + refresh_interval_seconds <= ?)
       ORDER BY last_synced_at IS NOT NULL, last_synced_at ASC`,
    )
    .all(now)
    .map((row) => toFeed(db, row));
}

interface SyncRunRow {
  id: string;
  feed_id: string;
  started_at: number;
  finished_at: number | null;
  status: FeedSyncStatus;
  events_upserted: number;
  events_deleted: number;
  message: string | null;
}

export function startSyncRun(db: Db, feedId: string): string {
  const id = newId();
  db.prepare(
    `INSERT INTO sync_run (id, feed_id, started_at, status) VALUES (?, ?, ?, 'pending')`,
  ).run(id, feedId, nowEpoch());
  return id;
}

export function finishSyncRun(
  db: Db,
  id: string,
  status: FeedSyncStatus,
  counts: { upserted: number; deleted: number },
  message: string | null,
): void {
  db.prepare(
    `UPDATE sync_run SET finished_at = ?, status = ?, events_upserted = ?, events_deleted = ?, message = ?
     WHERE id = ?`,
  ).run(nowEpoch(), status, counts.upserted, counts.deleted, message, id);
}

export function listRecentSyncRuns(db: Db, feedId: string, limit = 10): SyncRun[] {
  return db
    .prepare<[string, number], SyncRunRow>(
      'SELECT * FROM sync_run WHERE feed_id = ? ORDER BY started_at DESC LIMIT ?',
    )
    .all(feedId, limit)
    .map((row) => ({
      id: row.id,
      feedId: row.feed_id,
      startedAt: toIso(row.started_at)!,
      finishedAt: toIso(row.finished_at),
      status: row.status,
      eventsUpserted: row.events_upserted,
      eventsDeleted: row.events_deleted,
      message: row.message,
    }));
}

/** Keeps the sync log from growing without bound on a long-lived device. */
export function pruneSyncRuns(db: Db, keepPerFeed = 50): number {
  return db
    .prepare(
      `DELETE FROM sync_run WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY started_at DESC) AS rn
         FROM sync_run
       ) WHERE rn > ?
     )`,
    )
    .run(keepPerFeed).changes;
}
