import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Person, Task, TaskBoard, TaskEarnings } from '@picalendar/shared';
import {
  addMonthsToKey,
  formatMoney,
  monthDayRange,
  monthKeyOf,
  scheduleLabel,
  TASK_OVERDUE_LOOKBACK_DAYS,
} from '@picalendar/shared';
import { closeDb, getDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createServer } from '../src/server.js';
import { occursOn, taskDays, weekdayIndex } from '../src/util/tasks.js';

let server: Server;
let base: string;

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { status: response.status, body: body as T };
}

async function addPerson(
  displayName: string,
  extra: Record<string, unknown> = {},
): Promise<Person> {
  const { body } = await call<{ person: Person }>('/people', {
    method: 'POST',
    body: JSON.stringify({ displayName, ...extra }),
  });
  return body.person;
}

async function addTask(title: string, extra: Record<string, unknown> = {}): Promise<Task> {
  const { body } = await call<{ task: Task }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, startsOn: MONDAY, ...extra }),
  });
  return body.task;
}

async function getBoard(day: string): Promise<TaskBoard> {
  const { body } = await call<{ board: TaskBoard }>(`/tasks?day=${day}`);
  return body.board;
}

async function tick(task: Task, dayKey: string, completed = true): Promise<void> {
  await call(`/tasks/${task.id}/completions`, {
    method: 'POST',
    body: JSON.stringify({ dayKey, completed }),
  });
}

async function getEarnings(month: string): Promise<TaskEarnings> {
  const { body } = await call<{ earnings: TaskEarnings }>(`/tasks/earnings?month=${month}`);
  return body.earnings;
}

/** The month `MONDAY` falls in, which is the one the earnings tests settle. */
const MARCH = '2026-03';

/** 2026-03-02 is a Monday, and the week the schedule assertions below count from. */
const MONDAY = '2026-03-02';

/** The days a bare schedule needs, so the tests read as schedules not objects. */
function schedule(over: Partial<Task['schedule']> = {}): Task['schedule'] {
  return { frequency: 'once', interval: 1, weekdays: [], startsOn: MONDAY, endsOn: null, ...over };
}

beforeAll(async () => {
  runMigrations(getDb());
  server = createServer().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
});

beforeEach(() => {
  getDb().exec('DELETE FROM task; DELETE FROM person;');
});

describe('weekdayIndex', () => {
  it('numbers the week from Monday, matching the month and year grids', () => {
    expect(weekdayIndex('2026-03-02')).toBe(0);
    expect(weekdayIndex('2026-03-06')).toBe(4);
    expect(weekdayIndex('2026-03-08')).toBe(6);
  });
});

