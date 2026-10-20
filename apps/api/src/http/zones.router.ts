import type { CreateFrameRequest, CreateZoneRequest } from '@taleart/contract';
import {
  createFrame,
  createZone,
  listFrames,
  listZones,
  zoneExists,
  ZoneNotFoundError,
  type FrameTypeRegistry,
} from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requiredString } from './validation';

export function zonesRouter(pool: Pool, frameTypes: FrameTypeRegistry): Router {
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

  router.get('/:zoneId/frames', async (req, res, next) => {
    try {
      res.json(await listFrames(pool, req.params.zoneId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:zoneId/frames', async (req, res, next) => {
    try {
      // Zone first (404), then the body (400), then the registry.
      if (!(await zoneExists(pool, req.params.zoneId))) throw new ZoneNotFoundError(req.params.zoneId);
      const input: CreateFrameRequest = {
        type: requiredString(req.body, 'type'),
        // Validated against the type's JSON Schema in the zones module; a
        // missing value is treated as {} there.
        settings: (req.body as { settings?: CreateFrameRequest['settings'] } | undefined)?.settings,
      };
      res.status(201).json(await createFrame(pool, frameTypes, { zoneId: req.params.zoneId, ...input }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
