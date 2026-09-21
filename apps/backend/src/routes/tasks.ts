import { Router } from 'express';
import { z } from 'zod';
import {
  dayKeySchema,
  taskCompletionSchema,
  taskInputSchema,
  taskUpdateSchema,
  TASK_OVERDUE_LOOKBACK_DAYS,
  type TaskBoard,
} from '@picalendar/shared';
import { config } from '../config/index.js';
import { getDb } from '../db/index.js';
import * as people from '../db/repositories/people.js';
import * as tasks from '../db/repositories/tasks.js';
import { TaskScheduleError } from '../db/repositories/tasks.js';
import { HttpError } from '../middleware/errors.js';
import { pathParam } from '../util/http.js';
import { buildTaskColumns, occursOn } from '../util/tasks.js';
import { addDaysToKey, nowEpoch, toDayKey } from '../util/time.js';

/**
 * Chores, and who they belong to.
 *
 * Open, like the menu and the lists. `ADMIN_TOKEN` exists to stop a passer-by
 * changing which calendars the house subscribes to; ticking off the bins is
 * what this feature is *for*, and the point of a wall display is that anybody
 * walking past can use it without signing in.
 */
export const tasksRouter: Router = Router();

const boardQuerySchema = z.object({
  /** Defaults to today in `DISPLAY_TIMEZONE`, which is what the wall wants. */
  day: dayKeySchema.optional(),
});

/**
 * The board for a day: a column per person, holding that day's chores and
 * whatever nobody did before it.
 *
 * The lookback is bounded — see `TASK_OVERDUE_LOOKBACK_DAYS` — and the window
 * it used comes back on the response as `overdueFrom`, so a client can tell
 * "nothing is overdue" from "nothing we still ask about". That is the same
 * distinction the density endpoint's coverage window preserves, and for the
 * same reason: on an unattended display, absent data must never be drawn as
 * good news.
 */
function board(day: string): TaskBoard {
  const db = getDb();
  const overdueFrom = addDaysToKey(day, -TASK_OVERDUE_LOOKBACK_DAYS);

  // One window covering the overdue span and the day itself, so the tasks and
  // the ticks behind the whole board are two queries rather than two per day.
  const inWindow = tasks.tasksInWindow(db, overdueFrom, day);
  const completions = tasks.completionsInWindow(db, overdueFrom, day);
  const columns = buildTaskColumns(inWindow, people.listPeople(db), completions, day, overdueFrom);

  return {
    generatedAt: new Date().toISOString(),
    timezone: config.display.timezone,
    day,
    overdueFrom,
    columns,
    outstanding: columns.reduce((total, column) => total + column.outstanding, 0),
    overdueCount: columns.reduce((total, column) => total + column.overdue.length, 0),
  };
}

function today(): string {
  return toDayKey(nowEpoch(), config.display.timezone);
}

tasksRouter.get('/', (req, res) => {
  const query = boardQuerySchema.parse(req.query);
  res.set('Cache-Control', 'no-cache');
  res.json({ board: board(query.day ?? today()) });
});

/**
 * The task definitions themselves, for the editor.
 *
 * Registered before `/:id` deliberately: Express matches in order, and the
 * parameterised route below would otherwise swallow this path and go looking
 * for a task whose id is the word "definitions".
 */
tasksRouter.get('/definitions', (_req, res) => {
  res.json({ tasks: tasks.listTasks(getDb()) });
});

tasksRouter.get('/definitions/:id', (req, res) => {
  const db = getDb();
  const id = pathParam(req, 'id');
  const task = tasks.getTask(db, id);
  if (!task) throw HttpError.notFound('Task');
  res.json({ task, lastCompletedOn: tasks.lastCompletedOn(db, id) });
});

tasksRouter.post('/', (req, res) => {
  res.status(201).json({ task: tasks.createTask(getDb(), taskInputSchema.parse(req.body)) });
});

tasksRouter.patch('/:id', (req, res) => {
  const patch = taskUpdateSchema.parse(req.body);
  try {
    const task = tasks.updateTask(getDb(), pathParam(req, 'id'), patch);
    if (!task) throw HttpError.notFound('Task');
    res.json({ task });
  } catch (caught) {
    // A patch is only contradictory once it is merged with the task it patches,
    // so the schema cannot catch these — but they are the same kind of mistake
    // and deserve the same 422 with the same field named.
    if (caught instanceof TaskScheduleError) {
      res.status(422).json({
        error: {
          code: 'validation_failed',
          message: 'Request validation failed',
          details: { [caught.field]: [caught.message] },
        },
      });
      return;
    }
    throw caught;
  }
});

tasksRouter.delete('/:id', (req, res) => {
  if (!tasks.deleteTask(getDb(), pathParam(req, 'id'))) throw HttpError.notFound('Task');
  res.status(204).end();
});

/**
 * Tick a task off for a day, and get the board back.
 *
 * The day is part of the request rather than assumed to be today, because the
 * thing being ticked is often *not* today — the overdue pile is the reason the
 * board exists, and a tick on Tuesday's bins has to land on Tuesday or it
 * leaves that row sitting there while inventing a completion for now.
 *
 * A day the task does not actually fall on is a 404. Storing it would leave a
 * completion that no derivation ever reads back, which is a row that quietly
 * means nothing — and on the client it would read as a tick that did not take.
 *
 * The refreshed board comes back with the tick so a tap is one round trip, the
 * same bargain the grocery list makes.
 */
tasksRouter.post('/:id/completions', (req, res) => {
  const input = taskCompletionSchema.parse(req.body);
  const db = getDb();
  const id = pathParam(req, 'id');

  const task = tasks.getTask(db, id);
  if (!task) throw HttpError.notFound('Task');
  if (!occursOn(task.schedule, input.dayKey)) {
    throw HttpError.notFound(`Task on ${input.dayKey}`);
  }

  tasks.setTaskCompletion(db, id, input.dayKey, input.completed);

  const query = boardQuerySchema.parse(req.query);
  res.json({ board: board(query.day ?? today()) });
});
