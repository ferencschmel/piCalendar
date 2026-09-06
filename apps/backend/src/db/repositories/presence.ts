import type { PresenceSighting, PresenceSightingInput, PresenceState } from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { nowEpoch, toIso } from '../../util/time.js';

interface SightingRow {
  id: string;
  person_id: string;
  detected_at: number;
  confidence: number;
  source: PresenceSighting['source'];
  camera_id: string | null;
}

function toSighting(row: SightingRow): PresenceSighting {
  return {
    id: row.id,
    personId: row.person_id,
    detectedAt: toIso(row.detected_at)!,
    confidence: row.confidence,
    source: row.source,
    cameraId: row.camera_id,
  };
}

export function recordSighting(db: Db, input: PresenceSightingInput): PresenceSighting {
  const id = newId();
  const detectedAt = input.detectedAt
    ? Math.floor(new Date(input.detectedAt).getTime() / 1000)
    : nowEpoch();
  db.prepare(
    `INSERT INTO presence_sighting (id, person_id, detected_at, confidence, source, camera_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.personId, detectedAt, input.confidence, input.source, input.cameraId ?? null);

  return toSighting(
    db.prepare<[string], SightingRow>('SELECT * FROM presence_sighting WHERE id = ?').get(id)!,
  );
}

/**
 * Who counts as "in the room" right now: the most recent sighting per active
 * person, provided it landed inside the presence window and cleared the
 * confidence floor. The camera detector will feed this; until then it simply
 * returns an empty set and the dashboard shows every calendar.
 */
export function getPresenceState(
  db: Db,
  windowSeconds: number,
  minConfidence = 0.5,
): PresenceState {
  const cutoff = nowEpoch() - windowSeconds;
  const rows = db
    .prepare<
      [number, number],
      {
        person_id: string;
        display_name: string;
        color: string;
        last_seen: number;
        confidence: number;
      }
    >(
      `SELECT s.person_id, p.display_name, p.color,
              MAX(s.detected_at) AS last_seen, MAX(s.confidence) AS confidence
       FROM presence_sighting s
       JOIN person p ON p.id = s.person_id
       WHERE s.detected_at >= ? AND s.confidence >= ? AND p.active = 1
       GROUP BY s.person_id
       ORDER BY last_seen DESC`,
    )
    .all(cutoff, minConfidence);

  return {
    present: rows.map((row) => ({
      personId: row.person_id,
      displayName: row.display_name,
      color: row.color,
      lastSeenAt: toIso(row.last_seen)!,
      confidence: row.confidence,
    })),
    windowSeconds,
    evaluatedAt: new Date().toISOString(),
  };
}

/** Presence history is high-volume and low-value; keep only recent sightings. */
export function pruneSightings(db: Db, olderThanSeconds: number): number {
  return db
    .prepare('DELETE FROM presence_sighting WHERE detected_at < ?')
    .run(nowEpoch() - olderThanSeconds).changes;
}
