import {
  ErrorCodes,
  MAX_API_TOKEN_NAME_LENGTH,
  MAX_API_TOKEN_PROJECTS,
  type CreateApiTokenRequest,
  type CurrentApiToken,
  type RevokedApiTokens,
} from '@taleart/contract';
import {
  createApiToken,
  listApiTokens,
  projectExists,
  revokeApiToken,
  revokeUserApiTokens,
} from '@taleart/server-access';
import { Router } from 'express';
import type { Pool } from 'pg';
import { authorize, caller, requireAdmin } from './authorize';
import { credential, sessionOnly } from './credentials';
import { HttpError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Control characters, which a name shown in the dashboard has no use for.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const invalid = (message: string) => new HttpError(400, ErrorCodes.validationFailed, message);

/** A create request as sent, checked field by field; the projects are checked against the user after. */
function readCreate(body: unknown): { name: string; projectIds: string[] | null; readOnly: boolean; expiresAt: Date | null } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('The body must be an object');
  const input = body as Partial<Record<keyof CreateApiTokenRequest, unknown>>;

  if (typeof input.name !== 'string') throw invalid('name is required');
  const name = input.name.trim();
  if (name.length === 0) throw invalid('name is required');
  if ([...name].length > MAX_API_TOKEN_NAME_LENGTH) throw invalid(`name holds at most ${MAX_API_TOKEN_NAME_LENGTH} characters`);
  if (CONTROL.test(name)) throw invalid('name cannot hold control characters');

  if (typeof input.readOnly !== 'boolean') throw invalid('readOnly must be true or false');

  let projectIds: string[] | null;
  if (input.projectIds === null) {
    projectIds = null;
  } else if (Array.isArray(input.projectIds)) {
    if (input.projectIds.length === 0) throw invalid('projectIds lists at least one project, or is null for all of yours');
    if (input.projectIds.length > MAX_API_TOKEN_PROJECTS) throw invalid(`projectIds lists at most ${MAX_API_TOKEN_PROJECTS} projects`);
    if (!input.projectIds.every((id): id is string => typeof id === 'string' && UUID.test(id))) {
      throw invalid('projectIds lists project ids');
    }
    projectIds = [...new Set(input.projectIds.map((id) => id.toLowerCase()))];
    if (projectIds.length !== input.projectIds.length) throw invalid('projectIds lists each project once');
  } else {
    throw invalid('projectIds is a list of project ids, or null for all of your projects');
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    // An ISO 8601 date-time with `Z` or an offset, as schedules take it.
    if (typeof input.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(input.expiresAt)) {
      throw invalid('expiresAt is an ISO 8601 date-time with a time zone, or null');
    }
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw invalid('expiresAt is not a valid date-time');
    if (expiresAt.getTime() <= Date.now()) throw invalid('expiresAt must be in the future');
  }

  return { name, projectIds, readOnly: input.readOnly, expiresAt };
}

/**
 * Personal API tokens (epic developer experience 10.1), mounted at `/api-tokens`: each signed-in user
 * creates, lists and revokes their own. A passkey session only: a token can never mint, see or revoke
 * tokens, so a leaked token cannot make itself permanent.
 */
export function apiTokensRouter(pool: Pool): Router {
  const router = Router();

  // The token making the request, with its user (epic developer experience 10.3, for `taleart
  // whoami`): only with a token, which reads only itself, so nothing here mints or widens anything.
  router.get('/current', async (_req, res, next) => {
    try {
      const used = credential(res);
      if (used.kind !== 'token') {
        throw new HttpError(403, ErrorCodes.forbidden, 'Only an API token can read /api-tokens/current: a session has no token');
      }
      const user = caller(res);
      const token = (await listApiTokens(pool, user.id)).find((t) => t.id === used.tokenId);
      // Revoked between the check and the read: as if it had not been accepted.
      if (!token) throw new HttpError(401, ErrorCodes.unauthenticated, 'This API token is unknown, revoked or expired');
      const body: CurrentApiToken = {
        ...token,
        allProjects: token.projectIds === null,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.use(sessionOnly);

  router.get('/', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await listApiTokens(pool, caller(res).id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const input = readCreate(req.body);
      // Every listed project must exist (400) and be one the user can access now (403), so a token
      // never names a project its user cannot reach.
      for (const projectId of input.projectIds ?? []) {
        if (!(await projectExists(pool, projectId))) {
          throw new HttpError(400, ErrorCodes.projectNotFound, `No project has the id ${projectId}`);
        }
        await authorize(pool, res, 'project', projectId);
      }
      const issued = await createApiToken(pool, { userId: caller(res).id, ...input });
      // The secret is in this body only: no cache keeps it.
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(issued);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:tokenId', async (req, res, next) => {
    try {
      await revokeApiToken(pool, caller(res).id, req.params.tokenId);
      res.sendStatus(204);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * An admin revokes every API token of a user (`DELETE /users/{userId}/api-tokens`), for a lost
 * laptop or a person leaving. A passkey session only, and admins only. Answers the number revoked;
 * an unknown user 404 `not_found`.
 */
export function userApiTokensRouter(pool: Pool): Router {
  const router = Router();

  router.delete('/:userId/api-tokens', sessionOnly, requireAdmin, async (req, res, next) => {
    try {
      const revoked = await revokeUserApiTokens(pool, req.params.userId);
      if (revoked === null) throw new HttpError(404, ErrorCodes.notFound, 'No user has this id');
      const body: RevokedApiTokens = { revoked };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