describe('occursOn', () => {
  it('gives a one-off exactly its own day', () => {
    const once = schedule();
    expect(occursOn(once, MONDAY)).toBe(true);
    expect(occursOn(once, '2026-03-03')).toBe(false);
    expect(occursOn(once, '2026-03-09')).toBe(false);
  });

  it('puts a weekly task on each of its days, every week', () => {
    // Monday and Thursday.
    const weekly = schedule({ frequency: 'weekly', weekdays: [0, 3] });
    expect(taskDays(weekly, MONDAY, '2026-03-15')).toEqual([
      '2026-03-02',
      '2026-03-05',
      '2026-03-09',
      '2026-03-12',
    ]);
  });

  it('counts an every-other-week interval between Mondays, not between dates', () => {
    // Anchored on a Wednesday, running on Mondays: the Monday two days *before*
    // the anchor is in the anchor's own week, so the first Monday it produces is
    // the one a fortnight after it — not the one a week after.
    const fortnightly = schedule({
      frequency: 'weekly',
      interval: 2,
      weekdays: [0],
      startsOn: '2026-03-04',
    });
    expect(taskDays(fortnightly, '2026-03-04', '2026-04-05')).toEqual(['2026-03-16', '2026-03-30']);
  });

  it('takes a monthly task’s date from its anchor', () => {
    const monthly = schedule({ frequency: 'monthly', startsOn: '2026-03-05' });
    expect(taskDays(monthly, '2026-03-01', '2026-06-30')).toEqual([
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
    ]);
  });

  it('clamps a month-end task into a short month rather than skipping it', () => {
    // The 31st still has to happen in February, and in April. Losing the chore
    // in the months that have no 31st is the alternative, and it is worse.
    const monthly = schedule({ frequency: 'monthly', startsOn: '2026-01-31' });
    expect(taskDays(monthly, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('honours an every-other-month interval', () => {
    const monthly = schedule({ frequency: 'monthly', interval: 2, startsOn: '2026-03-10' });
    expect(taskDays(monthly, '2026-03-01', '2026-08-31')).toEqual([
      '2026-03-10',
      '2026-05-10',
      '2026-07-10',
    ]);
  });

  it('produces nothing before it starts or after it ends', () => {
    const term = schedule({
      frequency: 'weekly',
      weekdays: [0],
      startsOn: '2026-03-09',
      endsOn: '2026-03-23',
    });
    expect(taskDays(term, '2026-02-01', '2026-04-30')).toEqual([
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
    ]);
  });
});

describe('scheduleLabel', () => {
  it('says how often in words a household would use', () => {
    expect(scheduleLabel(schedule())).toBe('One-off');
    expect(scheduleLabel(schedule({ frequency: 'weekly', weekdays: [0, 3] }))).toBe(
      'Every Mon & Thu',
    );
    expect(scheduleLabel(schedule({ frequency: 'weekly', interval: 2, weekdays: [4] }))).toBe(
      'Every other week on Fri',
    );
    expect(scheduleLabel(schedule({ frequency: 'monthly', startsOn: '2026-03-23' }))).toBe(
      'Every month on the 23rd',
    );
  });

  it('names the two sets a household has a word for', () => {
    // "Mon & Tue & Wed & Thu & Fri & Sat & Sun" is a list where "day" is the
    // word, and a schedule nobody reads at a glance is one nobody checks.
    expect(scheduleLabel(schedule({ frequency: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }))).toBe(
      'Every day',
    );
    expect(scheduleLabel(schedule({ frequency: 'weekly', weekdays: [0, 1, 2, 3, 4] }))).toBe(
      'Every weekday',
    );
    // Three or more joined only by "&" reads as one long word.
    expect(scheduleLabel(schedule({ frequency: 'weekly', weekdays: [0, 2, 4] }))).toBe(
      'Every Mon, Wed & Fri',
    );
  });
});

describe('the board', () => {
  it('gives every active person a column, in the order people are listed', async () => {
    await addPerson('Anna');
    await addPerson('Béla');
    await addPerson('Csilla', { active: false });

    const board = await getBoard(MONDAY);
    expect(board.columns.map((column) => column.displayName)).toEqual(['Anna', 'Béla']);
    expect(board.columns[0]?.due).toEqual([]);
    expect(board.outstanding).toBe(0);
  });

  it('puts each task in its person’s column, in daypart order', async () => {
    const anna = await addPerson('Anna');
    await addTask('Walk the dog', { personId: anna.id, daypart: 'afternoon' });
    await addTask('Empty the dishwasher', { personId: anna.id, daypart: 'morning' });

    const [column] = (await getBoard(MONDAY)).columns;
    expect(column?.due.map((task) => task.title)).toEqual(['Empty the dishwasher', 'Walk the dog']);
    expect(column?.outstanding).toBe(2);
  });

  it('gives unassigned chores a column of their own, last, and only when it has any', async () => {
    await addPerson('Anna');
    expect((await getBoard(MONDAY)).columns).toHaveLength(1);

    await addTask('Bins out');
    const board = await getBoard(MONDAY);
    expect(board.columns.map((column) => column.displayName)).toEqual(['Anna', 'Anyone']);
    expect(board.columns[1]?.personId).toBeNull();
  });

  it('keeps a column for a person who was retired while still holding work', async () => {
    const anna = await addPerson('Anna');
    await addTask('Hand the locker key back', { personId: anna.id });
    await call(`/people/${anna.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });

    const board = await getBoard(MONDAY);
    expect(board.columns.map((column) => column.displayName)).toEqual(['Anna']);
    expect(board.columns[0]?.due).toHaveLength(1);
  });
});

describe('overdue', () => {
  it('carries unticked days forward, oldest first, and stops at the lookback', async () => {
    const anna = await addPerson('Anna');
    await addTask('Bins out', {
      personId: anna.id,
      frequency: 'weekly',
      weekdays: [0],
      startsOn: '2026-01-05',
    });

    // Four Mondays back from this one; the lookback is a fortnight, so only the
    // two most recent are still asked about — and they are one bin, so they
    // reach the column as one card carrying the count.
    const board = await getBoard('2026-03-30');
    const [column] = board.columns;
    expect(column?.overdue).toHaveLength(1);
    expect(column?.overdue[0]?.dayKey).toBe('2026-03-23');
    expect(column?.overdue[0]?.missedCount).toBe(2);
    expect(column?.overdue[0]?.missedSince).toBe('2026-03-16');
    expect(board.overdueFrom).toBe('2026-03-16');
    expect(board.overdueCount).toBe(1);
    // The day itself is a Monday too, so it is due rather than overdue.
    expect(column?.due.map((task) => task.dayKey)).toEqual(['2026-03-30']);
    expect(column?.outstanding).toBe(2);
  });

  it('collapses a chore missed many times into one card that counts them', async () => {
    const anna = await addPerson('Anna');
    await addTask('Empty the dishwasher', {
      personId: anna.id,
      frequency: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsOn: '2026-03-01',
    });

    // A daily chore nobody has touched for a fortnight. Fourteen identical
    // cards would push the day's own work off the bottom of a screen nobody
    // can scroll, and "14 left" is not a number anybody can act on: it is one
    // dishwasher.
    const [column] = (await getBoard('2026-03-30')).columns;
    expect(column?.overdue).toHaveLength(1);
    expect(column?.overdue[0]?.missedCount).toBe(TASK_OVERDUE_LOOKBACK_DAYS);
    expect(column?.overdue[0]?.missedSince).toBe('2026-03-16');
    // The card is the most recent miss, so ticking it settles the rest.
    expect(column?.overdue[0]?.dayKey).toBe('2026-03-29');
    expect(column?.outstanding).toBe(2);
  });

  it('clears the backlog when the chore is actually done', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Empty the dishwasher', {
      personId: anna.id,
      frequency: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsOn: '2026-03-01',
    });

    // Nobody takes out Tuesday's bins on Thursday; they take out the bins. So
    // ticking the pile has to settle it, not hand back the next day down.
    await call(`/tasks/${task.id}/completions`, {
      method: 'POST',
      body: JSON.stringify({ dayKey: '2026-03-29', completed: true }),
    });

    const [column] = (await getBoard('2026-03-30')).columns;
    expect(column?.overdue).toEqual([]);
    expect(column?.outstanding).toBe(1);
  });

  it('counts only the misses since the chore was last done', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Empty the dishwasher', {
      personId: anna.id,
      frequency: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsOn: '2026-03-01',
    });
    await call(`/tasks/${task.id}/completions`, {
      method: 'POST',
      body: JSON.stringify({ dayKey: '2026-03-27', completed: true }),
    });

    const [column] = (await getBoard('2026-03-30')).columns;
    expect(column?.overdue[0]?.missedCount).toBe(2);
    expect(column?.overdue[0]?.missedSince).toBe('2026-03-28');
  });

  it('leaves a one-off overdue card standing for exactly its own day', async () => {
    const anna = await addPerson('Anna');
    await addTask('Hand the form in', { personId: anna.id, startsOn: '2026-03-25' });

    const [column] = (await getBoard('2026-03-30')).columns;
    expect(column?.overdue[0]?.missedCount).toBe(1);
    expect(column?.overdue[0]?.dayKey).toBe('2026-03-25');
    expect(column?.overdue[0]?.missedSince).toBe('2026-03-25');
  });

  it('reports the day it looked back to, so an empty pile is not mistaken for a clean one', async () => {
    const board = await getBoard(MONDAY);
    expect(board.overdueFrom).toBe('2026-02-16');
    expect(new Date(`${board.day}T00:00:00Z`).getTime()).toBeGreaterThan(
      new Date(`${board.overdueFrom}T00:00:00Z`).getTime(),
    );
    // The constant the client uses to explain the window and the window the
    // server actually used have to be the same number.
    const span =
      (Date.parse(`${board.day}T00:00:00Z`) - Date.parse(`${board.overdueFrom}T00:00:00Z`)) /
      86_400_000;
    expect(span).toBe(TASK_OVERDUE_LOOKBACK_DAYS);
  });
});

describe('ticking a task off', () => {
  it('records the day it was done and clears it from the column', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Bins out', { personId: anna.id });

    const { status, body } = await call<{ board: TaskBoard }>(
      `/tasks/${task.id}/completions?day=${MONDAY}`,
      { method: 'POST', body: JSON.stringify({ dayKey: MONDAY, completed: true }) },
    );

    expect(status).toBe(200);
    const [column] = body.board.columns;
    expect(column?.due[0]?.completed).toBe(true);
    expect(column?.due[0]?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(column?.outstanding).toBe(0);
    expect(column?.doneToday).toBe(1);
  });

  it('ticks one occurrence of a recurring task, not the series', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Bins out', {
      personId: anna.id,
      frequency: 'weekly',
      weekdays: [0],
    });

    await call(`/tasks/${task.id}/completions`, {
      method: 'POST',
      body: JSON.stringify({ dayKey: MONDAY, completed: true }),
    });

    // This Monday is done; the next one is a different chore entirely.
    expect((await getBoard(MONDAY)).columns[0]?.due[0]?.completed).toBe(true);
    const next = await getBoard('2026-03-09');
    expect(next.columns[0]?.due[0]?.completed).toBe(false);
    // And the ticked Monday does not reappear in the overdue pile.
    expect(next.columns[0]?.overdue).toEqual([]);
  });

  it('takes a tick back', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Bins out', { personId: anna.id });
    const body = JSON.stringify({ dayKey: MONDAY, completed: true });

    await call(`/tasks/${task.id}/completions`, { method: 'POST', body });
    const { body: back } = await call<{ board: TaskBoard }>(
      `/tasks/${task.id}/completions?day=${MONDAY}`,
      { method: 'POST', body: JSON.stringify({ dayKey: MONDAY, completed: false }) },
    );
    expect(back.board.columns[0]?.due[0]?.completed).toBe(false);
  });

  it('keeps the first time when the same day is ticked twice', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Bins out', { personId: anna.id });
    const body = JSON.stringify({ dayKey: MONDAY, completed: true });

    const { body: first } = await call<{ board: TaskBoard }>(
      `/tasks/${task.id}/completions?day=${MONDAY}`,
      { method: 'POST', body },
    );
    const { body: second } = await call<{ board: TaskBoard }>(
      `/tasks/${task.id}/completions?day=${MONDAY}`,
      { method: 'POST', body },
    );

    // Nothing was done twice, so the answer to "when was it done" must not move.
    expect(second.board.columns[0]?.due[0]?.completedAt).toBe(
      first.board.columns[0]?.due[0]?.completedAt,
    );
  });

  it('refuses a day the task does not fall on', async () => {
    const task = await addTask('Bins out', { frequency: 'weekly', weekdays: [0] });
    const { status } = await call(`/tasks/${task.id}/completions`, {
      method: 'POST',
      // A Tuesday, for a Monday chore.
      body: JSON.stringify({ dayKey: '2026-03-03', completed: true }),
    });
    expect(status).toBe(404);
  });
});

describe('what a chore is worth', () => {
  it('costs nothing by default, so a household that does not pay never sees it', async () => {
    const task = await addTask('Bins out');
    expect(task.amountCents).toBe(0);

    const anna = await addPerson('Anna');
    await call(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ personId: anna.id }),
    });
    await tick(task, MONDAY);

    const earnings = await getEarnings(MARCH);
    expect(earnings.totalCents).toBe(0);
    expect(earnings.people[0]?.completions).toBe(1);
  });

  it('refuses an amount that is not a whole number of cents, or is negative', async () => {
    for (const amountCents of [-50, 12.5, 100_001]) {
      const { status } = await call('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: 'Bins out', startsOn: MONDAY, amountCents }),
      });
      expect(status).toBe(422);
    }
  });

  it('sums a month per person, and says what it was made of', async () => {
    const anna = await addPerson('Anna');
    const ben = await addPerson('Ben');
    const bins = await addTask('Bins out', { personId: anna.id, amountCents: 50 });
    const dishes = await addTask('Dishwasher', { personId: anna.id, amountCents: 25 });
    const walk = await addTask('Walk the dog', { personId: ben.id, amountCents: 100 });

    await tick(bins, MONDAY);
    await tick(dishes, MONDAY);
    await tick(walk, MONDAY);

    const earnings = await getEarnings(MARCH);
    expect(earnings.totalCents).toBe(175);
    expect(earnings.completions).toBe(3);

    const [first, second] = earnings.people;
    expect(first?.displayName).toBe('Anna');
    expect(first?.totalCents).toBe(75);
    // Biggest earner first, because that is the line somebody checks.
    expect(first?.tasks.map((line) => line.title)).toEqual(['Bins out', 'Dishwasher']);
    expect(second?.totalCents).toBe(100);
  });

  it('counts every day of a recurring chore separately', async () => {
    const anna = await addPerson('Anna');
    const bins = await addTask('Bins out', {
      personId: anna.id,
      amountCents: 50,
      frequency: 'weekly',
      weekdays: [0],
      startsOn: '2026-03-02',
    });

    for (const day of ['2026-03-02', '2026-03-09', '2026-03-16']) await tick(bins, day);

    const earnings = await getEarnings(MARCH);
    expect(earnings.people[0]?.tasks[0]?.completions).toBe(3);
    expect(earnings.people[0]?.totalCents).toBe(150);
  });

  it('pays an overdue card once however many days it stands for', async () => {
    const anna = await addPerson('Anna');
    const daily = await addTask('Dishwasher', {
      personId: anna.id,
      amountCents: 50,
      frequency: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsOn: '2026-03-02',
    });

    // Four days go by untouched, then the pile is ticked on the fifth.
    const board = await getBoard('2026-03-06');
    const card = board.columns[0]?.overdue[0];
    expect(card?.missedCount).toBe(4);
    await tick(daily, card!.dayKey);

    // Nobody empties Tuesday's dishwasher on Friday; they empty the dishwasher.
    const earnings = await getEarnings(MARCH);
    expect(earnings.people[0]?.tasks[0]?.completions).toBe(1);
    expect(earnings.totalCents).toBe(50);
  });

  it('leaves a settled month alone when the price goes up', async () => {
    const anna = await addPerson('Anna');
    const bins = await addTask('Bins out', { personId: anna.id, amountCents: 50 });
    await tick(bins, MONDAY);

    await call(`/tasks/${bins.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amountCents: 100 }),
    });

    // The tick carries the price it was made at. A raise today is not backpay.
    expect((await getEarnings(MARCH)).totalCents).toBe(50);
  });

  it('charges the new price to ticks made after the raise', async () => {
    const anna = await addPerson('Anna');
    const bins = await addTask('Bins out', {
      personId: anna.id,
      amountCents: 50,
      frequency: 'weekly',
      weekdays: [0],
    });
    await tick(bins, '2026-03-02');

    await call(`/tasks/${bins.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amountCents: 100 }),
    });
    await tick(bins, '2026-03-09');

    expect((await getEarnings(MARCH)).totalCents).toBe(150);
  });

  it('leaves a settled month alone when the chore changes hands', async () => {
    const anna = await addPerson('Anna');
    const ben = await addPerson('Ben');
    const bins = await addTask('Bins out', { personId: anna.id, amountCents: 50 });
    await tick(bins, MONDAY);

    await call(`/tasks/${bins.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ personId: ben.id }),
    });

    const earnings = await getEarnings(MARCH);
    const named = (name: string): number =>
      earnings.people.find((person) => person.displayName === name)?.totalCents ?? -1;
    // Handing over the bins does not hand over the month somebody else did them.
    expect(named('Anna')).toBe(50);
    expect(named('Ben')).toBe(0);
  });

  it('takes the money back with the tick, and re-prices a re-tick', async () => {
    const anna = await addPerson('Anna');
    const bins = await addTask('Bins out', { personId: anna.id, amountCents: 50 });

    await tick(bins, MONDAY);
    await tick(bins, MONDAY, false);
    expect((await getEarnings(MARCH)).totalCents).toBe(0);

    await call(`/tasks/${bins.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amountCents: 100 }),
    });
    await tick(bins, MONDAY);
    // The tick was taken back, so what comes back is a new one at today's price.
    expect((await getEarnings(MARCH)).totalCents).toBe(100);
  });

  it('keeps the first price when the same day is ticked twice', async () => {
    const anna = await addPerson('Anna');
    const bins = await addTask('Bins out', { personId: anna.id, amountCents: 50 });

    await tick(bins, MONDAY);
    await call(`/tasks/${bins.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amountCents: 100 }),
    });
    // Nothing was done twice, so nothing may be re-priced by a second tap.
    await tick(bins, MONDAY);

    expect((await getEarnings(MARCH)).totalCents).toBe(50);
  });

  it('gives everyone a card, so a blank month reads as nothing yet', async () => {
    await addPerson('Anna');
    await addPerson('Ben');

    const earnings = await getEarnings(MARCH);
    expect(earnings.people.map((person) => person.displayName)).toEqual(['Anna', 'Ben']);
    expect(earnings.people.every((person) => person.totalCents === 0)).toBe(true);
    expect(earnings.totalCents).toBe(0);
  });

  it('keeps what a departed person earned, without their name on it', async () => {
    const anna = await addPerson('Anna');
    const bins = await addTask('Bins out', { personId: anna.id, amountCents: 50 });
    await tick(bins, MONDAY);
    await call(`/people/${anna.id}`, { method: 'DELETE' });

    // The money is still recorded; it simply falls in with the unassigned work,
    // exactly as the chore itself does.
    const earnings = await getEarnings(MARCH);
    expect(earnings.people.map((person) => person.displayName)).toEqual(['Anyone']);
    expect(earnings.totalCents).toBe(50);
  });

  it('rejects a month that is not one', async () => {
    const { status } = await call('/tasks/earnings?month=2026-3');
    expect(status).toBe(422);
  });

  it('defaults to the month the display is in', async () => {
    const { body } = await call<{ earnings: TaskEarnings }>('/tasks/earnings');
    expect(body.earnings.month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('editing tasks', () => {
  it('drops weekdays a task no longer has a use for', async () => {
    const task = await addTask('Bins out', { frequency: 'weekly', weekdays: [0, 3] });
    const { body } = await call<{ task: Task }>(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ frequency: 'once' }),
    });
    expect(body.task.schedule.weekdays).toEqual([]);
  });

  it('rejects a merged schedule that contradicts itself', async () => {
    const task = await addTask('Bins out', { frequency: 'weekly', weekdays: [0] });

    // The patch alone looks fine; it is only wrong beside the task it patches.
    const { status, body } = await call<{ error: { details: Record<string, string[]> } }>(
      `/tasks/${task.id}`,
      { method: 'PATCH', body: JSON.stringify({ weekdays: [] }) },
    );
    expect(status).toBe(422);
    expect(body.error.details.weekdays).toBeDefined();
  });

  it('rejects a weekly task with no day at all', async () => {
    const { status } = await call('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Bins out', startsOn: MONDAY, frequency: 'weekly' }),
    });
    expect(status).toBe(422);
  });

  it('keeps a retired task off the board without erasing what was done', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Bins out', { personId: anna.id });
    await call(`/tasks/${task.id}/completions`, {
      method: 'POST',
      body: JSON.stringify({ dayKey: MONDAY, completed: true }),
    });
    await call(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });

    expect((await getBoard(MONDAY)).columns[0]?.due).toEqual([]);
    const { body } = await call<{ lastCompletedOn: string | null }>(
      `/tasks/definitions/${task.id}`,
    );
    expect(body.lastCompletedOn).toBe(MONDAY);
  });

  it('leaves a chore in front of the household when its person leaves', async () => {
    const anna = await addPerson('Anna');
    await addTask('Bins out', { personId: anna.id });
    await call(`/people/${anna.id}`, { method: 'DELETE' });

    // Somebody moving out does not mean the bins stop needing to go out.
    const board = await getBoard(MONDAY);
    expect(board.columns.map((column) => column.displayName)).toEqual(['Anyone']);
    expect(board.columns[0]?.due[0]?.title).toBe('Bins out');
  });
});

