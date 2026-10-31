import { ErrorCodes, type ProjectPermission, type User } from '@taleart/contract';
import {
  accessibleProjectIds,
  hasProjectPermission,
  projectExists,
  type Caller,
  type ProjectScope,
} from '@taleart/server-access';
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

/** What a request needs by default: reading needs `project.view`, anything else `content.edit`. */
export function defaultPermission(method: string): ProjectPermission {
  return method === 'GET' || method === 'HEAD' ? 'project.view' : 'content.edit';
}

/** The refusal for a caller whose role lacks the permission, and for a non-member alike. */
export function forbiddenRole(): HttpError {
  return new HttpError(403, ErrorCodes.forbidden, 'Your role in this project does not allow this');
}

/**
 * The caller's check of one project permission: true when their role in the project (a global admin
 * is `admin` everywhere; an API token never exceeds its user, nor its projects) grants it.
 */
export function allowed(pool: Pool, res: Response, projectId: string, permission: ProjectPermission): Promise<boolean> {
  return hasProjectPermission(pool, caller(res), projectId, permission);
}

/**
 * Refuses with 403 `forbidden` when the caller's role in the resource's project lacks `permission`
 * (a non-member is refused the same way). A resource that does not exist passes, so the route
 * answers its own 404 (or 400 for a body's unknown project).
 */
export async function authorize(
  pool: Pool,
  res: Response,
  kind: ResourceKind,
  id: string,
  permission: ProjectPermission,
): Promise<void> {
  const projectId = await projectOf(pool, kind, id);
  if (projectId === null) return;
  if (!(await allowed(pool, res, projectId, permission))) throw forbiddenRole();
}

/**
 * Middleware form of {@link authorize} for the resource named by a route parameter. Without a
 * `permission` it is derived from the method ({@link defaultPermission}).
 */
export function authorizeParam(
  pool: Pool,
  kind: ResourceKind,
  param: string,
  permission?: ProjectPermission,
): RequestHandler {
  return async (req, res, next) => {
    try {
      await authorize(pool, res, kind, String(req.params[param] ?? ''), permission ?? defaultPermission(req.method));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * {@link authorizeParam} for the project named by `:projectId`, where a project that does not exist is
 * refused 403 to anyone but a global admin (who gets the route's 404), so the member routes do not tell
 * a stranger which ids are projects.
 */
export function projectPermission(pool: Pool, permission: ProjectPermission): RequestHandler {
  return async (req, res, next) => {
    try {
      const projectId = String(req.params['projectId'] ?? '');
      if (!(await projectExists(pool, projectId))) {
        if (caller(res).role === 'admin') {
          next();
          return;
        }
        throw forbiddenRole();
      }
      await authorize(pool, res, 'project', projectId, permission);
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
