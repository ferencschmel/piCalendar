import type { Person, PersonInput, PersonUpdate } from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { nowEpoch, toIso } from '../../util/time.js';

interface PersonRow {
  id: string;
  display_name: string;
  email: string | null;
  color: string;
  active: number;
  created_at: number;
  updated_at: number;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    color: row.color,
    active: row.active === 1,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export function listPeople(db: Db): Person[] {
  return db
    .prepare<[], PersonRow>(
      'SELECT * FROM person ORDER BY active DESC, display_name COLLATE NOCASE',
    )
    .all()
    .map(toPerson);
}

export function getPerson(db: Db, id: string): Person | null {
  const row = db.prepare<[string], PersonRow>('SELECT * FROM person WHERE id = ?').get(id);
  return row ? toPerson(row) : null;
}

export function createPerson(db: Db, input: PersonInput): Person {
  const id = newId();
  const now = nowEpoch();
  db.prepare(
    `INSERT INTO person (id, display_name, email, color, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.displayName, input.email || null, input.color, input.active ? 1 : 0, now, now);
  return getPerson(db, id)!;
}

export function updatePerson(db: Db, id: string, patch: PersonUpdate): Person | null {
  const existing = getPerson(db, id);
  if (!existing) return null;

  const merged = {
    displayName: patch.displayName ?? existing.displayName,
    email: patch.email === undefined ? existing.email : patch.email || null,
    color: patch.color ?? existing.color,
    active: patch.active ?? existing.active,
  };
  db.prepare(
    `UPDATE person SET display_name = ?, email = ?, color = ?, active = ?, updated_at = ?
     WHERE id = ?`,
  ).run(merged.displayName, merged.email, merged.color, merged.active ? 1 : 0, nowEpoch(), id);
  return getPerson(db, id);
}

export function deletePerson(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM person WHERE id = ?').run(id).changes > 0;
}