/**
 * Tasks name days, never instants, so nothing in this file may move when the
 * host clock does.
 *
 * Every date on a task — the anchor, the end, the day it is due, the day it was
 * ticked for — is a `YYYY-MM-DD` key on both sides of every comparison, and
 * these assertions hold identically under all four zones CI runs the suite in.
 * A change that makes any of them pass only in some is a bug: it means a key
 * has been pushed back through a timezone conversion somewhere, which is what
 * moves a Thursday chore to Wednesday in a zone past UTC+12.
 */
describe('day keys never pass through a timezone', () => {
  it('derives the same days whatever the host clock is set to', () => {
    const weekly = schedule({ frequency: 'weekly', weekdays: [3] });
    expect(taskDays(weekly, MONDAY, '2026-03-15')).toEqual(['2026-03-05', '2026-03-12']);
  });

  it('bounds a month by its own first and last day, whatever the host clock is', async () => {
    const anna = await addPerson('Anna');
    const daily = await addTask('Dishwasher', {
      personId: anna.id,
      amountCents: 50,
      frequency: 'weekly',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      startsOn: '2026-02-01',
    });

    // The two days either side of March, and the two days inside it. In a zone
    // past UTC+12 a month derived by conversion would pull the 28th of February
    // in or push the 31st of March out.
    for (const day of ['2026-02-28', '2026-03-01', '2026-03-31', '2026-04-01']) {
      await tick(daily, day);
    }

    expect((await getEarnings(MARCH)).totalCents).toBe(100);
    expect((await getEarnings('2026-02')).totalCents).toBe(50);
    expect((await getEarnings('2026-04')).totalCents).toBe(50);
  });

  it('holds a task to the day it was created for, and ticks it on that day', async () => {
    const anna = await addPerson('Anna');
    const task = await addTask('Bins out', { personId: anna.id, startsOn: '2026-03-08' });

    const board = await getBoard('2026-03-08');
    expect(board.columns[0]?.due[0]?.dayKey).toBe('2026-03-08');

    const { body } = await call<{ board: TaskBoard }>(
      `/tasks/${task.id}/completions?day=2026-03-08`,
      { method: 'POST', body: JSON.stringify({ dayKey: '2026-03-08', completed: true }) },
    );
    expect(body.board.columns[0]?.due[0]?.completed).toBe(true);

    // The row went in under the day it was due, not under the host's today.
    const stored = getDb()
      .prepare('SELECT day_key FROM task_completion WHERE task_id = ?')
      .get(task.id) as { day_key: string };
    expect(stored.day_key).toBe('2026-03-08');
  });
});

