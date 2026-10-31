import {
  ErrorCodes,
  invitationPath,
  PROJECT_PERMISSIONS,
  PROJECT_ROLE_PERMISSIONS,
  PROJECT_ROLES,
  type AddProjectMemberRequest,
  type CreateProjectRequest,
  type Invitation,
  type ProjectRoleMatrix,
} from '@taleart/contract';
import {
  addMemberByEmail,
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
  createInvitation,
  createProject,
  listPendingInvitations,
  listProjectAuditLog,
  listProjectMembers,
  listProjects,
  projectExists,
  removeMember,
  revokeInvitation,
  updateMember,
} from '@taleart/server-access';
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { caller, projectPermission, requireAdmin } from './authorize';
import { requireAllProjects, sessionOnly } from './credentials';
import { HttpError } from './errors';
import { accessEndField, onlyFields, projectRoleField, requiredString } from './validation';

export interface ProjectsOptions {
  /** The dashboard's origin (RP_ORIGIN); invitation links point there. */
  dashboardOrigin: string;
}

/** `GET /roles`: the role and permission matrix, for the dashboard and the docs. Any signed-in caller. */
export function rolesRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    const body: ProjectRoleMatrix = {
      roles: PROJECT_ROLES.map((role) => ({ role, permissions: [...PROJECT_ROLE_PERMISSIONS[role]] })),
      permissions: [...PROJECT_PERMISSIONS],
    };
    res.json(body);
  });
  return router;
}

export function projectsRouter(pool: Pool, { dashboardOrigin }: ProjectsOptions): Router {
  const router = Router();

  // The routes below answer 404 for a project that does not exist; the permission check passes it.
  const membersAccess = projectPermission(pool, 'members.manage');
  const viewAccess = projectPermission(pool, 'project.view');
  const existing: RequestHandler = async (req, _res, next) => {
    try {
      if (!(await projectExists(pool, req.params['projectId'] ?? ''))) {
        throw new HttpError(404, ErrorCodes.projectNotFound, 'No project has this id');
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  // Admins see every project, content managers their own, each with the caller's role in it (AD-4).
  router.get('/', async (_req, res, next) => {
    try {
      res.json(await listProjects(pool, caller(res)));
    } catch (err) {
      next(err);
    }
  });

  // An admin's API token creates a project only when it covers all of the admin's projects.
  router.post('/', requireAdmin, requireAllProjects, async (req, res, next) => {
    try {
      const input: CreateProjectRequest = { name: requiredString(req.body, 'name') };
      res.status(201).json(await createProject(pool, input));
    } catch (err) {
      next(err);
    }
  });

  // Pending invitations; the links are not kept, only their hashes.
  router.get('/:projectId/invitations', membersAccess, existing, async (req, res, next) => {
    try {
      res.json(await listPendingInvitations(pool, req.params.projectId));
    } catch (err) {
      next(err);
    }
  });

  // One-time invitation link; the token is in this response only (AD-9). It mints a new person's
  // passkey, so only a passkey session may create one, never an API token.
  router.post('/:projectId/invitations', sessionOnly, membersAccess, existing, async (req, res, next) => {
    try {
      const { projectId } = req.params;
      onlyFields(req.body, ['role', 'accessExpiresAt']);
      const role = projectRoleField(req.body, 'role', false);
      const accessExpiresAt = accessEndField(req.body, 'accessExpiresAt');
      const user = caller(res);
      const invitation = await createInvitation(pool, {
        projectId,
        createdBy: { id: user.id, name: user.name },
        role,
        accessExpiresAt,
      });
      const body: Invitation = {
        id: invitation.id,
        projectId: invitation.projectId,
        url: `${dashboardOrigin}${invitationPath(invitation.token)}`,
        expiresAt: invitation.expiresAt.toISOString(),
        role: invitation.role,
        accessExpiresAt: invitation.accessExpiresAt?.toISOString() ?? null,
      };
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:projectId/invitations/:invitationId', sessionOnly, membersAccess, existing, async (req, res, next) => {
    try {
      const user = caller(res);
      await revokeInvitation(pool, req.params.projectId, user, req.params.invitationId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/:projectId/members', viewAccess, existing, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await listProjectMembers(pool, req.params.projectId, caller(res).id));
    } catch (err) {
      next(err);
    }
  });

  // Gives an existing user access: it elevates someone, so a passkey session only, like an invitation.
  router.post('/:projectId/members', sessionOnly, membersAccess, existing, async (req, res, next) => {
    try {
      onlyFields(req.body, ['email', 'role', 'expiresAt']);
      const input: AddProjectMemberRequest = {
        email: requiredString(req.body, 'email'),
        role: projectRoleField(req.body, 'role', true) as AddProjectMemberRequest['role'],
      };
      const expiresAt = accessEndField(req.body, 'expiresAt') ?? null;
      res.status(201).json(await addMemberByEmail(pool, req.params.projectId, caller(res), { ...input, expiresAt }));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:projectId/members/:userId', sessionOnly, membersAccess, existing, async (req, res, next) => {
    try {
      onlyFields(req.body, ['role', 'expiresAt']);
      const role = projectRoleField(req.body, 'role', false);
      const expiresAt = accessEndField(req.body, 'expiresAt');
      if (role === undefined && expiresAt === undefined) {
        throw new HttpError(400, ErrorCodes.validationFailed, 'Send role, expiresAt or both');
      }
      res.json(
        await updateMember(pool, req.params.projectId, caller(res), req.params.userId, {
          ...(role !== undefined && { role }),
          ...(expiresAt !== undefined && { expiresAt }),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:projectId/members/:userId', sessionOnly, membersAccess, existing, async (req, res, next) => {
    try {
      await removeMember(pool, req.params.projectId, caller(res), req.params.userId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/:projectId/audit-log', membersAccess, existing, async (req, res, next) => {
    try {
      const { limit, before } = req.query;
      let size: number | undefined;
      if (limit !== undefined) {
        size = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
        if (!(size >= 1 && size <= AUDIT_LOG_MAX_LIMIT)) {
          throw new HttpError(400, ErrorCodes.validationFailed, `limit must be a number from 1 to ${AUDIT_LOG_MAX_LIMIT}`);
        }
      }
      if (before !== undefined && typeof before !== 'string') {
        throw new HttpError(400, ErrorCodes.validationFailed, 'before must be an entry id');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(
        await listProjectAuditLog(pool, req.params.projectId, { limit: size ?? AUDIT_LOG_DEFAULT_LIMIT, before: before as string | undefined }),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
