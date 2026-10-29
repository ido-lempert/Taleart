import { ErrorCodes, SESSION_COOKIE, type AdminUserList } from '@taleart/contract';
import { findSessionUser, listUsers } from '@taleart/server-access';
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { requireAdmin } from './authorize';
import { readCookie } from './cookies';
import { HttpError } from './errors';

/**
 * GET /users (the Users page): the install's users with the sign-in methods each holds. Admins only,
 * with the session cookie alone. It is mounted ahead of the Management API's caller check, behind
 * `refuseAuthorizationHeader`, so an API token never reaches it (the same refusal as `/auth`).
 */
export function listUsersRoute(pool: Pool): RequestHandler[] {
  const sessionUser: RequestHandler = async (req, res, next) => {
    try {
      const user = await findSessionUser(pool, readCookie(req, SESSION_COOKIE));
      if (!user) throw new HttpError(401, ErrorCodes.unauthenticated, 'Sign in to continue');
      res.locals['user'] = user;
      next();
    } catch (err) {
      next(err);
    }
  };

  const list: RequestHandler = async (_req, res, next) => {
    try {
      // Admin data, never kept by a cache.
      res.setHeader('Cache-Control', 'no-store');
      const body: AdminUserList = await listUsers(pool);
      res.json(body);
    } catch (err) {
      next(err);
    }
  };

  return [sessionUser, requireAdmin, list];
}
