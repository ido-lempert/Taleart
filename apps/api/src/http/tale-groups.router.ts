import type { CreateTaleGroupRequest, CreateTaleRequest } from '@taleart/contract';
import {
  createTale,
  createTaleGroup,
  listTaleGroups,
  taleGroupExists,
  TaleGroupNotFoundError,
} from '@taleart/server-tales';
import { zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { requiredString } from './validation';

/** Tale groups under a zone: mounted at `/zones`. */
export function zoneTaleGroupsRouter(pool: Pool): Router {
  const router = Router();

  router.get('/:zoneId/tale-groups', async (req, res, next) => {
    try {
      res.json(await listTaleGroups(pool, req.params.zoneId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:zoneId/tale-groups', async (req, res, next) => {
    try {
      // Zone first (404), then the body (400).
      if (!(await zoneExists(pool, req.params.zoneId))) throw new ZoneNotFoundError(req.params.zoneId);
      const input: CreateTaleGroupRequest = { name: requiredString(req.body, 'name') };
      res.status(201).json(await createTaleGroup(pool, { zoneId: req.params.zoneId, ...input }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Tales in a tale group: mounted at `/tale-groups`. */
export function taleGroupsRouter(pool: Pool): Router {
  const router = Router();

  router.post('/:taleGroupId/tales', async (req, res, next) => {
    try {
      // Tale group first (404), then the body (400), then the group limit (409).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: CreateTaleRequest = { title: requiredString(req.body, 'title') };
      res.status(201).json(await createTale(pool, { taleGroupId, ...input }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
