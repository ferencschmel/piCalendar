import { createHash, randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

/**
 * Stable identity for an occurrence: derived from its event and start time so
 * re-expanding a series produces the same row ids and the write becomes an
 * idempotent upsert rather than a delete/insert churn on the index.
 */
export function occurrenceId(eventId: string, startsAt: number): string {
  return createHash('sha1').update(`${eventId}:${startsAt}`).digest('hex').slice(0, 32);
}

export function contentHash(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}
