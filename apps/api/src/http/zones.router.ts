import {
  ErrorCodes,
  type CreateZoneRequest,
  type SetFrameRequest,
  type UpdateFrameRequest,
  type UpdateZoneRequest,
  type Zone,
} from '@taleart/contract';
import {
  createZoneFromTemplate,
  listZones,
  markZonesFirstVisible,
  setDisplay,
  updateDisplay,
  updateZone,
  zoneExists,
  ZoneNotFoundError,
  type FrameTypeRegistry,
} from '@taleart/server-zones';
import { withVisibility, zoneVisibilities } from '@taleart/server-tales';
import { Router } from 'express';
import type { Pool } from 'pg';
import { accessibleScope, authorize, authorizeParam } from './authorize';
import { HttpError } from './errors';
import { requiredString } from './validation';

/**
 * Zones with their visibility (epic UX rework R7): the zones module stores them, the tales module
 * knows what they deliver; the API composes the two (AD-1). A zone read as visible for the first
 * time gets its `firstVisibleAt` here (R9), so every user's setup checklist goes away with it.
 */
async function withZoneVisibility<Z extends Pick<Zone, 'id' | 'firstVisibleAt'>>(
  pool: Pool,
  zones: Z[],
): Promise<(Z & Pick<Zone, 'visibility'>)[]> {
  const read = withVisibility(zones, await zoneVisibilities(pool, zones.map((zone) => zone.id)));
  const firstTime = read.filter((zone) => zone.visibility.visible && !zone.firstVisibleAt).map((zone) => zone.id);
  if (firstTime.length === 0) return read;
  const marked = await markZonesFirstVisible(pool, firstTime);
  return read.map((zone) => ({ ...zone, firstVisibleAt: zone.firstVisibleAt ?? marked.get(zone.id) ?? null }));
}

// Settings as sent: validated against the frame type's JSON Schema in the zones module.
function bodySettings(body: unknown): unknown {
  return (body as { settings?: unknown } | undefined)?.settings;
}

export function zonesRouter(pool: Pool, frameTypes: FrameTypeRegistry): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await withZoneVisibility(pool, await listZones(pool, await accessibleScope(pool, res))));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = req.body as Partial<Record<keyof CreateZoneRequest, unknown>> | undefined;
      const input = {
        name: requiredString(req.body, 'name'),
        projectId: requiredString(req.body, 'projectId'),
        // Checked in the zones module: a slug (400) free in the project (409); made from the name when missing.
        ...(body?.slug !== undefined && { slug: body.slug }),
        // A template from the registry (400 `unknown_template`) sets the display in the same transaction (R5).
        ...(body?.template !== undefined && { template: body.template }),
      };
      await authorize(pool, res, 'project', input.projectId);
      const [zone] = await withZoneVisibility(pool, [await createZoneFromTemplate(pool, frameTypes, input)]);
      res.status(201).json(zone);
    } catch (err) {
      next(err);
    }
  });

  // A zone's name and slug (epic UX rework R1).
  router.patch('/:zoneId', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Partial<Record<keyof UpdateZoneRequest, unknown>>;
      const zone = await updateZone(pool, req.params.zoneId, { name: body.name, slug: body.slug });
      if (!zone) throw new ZoneNotFoundError(req.params.zoneId);
      const [withVis] = await withZoneVisibility(pool, [zone]);
      res.json(withVis);
    } catch (err) {
      next(err);
    }
  });

  // A zone's display: its one frame (AD-5, AD-17).
  router.post('/:zoneId/frame', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      // Zone first (404), then the body (400), then the registry (400) and the zone's display (409).
      if (!(await zoneExists(pool, req.params.zoneId))) throw new ZoneNotFoundError(req.params.zoneId);
      const input: SetFrameRequest = {
        type: requiredString(req.body, 'type'),
        settings: bodySettings(req.body) as SetFrameRequest['settings'],
      };
      res.status(201).json(await setDisplay(pool, frameTypes, { zoneId: req.params.zoneId, ...input }));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:zoneId/frame', authorizeParam(pool, 'zone', 'zoneId'), async (req, res, next) => {
    try {
      // Zone first (404), then the body (400), then the display (404) and its type's schema (400).
      if (!(await zoneExists(pool, req.params.zoneId))) throw new ZoneNotFoundError(req.params.zoneId);
      const body = (req.body ?? {}) as Partial<Record<keyof UpdateFrameRequest, unknown>>;
      if (body.type !== undefined && (typeof body.type !== 'string' || !body.type.trim())) {
        throw new HttpError(400, ErrorCodes.validationFailed, 'type must be a frame type key');
      }
      res.json(
        await updateDisplay(pool, frameTypes, {
          zoneId: req.params.zoneId,
          type: body.type === undefined ? undefined : (body.type as string).trim(),
          settings: body.settings,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
