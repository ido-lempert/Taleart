import type {
  PendingInvitation,
  ProjectAuditAction,
  ProjectAuditEntry,
  ProjectAuditLog,
  ProjectMember,
  ProjectRole,
  UserRole,
} from '@taleart/contract';
import { inTransaction, type Db, type TransactionalDb } from './db';
import {
  InvitationNotFoundError,
  LastProjectAdminError,
  MemberExistsError,
  MemberNotFoundError,
  UserNotFoundError,
} from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many audit entries a page holds by default, and at most. */
export const AUDIT_LOG_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_MAX_LIMIT = 200;

/** Who makes a change: recorded in the audit log, and a global admin may do what a project admin may not. */
export interface Actor {
  id: string;
  name: string;
  role: UserRole;
}

/** Writes one audit entry; call it inside the transaction of the change it records. */
export async function recordProjectAudit(
  db: Db,
  entry: {
    projectId: string;
    actor: { id: string | null; name: string };
    action: ProjectAuditAction;
    targetUserId?: string | null;
    targetEmail?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO project_audit_log (project_id, actor_id, actor_name, action, target_user_id, target_email, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.projectId,
      entry.actor.id,
      entry.actor.name,
      entry.action,
      entry.targetUserId ?? null,
      entry.targetEmail ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}

interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: ProjectRole;
  globalRole: UserRole;
  expiresAt: Date | null;
  expired: boolean;
  joinedAt: Date;
}

const MEMBER_SELECT = `SELECT u.id AS "userId", u.name, u.email, m.role, u.role AS "globalRole",
       m.expires_at AS "expiresAt", (m.expires_at IS NOT NULL AND m.expires_at <= now()) AS expired,
       m.created_at AS "joinedAt"
  FROM project_members m JOIN users u ON u.id = m.user_id`;

function memberOf(row: MemberRow, callerId: string): ProjectMember {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    globalRole: row.globalRole,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    expired: row.expired,
    joinedAt: row.joinedAt.toISOString(),
    you: row.userId === callerId,
  };
}

/** The project's explicit members, oldest first, expired ones included and marked. */
export async function listProjectMembers(db: Db, projectId: string, callerId: string): Promise<ProjectMember[]> {
  const { rows } = await db.query<MemberRow>(
    `${MEMBER_SELECT} WHERE m.project_id = $1 ORDER BY m.created_at, u.id`,
    [projectId],
  );
  return rows.map((row) => memberOf(row, callerId));
}

async function memberRow(db: Db, projectId: string, userId: string, lock = false): Promise<MemberRow | undefined> {
  if (!UUID.test(userId)) return undefined;
  const { rows } = await db.query<MemberRow>(
    `${MEMBER_SELECT} WHERE m.project_id = $1 AND m.user_id = $2${lock ? ' FOR UPDATE OF m' : ''}`,
    [projectId, userId],
  );
  return rows[0];
}

// Refuses a change that takes the project's last active admin member away, unless a global admin makes it.
// The project's admin memberships are locked first, so two such changes at once cannot both pass.
async function guardLastAdmin(tx: Db, projectId: string, actor: Actor, target: MemberRow): Promise<void> {
  if (actor.role === 'admin') return;
  await tx.query(`SELECT 1 FROM project_members WHERE project_id = $1 AND role = 'admin' FOR UPDATE`, [projectId]);
  const { rows } = await tx.query<{ others: number }>(
    `SELECT count(*)::int AS others FROM project_members
      WHERE project_id = $1 AND role = 'admin' AND user_id <> $2 AND (expires_at IS NULL OR expires_at > now())`,
    [projectId, target.userId],
  );
  if (rows[0].others === 0) throw new LastProjectAdminError();
}

const isActiveAdmin = (row: MemberRow): boolean => row.role === 'admin' && !row.expired;

/**
 * Adds an existing user, found by email, to the project with a role. {@link UserNotFoundError} when
 * no user has the email; {@link MemberExistsError} when they are a member already (expired or not).
 */
