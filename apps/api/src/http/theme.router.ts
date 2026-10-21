import { ErrorCodes } from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import { getProjectTheme, setProjectTheme } from '@taleart/server-zones';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorizeParam } from './authorize';
import { HttpError } from './errors';

async function requireProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

/**
 * The project's theme (epic web zones R9), mounted at `/projects`: one theme
 * per project, read and replaced by anyone with access to the project.
 */
export function projectThemeRouter(pool: Pool): Router {
  const router = Router();

  router.get('/:projectId/theme', authorizeParam(pool, 'project', 'projectId'), async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      res.json(await getProjectTheme(pool, req.params.projectId));
    } catch (err) {
      next(err);
    }
  });

  // Project first (404), then the theme schema (400 invalid_theme).
  router.put('/:projectId/theme', authorizeParam(pool, 'project', 'projectId'), async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      res.json(await setProjectTheme(pool, req.params.projectId, req.body));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
