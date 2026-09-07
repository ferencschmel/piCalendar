import { Router } from 'express';
import { agendaRouter } from './agenda.js';
import { birthdaysRouter } from './birthdays.js';
import { feedsRouter } from './feeds.js';
import { healthRouter } from './health.js';
import { peopleRouter } from './people.js';
import { presenceRouter } from './presence.js';

export function createApiRouter(): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use('/agenda', agendaRouter);
  router.use('/birthdays', birthdaysRouter);
  router.use('/feeds', feedsRouter);
  router.use('/people', peopleRouter);
  router.use('/presence', presenceRouter);
  return router;
}