export async function addMemberByEmail(
  db: TransactionalDb,
  projectId: string,
  actor: Actor,
  input: { email: string; role: ProjectRole; expiresAt: Date | null },
): Promise<ProjectMember> {
  return inTransaction(db, async (tx) => {
    const { rows: users } = await tx.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE lower(email) = lower($1)',
      [input.email.trim()],
    );
    const user = users[0];
    if (!user) throw new UserNotFoundError();
    const inserted = await tx.query(
      `INSERT INTO project_members (project_id, user_id, role, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [projectId, user.id, input.role, input.expiresAt],
    );
    if ((inserted.rowCount ?? 0) === 0) throw new MemberExistsError();
    await recordProjectAudit(tx, {
      projectId,
      actor,
      action: 'member_added',
      targetUserId: user.id,
      targetEmail: user.email,
      detail: { role: input.role, expiresAt: input.expiresAt?.toISOString() ?? null },
    });
    return memberOf((await memberRow(tx, projectId, user.id)) as MemberRow, actor.id);
  });
}

/**
 * Changes a member's role and/or access expiry (`expiresAt: null` clears it; `undefined` leaves it).
 * Takes the last active admin out only for a global admin ({@link LastProjectAdminError} otherwise).
 */
export async function updateMember(
  db: TransactionalDb,
  projectId: string,
  actor: Actor,
  userId: string,
  patch: { role?: ProjectRole; expiresAt?: Date | null },
): Promise<ProjectMember> {
  return inTransaction(db, async (tx) => {
    const before = await memberRow(tx, projectId, userId, true);
    if (!before) throw new MemberNotFoundError();
    const role = patch.role ?? before.role;
    const expiresAt = patch.expiresAt === undefined ? before.expiresAt : patch.expiresAt;
    const stillActiveAdmin = role === 'admin' && (expiresAt === null || expiresAt.getTime() > Date.now());
    if (isActiveAdmin(before) && !stillActiveAdmin) await guardLastAdmin(tx, projectId, actor, before);
    await tx.query('UPDATE project_members SET role = $3, expires_at = $4 WHERE project_id = $1 AND user_id = $2', [
      projectId,
      userId,
      role,
      expiresAt,
    ]);
    const target = { projectId, actor, targetUserId: before.userId, targetEmail: before.email };
    if (role !== before.role) {
      await recordProjectAudit(tx, { ...target, action: 'role_changed', detail: { from: before.role, to: role } });
    }
    if ((expiresAt?.getTime() ?? null) !== (before.expiresAt?.getTime() ?? null)) {
      await recordProjectAudit(tx, {
        ...target,
        action: 'expiry_changed',
        detail: { from: before.expiresAt?.toISOString() ?? null, to: expiresAt?.toISOString() ?? null },
      });
    }
    return memberOf((await memberRow(tx, projectId, userId)) as MemberRow, actor.id);
  });
}

/** Removes a member. Takes the last active admin out only for a global admin ({@link LastProjectAdminError} otherwise). */
export async function removeMember(db: TransactionalDb, projectId: string, actor: Actor, userId: string): Promise<void> {
  await inTransaction(db, async (tx) => {
    const before = await memberRow(tx, projectId, userId, true);
    if (!before) throw new MemberNotFoundError();
    if (isActiveAdmin(before)) await guardLastAdmin(tx, projectId, actor, before);
    await tx.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    await recordProjectAudit(tx, {
      projectId,
      actor,
      action: 'removed',
      targetUserId: before.userId,
      targetEmail: before.email,
      detail: { role: before.role },
    });
  });
}

/**
 * Called inside the transaction that redeems an invitation: makes the new user a member with the
 * invitation's role and access expiry, and records that they joined.
 */
export async function joinInvitedProject(
  tx: Db,
  invitationId: string,
  user: { id: string; name: string; email: string },
): Promise<void> {
  const { rows } = await tx.query<{ projectId: string; role: ProjectRole; expiresAt: Date | null }>(
    `INSERT INTO project_members (project_id, user_id, role, expires_at)
     SELECT project_id, $2, role, access_expires_at FROM invitations WHERE id = $1
     ON CONFLICT DO NOTHING
     RETURNING project_id AS "projectId", role, expires_at AS "expiresAt"`,
    [invitationId, user.id],
  );
  const joined = rows[0];
  if (!joined) return;
  await recordProjectAudit(tx, {
    projectId: joined.projectId,
    actor: { id: user.id, name: user.name },
    action: 'joined',
    targetUserId: user.id,
    targetEmail: user.email,
    detail: { role: joined.role, expiresAt: joined.expiresAt?.toISOString() ?? null, invitationId },
  });
}

interface PendingRow {
  id: string;
  projectId: string;
  role: ProjectRole;
  accessExpiresAt: Date | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** The project's invitations that are neither used nor expired, newest first. */
export async function listPendingInvitations(db: Db, projectId: string): Promise<PendingInvitation[]> {
  const { rows } = await db.query<PendingRow>(
    `SELECT i.id, i.project_id AS "projectId", i.role, i.access_expires_at AS "accessExpiresAt",
            u.id AS "createdById", u.name AS "createdByName", i.created_at AS "createdAt", i.expires_at AS "expiresAt"
       FROM invitations i LEFT JOIN users u ON u.id = i.created_by
      WHERE i.project_id = $1 AND i.used_at IS NULL AND i.expires_at > now()
      ORDER BY i.created_at DESC, i.id DESC`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    role: row.role,
    accessExpiresAt: row.accessExpiresAt ? row.accessExpiresAt.toISOString() : null,
    createdBy: row.createdById ? { id: row.createdById, name: row.createdByName ?? '' } : null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));
}

/** Revokes a pending invitation of the project: {@link InvitationNotFoundError} when it is unknown, used or expired. */
export async function revokeInvitation(
  db: TransactionalDb,
  projectId: string,
  actor: Actor,
  invitationId: string,
): Promise<void> {
  if (!UUID.test(invitationId)) throw new InvitationNotFoundError();
  await inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ role: ProjectRole }>(
      `DELETE FROM invitations WHERE id = $1 AND project_id = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING role`,
      [invitationId, projectId],
    );
    if (!rows[0]) throw new InvitationNotFoundError();
    await recordProjectAudit(tx, {
      projectId,
      actor,
      action: 'invitation_revoked',
      detail: { invitationId, role: rows[0].role },
    });
  });
}

interface AuditRow {
  id: string;
  action: ProjectAuditAction;
  actorId: string | null;
  actorName: string;
  targetUserId: string | null;
  targetEmail: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}

/**
 * A page of the project's audit log, newest first. `before` is the `nextBefore` of the previous page
 * (an entry id); an unknown one yields an empty page.
 */
export async function listProjectAuditLog(
  db: Db,
  projectId: string,
  options: { limit?: number; before?: string } = {},
): Promise<ProjectAuditLog> {
  const limit = Math.min(Math.max(options.limit ?? AUDIT_LOG_DEFAULT_LIMIT, 1), AUDIT_LOG_MAX_LIMIT);
  const params: unknown[] = [projectId, limit + 1];
  let cursor = '';
  if (options.before !== undefined) {
    if (!UUID.test(options.before)) return { entries: [], nextBefore: null };
    params.push(options.before);
    cursor = `AND (created_at, id) < (SELECT created_at, id FROM project_audit_log WHERE id = $3 AND project_id = $1)`;
  }
  const { rows } = await db.query<AuditRow>(
    `SELECT id, action, actor_id AS "actorId", actor_name AS "actorName", target_user_id AS "targetUserId",
            target_email AS "targetEmail", detail, created_at AS "createdAt"
       FROM project_audit_log
      WHERE project_id = $1 ${cursor}
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    params,
  );
  const page = rows.slice(0, limit);
  const entries: ProjectAuditEntry[] = page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  return { entries, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
}
