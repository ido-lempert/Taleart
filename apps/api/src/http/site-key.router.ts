import { ErrorCodes } from '@taleart/contract';
import { issueSiteKey, projectExists, revokeSiteKey, siteKeyInfo } from '@taleart/server-access';
import { clearPublicFontCache, clearPublicMediaCache } from '@taleart/server-tales';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam, caller } from './authorize';
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
  const keysAccess = authorizeParam(pool, 'project', 'projectId', 'keys.manage');

  router.get('/:projectId/site-key', projectAccess, async (req, res, next) => {
    try {
      await existingProject(pool, req.params.projectId);
      res.json(await siteKeyInfo(pool, req.params.projectId));
    } catch (err) {
      next(err);
    }
  });

  // Issuing while a site key is active rotates it: the old key is revoked in the same transaction.
  // `{ ifNone: true }` issues only when none is active (409 `site_key_exists` otherwise), so a first
  // issue can never rotate a key some other admin just issued.
  router.post('/:projectId/site-key', keysAccess, async (req, res, next) => {
    try {
      const body: unknown = req.body ?? {};
      const ifNone = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['ifNone'] : undefined;
      if (ifNone !== undefined && typeof ifNone !== 'boolean') {
        throw new HttpError(400, ErrorCodes.validationFailed, 'ifNone must be true or false');
      }
      await existingProject(pool, req.params.projectId);
      const issued = await issueSiteKey(pool, { projectId: req.params.projectId, createdBy: caller(res).id, ifNone: ifNone === true });
      // A first key installs the project's zones (epic UX rework R7): forget this process's "not public"
      // answers, so their media and fonts are served at once.
      clearPublicMediaCache();
      clearPublicFontCache();
      // The secret is in this body only: no cache keeps it.
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(issued);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:projectId/site-key', keysAccess, async (req, res, next) => {
    try {
      await existingProject(pool, req.params.projectId);
      await revokeSiteKey(pool, req.params.projectId);
      // The project's zones are no longer installed (epic UX rework R7): forget this process's public answers.
      clearPublicMediaCache();
      clearPublicFontCache();
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
