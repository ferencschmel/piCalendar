import { Router } from 'express';
import { agendaRouter } from './agenda.js';
import { birthdaysRouter } from './birthdays.js';
import { dishesRouter } from './dishes.js';
import { listsRouter } from './lists.js';
import { menuRouter } from './menu.js';
import { feedsRouter } from './feeds.js';
import { healthRouter } from './health.js';
import { peopleRouter } from './people.js';
import { presenceRouter } from './presence.js';
import { tasksRouter } from './tasks.js';

export function createApiRouter(): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use('/agenda', agendaRouter);
  router.use('/birthdays', birthdaysRouter);
  router.use('/dishes', dishesRouter);
  router.use('/lists', listsRouter);
  router.use('/menu', menuRouter);
  router.use('/feeds', feedsRouter);
  router.use('/people', peopleRouter);
  router.use('/presence', presenceRouter);
  router.use('/tasks', tasksRouter);
  return router;
}