/**
 * A month is a civil date in exactly the way a day is, and the same rule
 * applies: `YYYY-MM` is a prefix of a day key, and neither end of it may ever be
 * derived by converting an instant. These hold identically under all four zones
 * CI runs the suite in.
 */
describe('month keys', () => {
  it('reads a month straight off a day key', () => {
    expect(monthKeyOf('2026-03-31')).toBe('2026-03');
    expect(monthKeyOf('2026-01-01')).toBe('2026-01');
  });

  it('bounds a month by its own last day, leap years included', () => {
    expect(monthDayRange('2026-03')).toEqual({ start: '2026-03-01', end: '2026-03-31' });
    expect(monthDayRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthDayRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthDayRange('2026-04')).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('steps across the turn of the year in both directions', () => {
    expect(addMonthsToKey('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToKey('2026-01', -1)).toBe('2025-12');
    expect(addMonthsToKey('2026-03', -14)).toBe('2025-01');
    expect(addMonthsToKey('2026-03', 22)).toBe('2028-01');
  });
});

describe('formatMoney', () => {
  it('drops the pence when there are none, and keeps both digits when there are', () => {
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(200)).toBe('$2');
    expect(formatMoney(250)).toBe('$2.50');
    // Never `$2.5`: a column of amounts has to line up.
    expect(formatMoney(205)).toBe('$2.05');
    expect(formatMoney(50)).toBe('$0.50');
  });
});
