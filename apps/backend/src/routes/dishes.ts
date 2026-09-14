import { Router } from 'express';
import { dishInputSchema, dishUpdateSchema } from '@picalendar/shared';
import { getDb } from '../db/index.js';
import * as dishes from '../db/repositories/dishes.js';
import { HttpError } from '../middleware/errors.js';
import { pathParam } from '../util/http.js';

/**
 * The dish library.
 *
 * Deliberately not behind `requireAdmin`. `ADMIN_TOKEN` exists to stop a
 * passer-by editing which calendars the house subscribes to; adding a dish at
 * the fridge is the interaction this feature is *for*, and the wall display
 * holds no token. Gating it would give a household that sets a token a menu it
 * cannot plan.
 */
export const dishesRouter: Router = Router();

dishesRouter.get('/', (_req, res) => {
  res.json({ dishes: dishes.listDishes(getDb()) });
});

/**
 * Every distinct ingredient in the library, for the editor's autocomplete.
 *
 * Registered before `/:id` deliberately: Express matches in order, and the
 * parameterised route would otherwise swallow this path and look for a dish
 * called "ingredients".
 */
dishesRouter.get('/ingredients', (_req, res) => {
  res.json({ ingredients: dishes.listIngredientSuggestions(getDb()) });
});

dishesRouter.get('/:id', (req, res) => {
  const dish = dishes.getDish(getDb(), pathParam(req, 'id'));
  if (!dish) throw HttpError.notFound('Dish');
  res.json({ dish });
});

dishesRouter.post('/', (req, res) => {
  const input = dishInputSchema.parse(req.body);
  const db = getDb();

  // Checked up front rather than left to the unique index, so the response can
  // name the dish that is already there. "Gulyás is already in the library —
  // open it?" is recoverable; a bare 409 leaves the cook retyping.
  const existing = dishes.findDishByName(db, input.name);
  if (existing) {
    res.status(409).json({
      error: {
        code: 'conflict',
        message: `“${existing.name}” is already in the library`,
        details: { name: [`Already saved as “${existing.name}”`] },
      },
      dish: existing,
    });
    return;
  }

  res.status(201).json({ dish: dishes.createDish(db, input) });
});

dishesRouter.patch('/:id', (req, res) => {
  const dish = dishes.updateDish(getDb(), pathParam(req, 'id'), dishUpdateSchema.parse(req.body));
  if (!dish) throw HttpError.notFound('Dish');
  res.json({ dish });
});

/**
 * Deleting cascades to every evening the dish was planned on, so the response
 * to a `GET` carries the counts and the editor offers "retire" first. The
 * delete itself is unconditional — by the time it is called the page has
 * already said what it will take with it.
 */
dishesRouter.delete('/:id', (req, res) => {
  const db = getDb();
  const id = pathParam(req, 'id');
  const usage = dishes.dishUsage(db, id);
  if (!dishes.deleteDish(db, id)) throw HttpError.notFound('Dish');
  res.json({ removed: usage });
});
