import type {
  CreateTaleGroupRequest,
  CreateTaleRequest,
  OrderTaleGroupsRequest,
  OrderTalesRequest,
  SetTaleGroupTagsRequest,
  TaleGroup,
} from '@taleart/contract';
import {
  createTale,
  createTaleGroup,
  getTaleGroup,
  listTaleGroups,
  orderTaleGroups,
  orderTales,
  taleGroupExists,
  TaleGroupNotFoundError,
  type StoredTaleGroup,
} from '@taleart/server-tales';
import { setTaleGroupTags, tagsForTaleGroups } from '@taleart/server-targeting';
import { zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { requiredString, requiredStringArray } from './validation';

/**
 * Tale groups with their tags. The tales module stores groups and the
 * targeting module their tags; the API composes the two (AD-1).
 */
async function withTags(pool: Pool, groups: StoredTaleGroup[]): Promise<TaleGroup[]> {
  const tags = await tagsForTaleGroups(pool, groups.map((g) => g.id));
  return groups.map((group) => ({ ...group, tags: tags.get(group.id) ?? [] }));
}

/** Tale groups under a zone: mounted at `/zones`. */
export function zoneTaleGroupsRouter(pool: Pool): Router {
  const router = Router();
  const zoneAccess = authorizeParam(pool, 'zone', 'zoneId');

  router.get('/:zoneId/tale-groups', zoneAccess, async (req, res, next) => {
    try {
      res.json(await withTags(pool, await listTaleGroups(pool, req.params.zoneId)));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:zoneId/tale-groups', zoneAccess, async (req, res, next) => {
    try {
      // Zone first (404), then the body (400).
      if (!(await zoneExists(pool, req.params.zoneId))) throw new ZoneNotFoundError(req.params.zoneId);
      const input: CreateTaleGroupRequest = { name: requiredString(req.body, 'name') };
      const group = await createTaleGroup(pool, { zoneId: req.params.zoneId, ...input });
      res.status(201).json({ ...group, tags: [] } satisfies TaleGroup);
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
      res.json(await withTags(pool, await orderTaleGroups(pool, zoneId, input.taleGroupIds)));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Tales and tags of a tale group: mounted at `/tale-groups`. */
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

  router.put('/:taleGroupId/tags', groupAccess, async (req, res, next) => {
    try {
      // Tale group first (404), then the body (400), then the tags (400 tag_not_found).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: SetTaleGroupTagsRequest = { tagIds: requiredStringArray(req.body, 'tagIds') };
      const tags = await setTaleGroupTags(pool, taleGroupId, input.tagIds);
      const body: TaleGroup = { ...(await getTaleGroup(pool, taleGroupId)), tags };
      res.json(body);
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
