import {
  ErrorCodes,
  type CopyTaleGroupRequest,
  type CreateTaleGroupRequest,
  type CreateTaleRequest,
  type OrderTaleGroupsRequest,
  type OrderTalesRequest,
  type RenameTaleGroupRequest,
  type SetScheduleRequest,
  type SetStatusRequest,
  type SetTaleGroupTagsRequest,
  type TaleGroup,
  type ZoneTaleGroup,
} from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import {
  copyTaleGroup,
  createTale,
  createTaleGroup,
  getTaleGroup,
  listProjectTaleGroups,
  listTaleGroups,
  orderTaleGroups,
  orderTales,
  placeTaleGroup,
  removeTaleGroup,
  renameTaleGroup,
  setTaleGroupSchedule,
  setTaleGroupStatus,
  taleGroupExists,
  TaleGroupNotFoundError,
  type StoredTaleGroup,
} from '@taleart/server-tales';
import { copyTaleGroupTags, setTaleGroupTags, tagsForTaleGroups } from '@taleart/server-targeting';
import { zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorize, authorizeParam } from './authorize';
import { HttpError } from './errors';
import { requiredSchedule, requiredSettableStatus, requiredString, requiredStringArray } from './validation';

/**
 * Tale groups with their tags. The tales module stores groups and the
 * targeting module their tags; the API composes the two (AD-1).
 */
async function withTags<G extends StoredTaleGroup>(pool: Pool, groups: G[]): Promise<(G & Pick<TaleGroup, 'tags'>)[]> {
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
      res.status(201).json({ ...group, tags: [] } satisfies ZoneTaleGroup);
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

  // Registered after `/order`, so PUT .../tale-groups/order still orders (AD-14).
  router.put('/:zoneId/tale-groups/:taleGroupId', zoneAccess, async (req, res, next) => {
    try {
      // Zone first (404), then the group of the zone's project (400 tale_group_not_found).
      const { zoneId, taleGroupId } = req.params;
      const { group, placed } = await placeTaleGroup(pool, zoneId, taleGroupId);
      const [body] = await withTags(pool, [group]);
      res.status(placed ? 201 : 200).json(body satisfies ZoneTaleGroup);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:zoneId/tale-groups/:taleGroupId', zoneAccess, async (req, res, next) => {
    try {
      // Zone first (404 zone_not_found), then the placement (404 tale_group_not_found).
      await removeTaleGroup(pool, req.params.zoneId, req.params.taleGroupId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** A project's tale groups, placed in a zone or not (AD-14): mounted at `/projects`. */
export function projectTaleGroupsRouter(pool: Pool): Router {
  const router = Router();

  router.get('/:projectId/tale-groups', authorizeParam(pool, 'project', 'projectId'), async (req, res, next) => {
    try {
      const { projectId } = req.params;
      if (!(await projectExists(pool, projectId))) {
        throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
      }
      res.json(await listProjectTaleGroups(pool, projectId));
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

  router.patch('/:taleGroupId', groupAccess, async (req, res, next) => {
    try {
      // Tale group first (404), then the body (400).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: RenameTaleGroupRequest = { name: requiredString(req.body, 'name') };
      const [body] = await withTags(pool, [await renameTaleGroup(pool, taleGroupId, input.name)]);
      res.json(body satisfies TaleGroup);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:taleGroupId/status', groupAccess, async (req, res, next) => {
    try {
      // Tale group first (404), then the body (400), then the transition (409).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: SetStatusRequest = { status: requiredSettableStatus(req.body) };
      const [body] = await withTags(pool, [await setTaleGroupStatus(pool, taleGroupId, input.status)]);
      res.json(body satisfies TaleGroup);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:taleGroupId/schedule', groupAccess, async (req, res, next) => {
    try {
      // Tale group first (404), then the body (400).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: SetScheduleRequest = requiredSchedule(req.body);
      const [body] = await withTags(pool, [await setTaleGroupSchedule(pool, taleGroupId, input)]);
      res.json(body satisfies TaleGroup);
    } catch (err) {
      next(err);
    }
  });

  router.post('/:taleGroupId/copy', groupAccess, async (req, res, next) => {
    try {
      // Source group first (404), then the body (400), then the target zone:
      // its project must be the caller's too (403), and it must exist (404).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: CopyTaleGroupRequest = { zoneId: requiredString(req.body, 'zoneId') };
      await authorize(pool, res, 'zone', input.zoneId);
      // The tales module copies the group and its tales; the targeting module
      // its tags, in the same transaction (AD-1, AD-14).
      let tags: TaleGroup['tags'] = [];
      const copy = await copyTaleGroup(pool, { taleGroupId, zoneId: input.zoneId }, async (tx, ids) => {
        tags = await copyTaleGroupTags(tx, ids);
      });
      res.status(201).json({ ...copy, tags } satisfies ZoneTaleGroup);
    } catch (err) {
      next(err);
    }
  });

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
