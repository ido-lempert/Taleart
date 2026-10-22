import { ErrorCodes } from '@taleart/contract';
import { issueSiteKey, projectExists, revokeSiteKey, siteKeyInfo } from '@taleart/server-access';
import { clearPublicFontCache, clearPublicMediaCache } from '@taleart/server-tales';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam, caller, requireAdmin } from './authorize';
import { HttpError } from './errors';

// An unknown project answers 404 `project_not_found`.
async function existingProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

/**
 * A project's site key (AD-9 amended, epic UX rework R3), mounted under `/projects`: anyone with
 * access to the project sees whether it has one, its prefix and date; only admins issue, rotate and
 * revoke it.
 */
export function siteKeyRouter(pool: Pool): Router {
  const router = Router();
  const projectAccess = authorizeParam(pool, 'project', 'projectId');

  router.get('/:projectId/site-key', projectAccess, async (req, res, next) => {
    try {
      await existingProject(pool, req.params.projectId);
      res.json(await siteKeyInfo(pool, req.params.projectId));
    } catch (err) {
      next(err);
    }
  });

  // Issuing while a site key is active rotates it: the old key is revoked in the same transaction.
  router.post('/:projectId/site-key', projectAccess, requireAdmin, async (req, res, next) => {
    try {
      await existingProject(pool, req.params.projectId);
      const issued = await issueSiteKey(pool, { projectId: req.params.projectId, createdBy: caller(res).id });
      // The secret is in this body only: no cache keeps it.
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(issued);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:projectId/site-key', projectAccess, requireAdmin, async (req, res, next) => {
    try {
      await existingProject(pool, req.params.projectId);
      await revokeSiteKey(pool, req.params.projectId);
      // Zones without a zone key are no longer installed (epic UX rework R7): forget this process's public answers.
      clearPublicMediaCache();
      clearPublicFontCache();
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
