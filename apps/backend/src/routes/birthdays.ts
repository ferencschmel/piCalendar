import { Router } from 'express';
import { birthdayInputSchema, birthdayUpdateSchema } from '@picalendar/shared';
import { getDb } from '../db/index.js';
import * as birthdays from '../db/repositories/birthdays.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { pathParam } from '../util/http.js';

export const birthdaysRouter: Router = Router();

birthdaysRouter.get('/', (_req, res) => {
  res.json({ birthdays: birthdays.listBirthdays(getDb()) });
});

birthdaysRouter.post('/', requireAdmin, (req, res) => {
  res.status(201).json({
    birthday: birthdays.createBirthday(getDb(), birthdayInputSchema.parse(req.body)),
  });
});

birthdaysRouter.patch('/:id', requireAdmin, (req, res) => {
  const birthday = birthdays.updateBirthday(
    getDb(),
    pathParam(req, 'id'),
    birthdayUpdateSchema.parse(req.body),
  );
  if (!birthday) throw HttpError.notFound('Birthday');
  res.json({ birthday });
});

birthdaysRouter.delete('/:id', requireAdmin, (req, res) => {
  if (!birthdays.deleteBirthday(getDb(), pathParam(req, 'id')))
    throw HttpError.notFound('Birthday');
  res.status(204).end();
});
