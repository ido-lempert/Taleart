import { ErrorCodes, invitationPath, type CreateProjectRequest, type Invitation } from '@taleart/contract';
import { createInvitation, createProject, listProjects, projectExists } from '@taleart/server-access';
import { Router } from 'express';
import type { Pool } from 'pg';
import { accessibleScope, caller, requireAdmin } from './authorize';
import { HttpError } from './errors';
import { requiredString } from './validation';

export interface ProjectsOptions {
  /** The dashboard's origin (RP_ORIGIN); invitation links point there. */
  dashboardOrigin: string;
}

export function projectsRouter(pool: Pool, { dashboardOrigin }: ProjectsOptions): Router {
  const router = Router();

  // Admins see every project, content managers their own (AD-4).
  router.get('/', async (_req, res, next) => {
    try {
      res.json(await listProjects(pool, await accessibleScope(pool, res)));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireAdmin, async (req, res, next) => {
    try {
      const input: CreateProjectRequest = { name: requiredString(req.body, 'name') };
      res.status(201).json(await createProject(pool, input));
    } catch (err) {
      next(err);
    }
  });

  // One-time invitation link; the token is in this response only (AD-9).
  router.post('/:projectId/invitations', requireAdmin, async (req, res, next) => {
    try {
      const { projectId } = req.params;
      if (!(await projectExists(pool, projectId))) {
        throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
      }
      const invitation = await createInvitation(pool, { projectId, createdBy: caller(res).id });
      const body: Invitation = {
        id: invitation.id,
        projectId: invitation.projectId,
        url: `${dashboardOrigin}${invitationPath(invitation.token)}`,
        expiresAt: invitation.expiresAt.toISOString(),
      };
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
