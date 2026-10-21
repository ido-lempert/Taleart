import {
  ErrorCodes,
  type FindStorylyAppsRequest,
  type StartImportRequest,
  type StorylyApp,
} from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import { createImportJob, encryptToken, getImportJob, listImportJobs, StorylyClient } from '@taleart/server-importer';
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { authorizeParam, caller, requireAdmin } from './authorize';
import { HttpError } from './errors';
import { requiredString } from './validation';

/** How the API reaches the import source and protects its tokens. */
export interface ImporterConfig {
  /** Encrypts stored source tokens (IMPORT_TOKEN_KEY); null leaves the importer off (503). */
  tokenKey: Buffer | null;
  /** Base URL of the Storyly External API (STORYLY_API_URL). */
  storylyApiUrl: string;
  /** Tests may pass their own fetch. */
  fetch?: typeof fetch;
  /** Called after a job is queued, so the worker starts it without waiting for its next poll. */
  wake?: () => void;
}

async function requireProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

/** A project's imports from Storyly: mounted at `/projects`. Admins only. */
export function importsRouter(pool: Pool, importer: ImporterConfig): Router {
  const router = Router();

  // Admins first (403), then access to the project (403), then a configured importer (503).
  const configured: RequestHandler = (_req, _res, next) => {
    if (importer.tokenKey === null) {
      next(new HttpError(503, ErrorCodes.importerNotConfigured, 'The importer is not configured: IMPORT_TOKEN_KEY is not set'));
      return;
    }
    next();
  };
  const guards = [requireAdmin, authorizeParam(pool, 'project', 'projectId'), configured];

  router.post('/:projectId/imports/storyly/apps', ...guards, async (req, res, next) => {
    try {
      await requireProject(pool, req.params.projectId);
      const input: FindStorylyAppsRequest = { token: requiredString(req.body, 'token') };
      // Only reads the app list; the token is neither stored nor logged.
      const client = new StorylyClient({ baseUrl: importer.storylyApiUrl, token: input.token, fetch: importer.fetch });
      // An app the check could not read cannot be picked; one without a title shows its id.
      const apps: StorylyApp[] = (await client.listApps()).entries.flatMap(({ record }) =>
        record === null ? [] : [{ id: record.id, name: record.name.trim() || record.id }],
      );
      res.json(apps);
    } catch (err) {
      next(err);
    }
  });

  // The project's imports, newest first, without reports: the report is read per job.
  router.get('/:projectId/imports', ...guards, async (req, res, next) => {
    try {
      const { projectId } = req.params;
      await requireProject(pool, projectId);
      res.json(await listImportJobs(pool, projectId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/:projectId/imports', ...guards, async (req, res, next) => {
    try {
      const { projectId } = req.params;
      await requireProject(pool, projectId);
      const input: StartImportRequest = {
        token: requiredString(req.body, 'token'),
        appId: requiredString(req.body, 'appId'),
      };
      const tokenKey = importer.tokenKey as Buffer;
      const job = await createImportJob(pool, {
        projectId,
        createdBy: caller(res).id,
        sourceAppId: input.appId,
        tokenCiphertext: encryptToken(input.token, tokenKey),
      });
      importer.wake?.();
      res.status(202).json(job);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:projectId/imports/:importId', ...guards, async (req, res, next) => {
    try {
      const { projectId, importId } = req.params;
      await requireProject(pool, projectId);
      const job = await getImportJob(pool, projectId, importId);
      if (!job) throw new HttpError(404, ErrorCodes.notFound, 'This project has no import with this id');
      res.json(job);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
