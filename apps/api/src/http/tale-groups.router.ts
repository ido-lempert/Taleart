import type {
  CreateTaleGroupRequest,
  CreateTaleRequest,
  OrderTaleGroupsRequest,
  OrderTalesRequest,
} from '@taleart/contract';
import {
  createTale,
  createTaleGroup,
  listTaleGroups,
  orderTaleGroups,
  orderTales,
  taleGroupExists,
  TaleGroupNotFoundError,
} from '@taleart/server-tales';
import { zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { requiredString, requiredStringArray } from './validation';

/** Tale groups under a zone: mounted at `/zones`. */
export function zoneTaleGroupsRouter(pool: Pool): Router {
  const router = Router();
  const zoneAccess = authorizeParam(pool, 'zone', 'zoneId');

  router.get('/:zoneId/tale-groups', zoneAccess, async (req, res, next) => {
    try {
      res.json(await listTaleGroups(pool, req.params.zoneId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:zoneId/tale-groups', zoneAccess, async (req, res, next) => {
    try {
      // Zone first (404), then the body (400).
      if (!(await zoneExists(pool, req.params.zoneId))) throw new ZoneNotFoundError(req.params.zoneId);
      const input: CreateTaleGroupRequest = { name: requiredString(req.body, 'name') };
      res.status(201).json(await createTaleGroup(pool, { zoneId: req.params.zoneId, ...input }));
    } catch (err) {
      next(err);
    }
  });

  router.put('/:zoneId/tale-groups/order', zoneAccess, async (req, res, next) => {
    try {
      // Zone first (404), then the body (400), then the id list (409 order_mismatch).
      const { zoneId } = req.params;
      if (!(await zoneExists(pool, zoneId))) throw new ZoneNotFoundError(zoneId);
      const input: OrderTaleGroupsRequest = { taleGroupIds: requiredStringArray(req.body, 'taleGroupIds') };
      res.json(await orderTaleGroups(pool, zoneId, input.taleGroupIds));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Tales in a tale group: mounted at `/tale-groups`. */
export function taleGroupsRouter(pool: Pool): Router {
  const router = Router();
  const groupAccess = authorizeParam(pool, 'taleGroup', 'taleGroupId');

  router.post('/:taleGroupId/tales', groupAccess, async (req, res, next) => {
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

  router.put('/:taleGroupId/tales/order', groupAccess, async (req, res, next) => {
    try {
      // Tale group first (404), then the body (400), then the id list (409 order_mismatch).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: OrderTalesRequest = { taleIds: requiredStringArray(req.body, 'taleIds') };
      res.json(await orderTales(pool, taleGroupId, input.taleIds));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
