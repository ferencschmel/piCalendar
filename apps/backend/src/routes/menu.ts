import { Router } from 'express';
import {
  menuEntryInputSchema,
  menuEntryUpdateSchema,
  menuQuerySchema,
  wishInputSchema,
  type MenuResponse,
} from '@picalendar/shared';
import { config } from '../config/index.js';
import { getDb } from '../db/index.js';
import * as menu from '../db/repositories/menu.js';
import { HttpError } from '../middleware/errors.js';
import { entriesByDay } from '../util/menu.js';
import { pathParam } from '../util/http.js';
import { dayKeyRange, nowEpoch, toDayKey } from '../util/time.js';

/**
 * Menu planning. Open for the same reason the dish library is: this is the
 * page the wall display is most likely to be used from, and it holds no token.
 */
export const menuRouter: Router = Router();

/**
 * GET /api/menu — what is planned, bucketed by day.
 *
 * The same `start`/`days` contract the agenda takes, so the planner can ask
 * for exactly the week it draws. Unlike the agenda there is no occurrence
 * window to fall off the end of: menus are stored as civil day keys, so a
 * fortnight out is as readable as tonight.
 */
menuRouter.get('/', (req, res) => {
  const query = menuQuerySchema.parse(req.query);
  const db = getDb();
  const timezone = config.display.timezone;

  const startKey = query.start ?? toDayKey(nowEpoch(), timezone);
  const dayKeys = dayKeyRange(startKey, query.days);
  const todayKey = toDayKey(nowEpoch(), timezone);

  const buckets = entriesByDay(menu.listEntries(db, startKey, dayKeys.at(-1)!), dayKeys);

  const response: MenuResponse = {
    generatedAt: new Date().toISOString(),
    timezone,
    days: dayKeys.map((date) => ({
      date,
      isToday: date === todayKey,
      entries: buckets.get(date) ?? [],
    })),
    revision: menu.menuRevision(db),
  };

  res.set('Cache-Control', 'no-cache');
  res.json(response);
});

/**
 * Plan a dish.
 *
 * The same dish on as many *days* as a household likes is ordinary — a pot of
 * something is eaten on Monday and again on Thursday — and so is the same dish
 * at a different meal on the same day. Neither reaches the check below.
 *
 * What is left is the same dish, at the same sitting, twice: a second tap on a
 * touchscreen, or a drag released where one already sits. That is answered
 * with the entry that is already there rather than an error, because nothing
 * the person wanted is missing — the dish is planned, which is what they
 * asked for. A conflict warning would report a failure for an outcome they
 * already have.
 */
menuRouter.post('/', (req, res) => {
  const input = menuEntryInputSchema.parse(req.body);
  const db = getDb();

  const existing = menu.findEntry(db, input.dayKey, input.meal, input.dishId);
  if (existing) {
    res.json({ entry: existing, alreadyPlanned: true });
    return;
  }

  const entry = menu.createEntry(db, input);
  // The dish is the only foreign key the caller supplies, so a null here means
  // it was deleted between the page's last poll and the drop.
  if (!entry) throw HttpError.notFound('Dish');
  res.status(201).json({ entry, alreadyPlanned: false });
});

menuRouter.patch('/:id', (req, res) => {
  const entry = menu.updateEntry(
    getDb(),
    pathParam(req, 'id'),
    menuEntryUpdateSchema.parse(req.body),
  );
  if (!entry) throw HttpError.notFound('Menu entry');
  res.json({ entry });
});

menuRouter.delete('/:id', (req, res) => {
  if (!menu.deleteEntry(getDb(), pathParam(req, 'id'))) throw HttpError.notFound('Menu entry');
  res.status(204).end();
});

menuRouter.get('/wishes', (_req, res) => {
  res.json({ wishes: menu.listWishes(getDb()) });
});

/**
 * Wishing for something already wished is not a mistake worth an error — it is
 * someone tapping twice, or a second person agreeing. The existing wish comes
 * back with a 200 so the page treats it as success and shows the wishlist it
 * expected.
 */
menuRouter.post('/wishes', (req, res) => {
  const input = wishInputSchema.parse(req.body);
  const db = getDb();

  const existing = menu.findWish(db, input.dishId, input.personId);
  if (existing) {
    res.json({ wish: existing, alreadyWished: true });
    return;
  }

  const wish = menu.createWish(db, input);
  if (!wish) throw HttpError.notFound('Dish');
  res.status(201).json({ wish, alreadyWished: false });
});

menuRouter.delete('/wishes/:id', (req, res) => {
  if (!menu.deleteWish(getDb(), pathParam(req, 'id'))) throw HttpError.notFound('Wish');
  res.status(204).end();
});
