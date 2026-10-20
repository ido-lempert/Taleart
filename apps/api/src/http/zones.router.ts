import type { CreateZoneRequest } from '@taleart/contract';
import { createZone, listZones } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requiredString } from './validation';

export function zonesRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await listZones(pool));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const input: CreateZoneRequest = {
        name: requiredString(req.body, 'name'),
        projectId: requiredString(req.body, 'projectId'),
      };
      res.status(201).json(await createZone(pool, input));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
