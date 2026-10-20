import type { CreateProjectRequest } from '@taleart/contract';
import { createProject, listProjects } from '@taleart/server-access';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requiredString } from './validation';

export function projectsRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await listProjects(pool));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const input: CreateProjectRequest = { name: requiredString(req.body, 'name') };
      res.status(201).json(await createProject(pool, input));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
