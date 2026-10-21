import {
  ErrorCodes,
  MAX_IMPORT_SELECTED_ZONES,
  type FindStorylyAppsRequest,
  type ImportPreview,
  type ImportPreviewRequest,
  type StartImportRequest,
  type StorylyApp,
} from '@taleart/contract';
import { projectExists } from '@taleart/server-access';
import {
  createImportJob,
  encryptToken,
  getImportJob,
  INTERACTIVE_RETRY_POLICY,
  listImportJobs,
  previewApp,
  PREVIEW_REQUEST_TIMEOUT_MS,
  SELECTION_KEY_TTL_MS,
  signSelectionKey,
  StorylyClient,
  verifySelectionKey,
  type ImportJobSelection,
  type PreviewLimits,
  type SelectionScope,
} from '@taleart/server-importer';
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
  /** Preview bounds; tests shorten them. */
  previewLimits?: PreviewLimits;
  /** How many previews may run at once, per person and in this process; tests lower them. */
  previewConcurrency?: { perUser: number; total: number };
}

/** Previews running at once: one per person and four per process by default. */
export const PREVIEW_CONCURRENCY = { perUser: 1, total: 4 };

/** Counts the previews in flight, per person and in all, so a burst cannot fan out Storyly reads. */
function previewSlots(limit: { perUser: number; total: number }) {
  const byUser = new Map<string, number>();
  let total = 0;
  return {
    /** Takes a slot for `userId`; false when the person or the process is at its limit. */
    take(userId: string): boolean {
      const mine = byUser.get(userId) ?? 0;
      if (mine >= limit.perUser || total >= limit.total) return false;
      byUser.set(userId, mine + 1);
      total++;
      return true;
    },
    release(userId: string): void {
      const mine = (byUser.get(userId) ?? 1) - 1;
      if (mine <= 0) byUser.delete(userId);
      else byUser.set(userId, mine);
      total--;
    },
  };
}

const selectionInvalid = (message: string) => new HttpError(400, ErrorCodes.importSelectionInvalid, message);

/**
 * Reads a start's `selection` (absent takes everything) and checks it against
 * its preview's key: every picked zone must be one the preview listed for this
 * project, app and person; media and tags need tale groups.
 */
function readSelection(body: unknown, tokenKey: Buffer, scope: SelectionScope): ImportJobSelection | null {
  const value = (body as Record<string, unknown> | undefined)?.['selection'];
  // Only an absent selection takes everything; null is a malformed one.
  if (value === undefined) return null;
  const invalid = (message: string) => new HttpError(400, ErrorCodes.validationFailed, message);
  if (value === null) throw invalid('selection must be an object; leave it out to import everything');
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('selection must be an object');
  const selection = value as Record<string, unknown>;
  const key = selection['selectionKey'];
  if (typeof key !== 'string' || key === '') throw invalid('selection.selectionKey is required');
  const zones = selection['zones'];
  if (!Array.isArray(zones) || !zones.every((id): id is string => typeof id === 'string' && id !== '')) {
    throw invalid('selection.zones must be an array of zone ids');
  }
  if (zones.length === 0) throw invalid('Pick at least one zone to import');
  if (zones.length > MAX_IMPORT_SELECTED_ZONES) {
    throw invalid(`At most ${MAX_IMPORT_SELECTED_ZONES} zones can be picked`);
  }
  if (new Set(zones).size !== zones.length) throw invalid('selection.zones lists a zone more than once');
  const flag = (name: 'taleGroups' | 'media' | 'tags'): boolean => {
    if (typeof selection[name] !== 'boolean') throw invalid(`selection.${name} must be true or false`);
    return selection[name] as boolean;
  };
  const picked = { zones, taleGroups: flag('taleGroups'), media: flag('media'), tags: flag('tags') };
  const listed = verifySelectionKey(tokenKey, key, scope);
  if (listed === null) {
    throw selectionInvalid('The selection has expired or is not for this app. Choose what to import again.');
  }
  if (!zones.every((id) => listed.has(id))) {
    throw selectionInvalid('The selection names a zone this app did not list. Choose what to import again.');
  }
  if (!picked.taleGroups && (picked.media || picked.tags)) {
    throw selectionInvalid('Media and tags can only be imported with tale groups and tales');
  }
  return picked;
}

async function requireProject(pool: Pool, projectId: string): Promise<void> {
  if (!(await projectExists(pool, projectId))) {
    throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
  }
}

/** A project's imports from Storyly: mounted at `/projects`. Admins only. */
export function importsRouter(pool: Pool, importer: ImporterConfig): Router {
  const router = Router();
  const slots = previewSlots(importer.previewConcurrency ?? PREVIEW_CONCURRENCY);

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
      const client = new StorylyClient({
        baseUrl: importer.storylyApiUrl,
        token: input.token,
        fetch: importer.fetch,
        retry: INTERACTIVE_RETRY_POLICY,
      });
      // An app the check could not read cannot be picked; one without a title shows its id.
      const apps: StorylyApp[] = (await client.listApps()).entries.flatMap(({ record }) =>
        record === null ? [] : [{ id: record.id, name: record.name.trim() || record.id }],
      );
      res.json(apps);
    } catch (err) {
      next(err);
    }
  });

  // What the app holds, to pick what to import: zones with their counts and a key naming them.
  router.post('/:projectId/imports/storyly/preview', ...guards, async (req, res, next) => {
    try {
      const { projectId } = req.params;
      await requireProject(pool, projectId);
      const input: ImportPreviewRequest = {
        token: requiredString(req.body, 'token'),
        appId: requiredString(req.body, 'appId'),
      };
      // The token is used for these reads only: neither stored nor logged, and not in the key.
      const client = new StorylyClient({
        baseUrl: importer.storylyApiUrl,
        token: input.token,
        fetch: importer.fetch,
        timeoutMs: PREVIEW_REQUEST_TIMEOUT_MS,
        retry: INTERACTIVE_RETRY_POLICY,
      });
      const userId = caller(res).id;
      if (!slots.take(userId)) {
        throw new HttpError(
          429,
          ErrorCodes.previewBusy,
          'Another check of what to import is still running. Wait for it to finish, then try again.',
        );
      }
      // The caller going away aborts the reads in flight.
      const gone = new AbortController();
      const abort = () => {
        if (!res.writableFinished) gone.abort();
      };
      res.on('close', abort);
      let preview: Awaited<ReturnType<typeof previewApp>>;
      try {
        preview = await previewApp(client, input.appId, input.token, importer.previewLimits, gone.signal);
      } finally {
        res.off('close', abort);
        slots.release(userId);
      }
      if (gone.signal.aborted) return;
      if (preview === null) throw selectionInvalid('This Storyly token cannot read the chosen app');
      const expiresAt = Date.now() + SELECTION_KEY_TTL_MS;
      const scope = { projectId, appId: preview.appId, userId };
      const zoneIds = preview.zones.map((zone) => zone.id);
      const answer: ImportPreview = {
        ...preview,
        selectionKey: signSelectionKey(importer.tokenKey as Buffer, scope, zoneIds, expiresAt),
        expiresAt: new Date(expiresAt).toISOString(),
      };
      res.json(answer);
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
      const userId = caller(res).id;
      const selection = readSelection(req.body, tokenKey, { projectId, appId: input.appId, userId });
      const job = await createImportJob(pool, {
        projectId,
        createdBy: userId,
        sourceAppId: input.appId,
        tokenCiphertext: encryptToken(input.token, tokenKey),
        selection,
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
