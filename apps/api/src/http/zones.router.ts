import {
  ErrorCodes,
  type CreateFrameRequest,
  type CreateStageRequest,
  type CreateZoneRequest,
  type RenameStageRequest,
  type UpdateFrameRequest,
} from '@taleart/contract';
import {
  createFrame,
  createStage,
  createZone,
  deleteStage,
  listFrames,
  listStages,
  listZones,
  renameStage,
  updateFrameSettings,
  zoneExists,
  ZoneNotFoundError,
  type FrameTypeRegistry,
} from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { accessibleScope, authorize, authorizeParam } from './authorize';
import { HttpError } from './errors';
import { requiredString } from './validation';

export function zonesRouter(pool: Pool, frameTypes: FrameTypeRegistry): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await listZones(pool, await accessibleScope(pool, res)));
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
      await authorize(pool, res, 'project', input.projectId);
      res.status(201).json(await createZone(pool, input));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:zoneId/frames', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      res.json(await listFrames(pool, req.params.zoneId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:zoneId/frames', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
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

  router.patch('/:zoneId/frames/:frameId', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      // Zone first (404), then the body (400), then the frame (404) and its type's schema (400).
      if (!(await zoneExists(pool, req.params.zoneId))) throw new ZoneNotFoundError(req.params.zoneId);
      const settings = (req.body as Partial<UpdateFrameRequest> | undefined)?.settings;
      if (settings === undefined) throw new HttpError(400, ErrorCodes.validationFailed, 'settings is required');
      res.json(
        await updateFrameSettings(pool, frameTypes, {
          zoneId: req.params.zoneId,
          frameId: req.params.frameId,
          settings,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  // Stages (epic web zones R7): each shows one of the zone's frames on a host page.
  router.get('/:zoneId/stages', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      res.json(await listStages(pool, req.params.zoneId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:zoneId/stages', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      // Zone first (404), then the body (400), then the frame (400) and the key (409), in the zones module.
      const body = (req.body ?? {}) as Partial<Record<keyof CreateStageRequest, unknown>>;
      res.status(201).json(
        await createStage(pool, { zoneId: req.params.zoneId, name: body.name, key: body.key, frameId: body.frameId }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:zoneId/stages/:stageId', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      // Only the name changes: a page names the stage by its key, which stays.
      const body = (req.body ?? {}) as Partial<Record<keyof RenameStageRequest, unknown>>;
      res.json(await renameStage(pool, { zoneId: req.params.zoneId, stageId: req.params.stageId, name: body.name }));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:zoneId/stages/:stageId', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      await deleteStage(pool, { zoneId: req.params.zoneId, stageId: req.params.stageId });
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
