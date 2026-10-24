import { ErrorCodes, type User } from '@taleart/contract';
import { accessibleProjectIds, canAccessProject, projectExists, type Caller, type ProjectScope } from '@taleart/server-access';
import { taleGroupProjectId, taleProjectId } from '@taleart/server-tales';
import { zoneProjectId } from '@taleart/server-zones';
import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { credential } from './credentials';
import { HttpError } from './errors';

/** The kinds of resource a Management API route acts on; each belongs to one project (AD-4). */
export type ResourceKind = 'project' | 'zone' | 'taleGroup' | 'tale';

/**
 * The signed-in user that requireCaller put on the response. With an API token (epic developer
 * experience 10.1) it also carries the token's projects, which every project check below applies.
 */
export function caller(res: Response): User & Caller {
  const user = res.locals['user'] as User;
  const used = credential(res);
  return used.kind === 'token' ? { ...user, tokenProjects: used.projects } : user;
}

// The project of a resource, through the owning module's public interface; null when it does not exist.
async function projectOf(pool: Pool, kind: ResourceKind, id: string): Promise<string | null> {
  switch (kind) {
    case 'project':
      return (await projectExists(pool, id)) ? id : null;
    case 'zone':
      return zoneProjectId(pool, id);
    case 'taleGroup':
      return taleGroupProjectId(pool, id);
    case 'tale':
      return taleProjectId(pool, id);
  }
}

/**
 * Refuses with 403 `forbidden` when the resource is in a project the caller
 * cannot access. A resource that does not exist passes, so the route answers
 * its own 404 (or 400 for a body's unknown project).
 */
export async function authorize(pool: Pool, res: Response, kind: ResourceKind, id: string): Promise<void> {
  const projectId = await projectOf(pool, kind, id);
  if (projectId === null) return;
  if (!(await canAccessProject(pool, caller(res), projectId))) {
    throw new HttpError(403, ErrorCodes.forbidden, 'You do not have access to this project');
  }
}

/** Middleware form of {@link authorize} for the resource named by a route parameter. */
export function authorizeParam(pool: Pool, kind: ResourceKind, param: string): RequestHandler {
  return async (req, res, next) => {
    try {
      await authorize(pool, res, kind, String(req.params[param] ?? ''));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Admin-only actions answer 403 `forbidden` to content managers. */
export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (caller(res).role !== 'admin') {
    next(new HttpError(403, ErrorCodes.forbidden, 'Only admins can do this'));
    return;
  }
  next();
};

/** The projects whose content the caller's lists include. */
export function accessibleScope(pool: Pool, res: Response): Promise<ProjectScope> {
  return accessibleProjectIds(pool, caller(res));
}
