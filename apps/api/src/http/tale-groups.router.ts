import {
  DEFAULT_TAG_MATCH,
  ErrorCodes,
  isTagMatch,
  MAX_TALE_GROUP_NAME_LENGTH,
  type CopyTaleGroupRequest,
  type CreateTaleGroupRequest,
  type CreateTaleRequest,
  type ProjectTaleGroup,
  type OrderTaleGroupsRequest,
  type OrderTalesRequest,
  type RenameTaleGroupRequest,
  type SetScheduleRequest,
  type SetStatusRequest,
  type SetTaleGroupTagsRequest,
  type TagMatch,
  type TaleGroup,
  type ZoneTaleGroup,
} from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import {
  copyTaleGroup,
  createTale,
  createProjectTaleGroup,
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
} from '@taleart/server-tales';
import { copyTaleGroupTags, setTaleGroupTags, tagMatchesForTaleGroups, tagsForTaleGroups } from '@taleart/server-targeting';
import { zoneExists, ZoneNotFoundError } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorize, authorizeParam } from './authorize';
import { HttpError } from './errors';
import { requiredName, requiredSchedule, requiredSettableStatus, requiredString, requiredStringArray } from './validation';

/**
 * Tale groups with their tags and tag match mode. The tales module stores
 * groups and the targeting module their tags; the API composes the two (AD-1).
 */
export async function withTags<G extends { id: string }>(
  pool: Pool,
  groups: G[],
): Promise<(G & Pick<TaleGroup, 'tags' | 'tagMatch'>)[]> {
  const ids = groups.map((g) => g.id);
  const [tags, matches] = await Promise.all([tagsForTaleGroups(pool, ids), tagMatchesForTaleGroups(pool, ids)]);
  return groups.map((group) => ({
    ...group,
    tags: tags.get(group.id) ?? [],
    tagMatch: matches.get(group.id) ?? DEFAULT_TAG_MATCH,
  }));
}

// The optional `tagMatch` of a tags request: left out keeps the group's mode; anything but `any` or `all` is a 400.
function optionalTagMatch(body: unknown): TagMatch | undefined {
  const value = (body as { tagMatch?: unknown } | null)?.tagMatch;
  if (value === undefined) return undefined;
  if (!isTagMatch(value)) throw new HttpError(400, ErrorCodes.validationFailed, 'tagMatch must be "any" or "all"');
  return value;
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
      const input: CreateTaleGroupRequest = { name: requiredName(req.body, 'name', MAX_TALE_GROUP_NAME_LENGTH) };
      const group = await createTaleGroup(pool, { zoneId: req.params.zoneId, ...input });
      res.status(201).json({ ...group, tags: [], tagMatch: DEFAULT_TAG_MATCH } satisfies ZoneTaleGroup);
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

  const projectAccess = authorizeParam(pool, 'project', 'projectId');

  router.get('/:projectId/tale-groups', projectAccess, async (req, res, next) => {
    try {
      const { projectId } = req.params;
      if (!(await projectExists(pool, projectId))) {
        throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
      }
      res.json((await withTags(pool, await listProjectTaleGroups(pool, projectId))) satisfies ProjectTaleGroup[]);
    } catch (err) {
      next(err);
    }
  });

  // A group in no zone yet, from the Tale groups page (epic UX rework R14).
  router.post('/:projectId/tale-groups', projectAccess, async (req, res, next) => {
    try {
      // Project first (404), then the body (400).
      const { projectId } = req.params;
      if (!(await projectExists(pool, projectId))) {
        throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
      }
      const input: CreateTaleGroupRequest = { name: requiredName(req.body, 'name', MAX_TALE_GROUP_NAME_LENGTH) };
      const group = await createProjectTaleGroup(pool, { projectId, ...input });
      res.status(201).json({ ...group, tags: [], tagMatch: DEFAULT_TAG_MATCH } satisfies ProjectTaleGroup);
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

  // One group with its tales, placed in a zone or not: the dashboard opens a group in no zone with it (story 8.19).
  router.get('/:taleGroupId', groupAccess, async (req, res, next) => {
    try {
      const [body] = await withTags(pool, [await getTaleGroup(pool, req.params.taleGroupId)]);
      res.json(body satisfies TaleGroup);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:taleGroupId', groupAccess, async (req, res, next) => {
    try {
      // Tale group first (404), then the body (400).
      const { taleGroupId } = req.params;
      if (!(await taleGroupExists(pool, taleGroupId))) throw new TaleGroupNotFoundError(taleGroupId);
      const input: RenameTaleGroupRequest = { name: requiredName(req.body, 'name', MAX_TALE_GROUP_NAME_LENGTH) };
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
      // its tags and match mode, in the same transaction (AD-1, AD-14, epic targeting R1).
      let targeting: Pick<TaleGroup, 'tags' | 'tagMatch'> = { tags: [], tagMatch: DEFAULT_TAG_MATCH };
      const copy = await copyTaleGroup(pool, { taleGroupId, zoneId: input.zoneId }, async (tx, ids) => {
        targeting = await copyTaleGroupTags(tx, ids);
      });
      res.status(201).json({ ...copy, ...targeting } satisfies ZoneTaleGroup);
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
      const input: SetTaleGroupTagsRequest = {
        tagIds: requiredStringArray(req.body, 'tagIds'),
        tagMatch: optionalTagMatch(req.body),
      };
      const targeting = await setTaleGroupTags(pool, taleGroupId, input.tagIds, input.tagMatch);
      const body: TaleGroup = { ...(await getTaleGroup(pool, taleGroupId)), ...targeting };
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
