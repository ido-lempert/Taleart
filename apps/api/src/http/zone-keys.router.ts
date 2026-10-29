import { issueZoneKey, revokeZoneKey, zoneKeyInfo } from '@taleart/server-access';
import { clearPublicFontCache, clearPublicMediaCache } from '@taleart/server-tales';
import { zoneProjectId, ZoneNotFoundError } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam, caller, requireAdmin } from './authorize';

// The project of an existing zone, or ZoneNotFoundError (404 `zone_not_found`).
async function existingZoneProject(pool: Pool, zoneId: string): Promise<string> {
  const projectId = await zoneProjectId(pool, zoneId);
  if (projectId === null) throw new ZoneNotFoundError(zoneId);
  return projectId;
}

/**
 * A zone's key (AD-9): anyone with access to the project sees whether it has
 * one, its prefix and date; only admins issue, rotate and revoke (FR-003).
 */
export function zoneKeysRouter(pool: Pool): Router {
  const router = Router();
  const zoneAccess = authorizeParam(pool, 'zone', 'zoneId');

  router.get('/:zoneId/key', zoneAccess, async (req, res, next) => {
    try {
      await existingZoneProject(pool, req.params.zoneId);
      res.json(await zoneKeyInfo(pool, req.params.zoneId));
    } catch (err) {
      next(err);
    }
  });

  // Issuing while a key is active rotates it: the old key is revoked in the same transaction.
  router.post('/:zoneId/key', zoneAccess, requireAdmin, async (req, res, next) => {
    try {
      const projectId = await existingZoneProject(pool, req.params.zoneId);
      const issued = await issueZoneKey(pool, { zoneId: req.params.zoneId, projectId, createdBy: caller(res).id });
      // The secret is in this body only: no cache keeps it.
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(issued);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:zoneId/key', zoneAccess, requireAdmin, async (req, res, next) => {
    try {
      await existingZoneProject(pool, req.params.zoneId);
      await revokeZoneKey(pool, req.params.zoneId);
      // An uninstalled zone serves nothing (epic UX rework R7): forget this process's public answers.
      clearPublicMediaCache();
      clearPublicFontCache();
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
