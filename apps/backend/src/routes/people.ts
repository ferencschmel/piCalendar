import { Router } from 'express';
import { personInputSchema, personUpdateSchema } from '@picalendar/shared';
import { getDb } from '../db/index.js';
import * as people from '../db/repositories/people.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { pathParam } from '../util/http.js';

export const peopleRouter: Router = Router();

peopleRouter.get('/', (_req, res) => {
  res.json({ people: people.listPeople(getDb()) });
});

peopleRouter.post('/', requireAdmin, (req, res) => {
  res.status(201).json({ person: people.createPerson(getDb(), personInputSchema.parse(req.body)) });
});

peopleRouter.patch('/:id', requireAdmin, (req, res) => {
  const person = people.updatePerson(
    getDb(),
    pathParam(req, 'id'),
    personUpdateSchema.parse(req.body),
  );
  if (!person) throw HttpError.notFound('Person');
  res.json({ person });
});

peopleRouter.delete('/:id', requireAdmin, (req, res) => {
  if (!people.deletePerson(getDb(), pathParam(req, 'id'))) throw HttpError.notFound('Person');
  res.status(204).end();
});
