import { createHash } from 'node:crypto';
import { INVITATION_TTL_MS } from '@taleart/contract';
import type { TransactionalDb } from './db';
import { EmailTakenError, InvitationInvalidError, PasskeyFailedError } from './errors';
import { createInvitation, finishInvitation, previewInvitation, startInvitation } from './invitations';
import { accessibleProjectIds, canAccessProject } from './members';
import type { PasskeyVerifier } from './passkey-verifier';

type FakeDb = TransactionalDb & { query: ReturnType<typeof vi.fn> };

// A Db whose answers are picked by the first SQL fragment the query contains.
// connect() hands out the same fake, so transactions run on it too.
function fakeDb(answers: Record<string, unknown[]>): FakeDb {
  const query = vi.fn(async (sql: string) => {
    const key = Object.keys(answers).find((k) => sql.includes(k));
    const rows = key ? answers[key] : [];
    return { rows, rowCount: rows.length };
  });
  const db = { query } as unknown as FakeDb;
  db.connect = async () => ({ query, release: vi.fn() }) as never;
  return db;
}

const sql = (db: FakeDb): string[] => db.query.mock.calls.map(([text]) => String(text));
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const verifier: PasskeyVerifier = {
  creationOptions: vi.fn(async () => ({ challenge: 'c1' })),
  verifyRegistration: vi.fn(async () => ({
    credentialId: 'cred',
    publicKey: new Uint8Array([1]),
    counter: 0,
    transports: [],
  })),
  requestOptions: vi.fn(),
  verifyAuthentication: vi.fn(),
};

const projectId = '00000000-0000-4000-8000-000000000001';
const invitationRow = { id: 'i1', projectId, projectName: 'Acme', expiresAt: new Date('2026-10-27T00:00:00Z') };
const challengeId = '00000000-0000-4000-8000-000000000000';

describe('membership', () => {
  const manager = { id: 'u2', role: 'content_manager' as const };

  it('gives admins every project without a query', async () => {
    const db = fakeDb({});
    expect(await accessibleProjectIds(db, { id: 'u1', role: 'admin' })).toBe('all');
    expect(await canAccessProject(db, { id: 'u1', role: 'admin' }, projectId)).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("gives a content manager only their projects", async () => {
    const member = fakeDb({ project_members: [{ project_id: projectId }] });
    expect(await accessibleProjectIds(member, manager)).toEqual([projectId]);
    expect(await canAccessProject(member, manager, projectId)).toBe(true);
    expect(await canAccessProject(fakeDb({}), manager, projectId)).toBe(false);
    const db = fakeDb({});
    expect(await canAccessProject(db, manager, 'not-a-uuid')).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('invitations', () => {
  it('stores only the hash of a 32-byte token and expires it after 7 days', async () => {
    const db = fakeDb({ 'INSERT INTO invitations': [{ id: 'i1' }] });
    const before = Date.now();
    const invitation = await createInvitation(db, { projectId, createdBy: 'u1' });
    expect(Buffer.from(invitation.token, 'base64url')).toHaveLength(32);
    expect(invitation.expiresAt.getTime() - before).toBeGreaterThanOrEqual(INVITATION_TTL_MS - 1000);
    expect(db.query.mock.calls[0][1]).toEqual([projectId, sha256(invitation.token), 'u1', invitation.expiresAt]);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(invitation.token);
  });

  it('previews a valid invitation by the hash of its token', async () => {
    const db = fakeDb({ 'JOIN projects': [invitationRow] });
    expect(await previewInvitation(db, 'tok')).toEqual({ projectName: 'Acme', expiresAt: '2026-10-27T00:00:00.000Z' });
    expect(db.query.mock.calls[0][1]).toEqual([sha256('tok')]);
  });

  it('refuses an unknown, used or expired invitation', async () => {
    await expect(previewInvitation(fakeDb({}), 'tok')).rejects.toBeInstanceOf(InvitationInvalidError);
    await expect(previewInvitation(fakeDb({}), undefined)).rejects.toBeInstanceOf(InvitationInvalidError);
  });

  it('refuses to start with an email that has a user', async () => {
    const db = fakeDb({ 'JOIN projects': [invitationRow], 'FROM users': [{ '?column?': 1 }] });
    await expect(startInvitation(db, verifier, 'tok', { name: 'Cy', email: 'cy@x.io' })).rejects.toBeInstanceOf(
      EmailTakenError,
    );
  });

  function redeemDb(overrides: Record<string, unknown[]> = {}): FakeDb {
    return fakeDb({
      'JOIN projects': [invitationRow],
      'DELETE FROM auth_challenges': [
        {
          purpose: 'invitation',
          challenge: 'c1',
          data: { name: 'Cy', email: 'cy@x.io', userHandle: 'h', invitationId: 'i1' },
          valid: true,
        },
      ],
      'FOR UPDATE': [{ valid: true }],
      'INSERT INTO users': [{ id: 'u2', name: 'Cy', email: 'cy@x.io', role: 'content_manager' }],
      ...overrides,
    });
  }

  it('creates a content manager, their passkey and membership, uses the invitation and signs them in', async () => {
    const db = redeemDb();
    const joined = await finishInvitation(db, verifier, 'tok', challengeId, { id: 'cred' });
    expect(joined.user.role).toBe('content_manager');
    expect(joined.projectId).toBe(projectId);
    expect(joined.session.token).toEqual(expect.any(String));
    const statements = sql(db);
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
    expect(statements.some((s) => s.includes("'content_manager'"))).toBe(true);
    expect(db.query.mock.calls.find(([s]) => String(s).includes('INSERT INTO project_members'))?.[1]).toEqual([
      projectId,
      'u2',
    ]);
    expect(db.query.mock.calls.find(([s]) => String(s).startsWith('UPDATE invitations'))?.[1]).toEqual(['i1', 'u2']);
  });

  it('refuses a link used meanwhile and rolls back', async () => {
    const db = redeemDb({ 'FOR UPDATE': [{ valid: false }] });
    await expect(finishInvitation(db, verifier, 'tok', challengeId, { id: 'cred' })).rejects.toBeInstanceOf(
      InvitationInvalidError,
    );
    expect(sql(db)).toContain('ROLLBACK');
    expect(sql(db).some((s) => s.includes('INSERT INTO users'))).toBe(false);
  });

  it('refuses a challenge started for another invitation', async () => {
    const db = redeemDb({
      'DELETE FROM auth_challenges': [
        { purpose: 'invitation', challenge: 'c1', data: { invitationId: 'other' }, valid: true },
      ],
    });
    await expect(finishInvitation(db, verifier, 'tok', challengeId, { id: 'cred' })).rejects.toBeInstanceOf(
      PasskeyFailedError,
    );
  });
});
