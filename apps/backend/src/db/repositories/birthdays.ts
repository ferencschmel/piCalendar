import type { Birthday, BirthdayInput, BirthdayUpdate } from '@picalendar/shared';
import type { Db } from '../index.js';
import { newId } from '../../util/ids.js';
import { nowEpoch, toIso } from '../../util/time.js';

interface BirthdayRow {
  id: string;
  display_name: string;
  birth_month: number;
  birth_day: number;
  birth_year: number | null;
  icon: string;
  color: string;
  active: number;
  created_at: number;
  updated_at: number;
}

function toBirthday(row: BirthdayRow): Birthday {
  return {
    id: row.id,
    displayName: row.display_name,
    date: { month: row.birth_month, day: row.birth_day, year: row.birth_year },
    icon: row.icon,
    color: row.color,
    active: row.active === 1,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

/**
 * Ordered by date rather than by name: the admin page's list is read as "who is
 * coming up", and a calendar year is the order that answers it.
 */
export function listBirthdays(db: Db): Birthday[] {
  return db
    .prepare<[], BirthdayRow>(
      `SELECT * FROM birthday
       ORDER BY active DESC, birth_month, birth_day, display_name COLLATE NOCASE`,
    )
    .all()
    .map(toBirthday);
}

/** Just the ones the dashboard should draw. */
export function listActiveBirthdays(db: Db): Birthday[] {
  return listBirthdays(db).filter((birthday) => birthday.active);
}

export function getBirthday(db: Db, id: string): Birthday | null {
  const row = db.prepare<[string], BirthdayRow>('SELECT * FROM birthday WHERE id = ?').get(id);
  return row ? toBirthday(row) : null;
}

export function createBirthday(db: Db, input: BirthdayInput): Birthday {
  const id = newId();
  const now = nowEpoch();
  db.prepare(
    `INSERT INTO birthday (id, display_name, birth_month, birth_day, birth_year,
       icon, color, active, created_at, updated_at)
     VALUES (@id, @displayName, @month, @day, @year, @icon, @color, @active, @now, @now)`,
  ).run({
    id,
    displayName: input.displayName,
    month: input.date.month,
    day: input.date.day,
    year: input.date.year,
    icon: input.icon,
    color: input.color,
    active: input.active ? 1 : 0,
    now,
  });
  return getBirthday(db, id)!;
}

export function updateBirthday(db: Db, id: string, patch: BirthdayUpdate): Birthday | null {
  const existing = getBirthday(db, id);
  if (!existing) return null;

  // A patch omitting `date` leaves the date alone; there is no way to clear it,
  // because a birthday with no date is not a record worth keeping.
  const merged = {
    displayName: patch.displayName ?? existing.displayName,
    date: patch.date ?? existing.date,
    icon: patch.icon ?? existing.icon,
    color: patch.color ?? existing.color,
    active: patch.active ?? existing.active,
  };
  db.prepare(
    `UPDATE birthday SET display_name = @displayName, birth_month = @month, birth_day = @day,
       birth_year = @year, icon = @icon, color = @color, active = @active, updated_at = @now
     WHERE id = @id`,
  ).run({
    id,
    displayName: merged.displayName,
    month: merged.date.month,
    day: merged.date.day,
    year: merged.date.year,
    icon: merged.icon,
    color: merged.color,
    active: merged.active ? 1 : 0,
    now: nowEpoch(),
  });
  return getBirthday(db, id);
}

export function deleteBirthday(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM birthday WHERE id = ?').run(id).changes > 0;
}

/**
 * A token that changes whenever the birthdays on the calendar could have.
 *
 * Birthdays are not ingested, so `agenda_revision` — which only ingest bumps —
 * would leave a client that skips repaints on an unchanged revision showing a
 * cake it has just been told to remove. The count catches deletions that leave
 * the surviving rows' timestamps untouched.
 */
export function birthdayRevision(db: Db): string {
  const row = db
    .prepare<[], { count: number; latest: number | null }>(
      'SELECT COUNT(*) AS count, MAX(updated_at) AS latest FROM birthday',
    )
    .get();
  return `${row?.count ?? 0}.${row?.latest ?? 0}`;
}
