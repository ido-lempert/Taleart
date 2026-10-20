import { ErrorCodes, type CreateTagRequest } from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import { createTag, listTags } from '@taleart/server-targeting';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { HttpError } from './errors';
import { requiredString } from './validation';

async function requireProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

/** A project's tags: mounted at `/projects`. */
export function projectTagsRouter(pool: Pool): Router {
  const router = Router();
  const projectAccess = authorizeParam(pool, 'project', 'projectId');

  router.get('/:projectId/tags', projectAccess, async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      res.json(await listTags(pool, req.params.projectId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:projectId/tags', projectAccess, async (req, res, next) => {
    try {
      // Project first (404), then the body (400), then the name (409 tag_exists).
      const { projectId } = req.params;
      await requireProject(pool, projectId);
      const input: CreateTagRequest = {
        name: requiredString(req.body, 'name'),
      };
      res.status(201).json(await createTag(pool, { projectId, ...input }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
