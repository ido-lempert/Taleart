import type { User } from '@taleart/contract';
import {
  addMemberByEmail,
  createApiToken,
  createInvitation,
  createUser,
  listUsers,
  revokeApiToken,
  type TransactionalDb,
} from '@taleart/server-access';
import { DEMO_TEAM, seedDemo, type SeedClient } from '@taleart/seed-demo';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The demo seed's token lives this long at most; it is revoked as soon as the seed ends. */
const TOKEN_TTL_MS = 15 * 60 * 1000;

type Log = (level: 'info' | 'warn' | 'error', msg: string, err?: unknown) => void;

/**
 * A Management API client over `fetch` that talks to this very process, with a bearer token. It is the
 * client the CLI would use, so the seed goes through the API's own routes and checks.
 */
export function loopbackClient(apiUrl: string, token: string): SeedClient {
  return {
    async request<T>(method: string, path: string, options: { json?: unknown; body?: Blob; contentType?: string } = {}): Promise<T> {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      let body: string | Blob | undefined;
      if (options.body !== undefined) {
        body = options.body;
        headers['Content-Type'] = options.contentType ?? (options.body.type || 'application/octet-stream');
      } else if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(`${apiUrl}/api/v1${path}`, { method, headers, body, signal: AbortSignal.timeout(60_000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
      return (text === '' ? null : JSON.parse(text)) as T;
    },
  };
}

/**
 * The people of the demo team, made with the access module because no API token may create a user or
 * an invitation: members who have no way to sign in (no passkey, password or provider), one whose access
 * ends soon and one whose access has ended, and two pending invitations. Emails are example.com's.
 */
export async function seedDemoTeam(pool: TransactionalDb, projectId: string, admin: User, now: Date = new Date()): Promise<void> {
  const actor = { id: admin.id, name: admin.name, role: admin.role };
  for (const member of DEMO_TEAM.members) {
    await createUser(pool, { name: member.name, email: member.email, role: 'content_manager' });
    await addMemberByEmail(pool, projectId, actor, {
      email: member.email,
      role: member.role,
      expiresAt: member.expiresInDays === null ? null : new Date(now.getTime() + member.expiresInDays * DAY_MS),
    });
  }
  for (const invitation of DEMO_TEAM.invitations) {
    await createInvitation(pool, {
      projectId,
      createdBy: { id: admin.id, name: admin.name },
      role: invitation.role,
      accessExpiresAt: invitation.accessExpiresInDays === null ? null : new Date(now.getTime() + invitation.accessExpiresInDays * DAY_MS),
    });
  }
}

/**
 * TALEART_SEED_DEMO=true: seeds the demo project for the first admin, right after setup. It runs only
 * when that admin is the one user the install has, with a short-lived API token of theirs that it
 * revokes at the end, through the API's own port. A failure is logged and leaves the install usable.
 */
export function seedDemoOnSetup(pool: TransactionalDb, apiUrl: string, log: Log): (admin: User) => void {
  return (admin) => {
    void (async () => {
      const { users } = await listUsers(pool);
      if (users.length !== 1 || users[0].id !== admin.id) {
        log('info', 'Demo seed skipped: the install has other users');
        return;
      }
      const issued = await createApiToken(pool, {
        userId: admin.id,
        name: 'Demo seed (temporary)',
        projectIds: null,
        readOnly: false,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      });
      try {
        const result = await seedDemo(loopbackClient(apiUrl, issued.token), {
          log: (message) => log('info', `Demo seed: ${message}`),
          afterProject: (project) => seedDemoTeam(pool, project.id, admin),
        });
        log('info', `Demo seed: ${result.status}`);
      } finally {
        await revokeApiToken(pool, admin.id, issued.id);
      }
    })().catch((err) => log('error', 'Demo seed failed', err));
  };
}
