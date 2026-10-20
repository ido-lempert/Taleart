import { createHash } from 'node:crypto';
import { finishSignIn, startSetup } from './auth';
import { consumeChallenge } from './challenges';
import type { Db } from './db';
import { PasskeyFailedError, SetupClosedError } from './errors';
import { SimpleWebAuthnVerifier, type PasskeyVerifier } from './passkey-verifier';
import { createSession, findSessionUser, hashSessionToken, SESSION_TTL_MS } from './sessions';

type Rows = { rows: unknown[]; rowCount: number };
const result = (rows: unknown[]): Rows => ({ rows, rowCount: rows.length });

// A Db whose answers are picked by the first SQL fragment the query contains.
function fakeDb(answers: Record<string, unknown[]>): Db & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (sql: string) => {
    const key = Object.keys(answers).find((k) => sql.includes(k));
    return result(key ? answers[key] : []);
  });
  return { query } as unknown as Db & { query: ReturnType<typeof vi.fn> };
}

const verifier: PasskeyVerifier = {
  creationOptions: vi.fn(async () => ({ challenge: 'c1' })),
  verifyRegistration: vi.fn(),
  requestOptions: vi.fn(async () => ({ challenge: 'c2' })),
  verifyAuthentication: vi.fn(async () => 0),
};

const rp = { name: 'TaleArt', id: 'localhost', origin: 'http://localhost:4200' };

describe('sessions', () => {
  it('stores only the SHA-256 hash of a 32-byte token and expires it after 7 days', async () => {
    const db = fakeDb({});
    const before = Date.now();
    const { token, expiresAt } = await createSession(db, 'u1');
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(SESSION_TTL_MS - 1000);

    const insert = db.query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO sessions'));
    expect(insert?.[1]).toEqual(['u1', createHash('sha256').update(token).digest('hex'), expiresAt]);
    expect(JSON.stringify(db.query.mock.calls)).not.toContain(token);
  });

  it('looks a session up by hash and finds nobody without a token', async () => {
    const db = fakeDb({ 'FROM sessions': [{ id: 'u1', name: 'Ada', email: 'a@x.io', role: 'admin' }] });
    expect(await findSessionUser(db, undefined)).toBeNull();
    expect(await findSessionUser(db, 'tok')).toEqual({ id: 'u1', name: 'Ada', email: 'a@x.io', role: 'admin' });
    expect(db.query.mock.calls[0][1]).toEqual([hashSessionToken('tok')]);
  });
});

describe('challenges', () => {
  const id = '00000000-0000-4000-8000-000000000000';

  it('ignores ids that are not UUIDs', async () => {
    const db = fakeDb({});
    expect(await consumeChallenge(db, 'nope', 'setup')).toBeNull();
    expect(await consumeChallenge(db, undefined, 'setup')).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuses an expired challenge or one of another purpose', async () => {
    const expired = fakeDb({ DELETE: [{ purpose: 'setup', challenge: 'c', data: {}, valid: false }] });
    expect(await consumeChallenge(expired, id, 'setup')).toBeNull();
    const other = fakeDb({ DELETE: [{ purpose: 'sign-in', challenge: 'c', data: {}, valid: true }] });
    expect(await consumeChallenge(other, id, 'setup')).toBeNull();
    const ok = fakeDb({ DELETE: [{ purpose: 'setup', challenge: 'c', data: { a: 1 }, valid: true }] });
    expect(await consumeChallenge(ok, id, 'setup')).toEqual({ challenge: 'c', data: { a: 1 } });
  });
});

describe('setup', () => {
  it('is closed once a user exists', async () => {
    const db = fakeDb({ 'FROM users': [{ '?column?': 1 }] });
    await expect(startSetup(db, verifier, { name: 'Ada', email: 'a@x.io' })).rejects.toBeInstanceOf(SetupClosedError);
  });
});

describe('sign-in', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  const passkeyRow = {
    id: 'pk1',
    user_id: 'u1',
    webauthn_user_id: 'handle',
    credential_id: 'cred',
    public_key: Buffer.from([1, 2]),
    counter: '5',
    transports: [],
  };

  function db() {
    return fakeDb({
      'DELETE FROM auth_challenges': [{ purpose: 'sign-in', challenge: 'c2', data: {}, valid: true }],
      'FROM passkeys': [passkeyRow],
      'FROM users': [{ id: 'u1', name: 'Ada', email: 'a@x.io', role: 'admin' }],
    });
  }

  it('refuses a counter that did not grow', async () => {
    const v = { ...verifier, verifyAuthentication: vi.fn(async () => 5) };
    await expect(finishSignIn(db(), v, id, { id: 'cred', response: {} })).rejects.toBeInstanceOf(PasskeyFailedError);
  });

  it('refuses a user handle of another user', async () => {
    const v = { ...verifier, verifyAuthentication: vi.fn(async () => 6) };
    await expect(
      finishSignIn(db(), v, id, { id: 'cred', response: { userHandle: 'other' } }),
    ).rejects.toBeInstanceOf(PasskeyFailedError);
  });

  it('stores the new counter and starts a session', async () => {
    const d = db();
    const v = { ...verifier, verifyAuthentication: vi.fn(async () => 6) };
    const signedIn = await finishSignIn(d, v, id, { id: 'cred', response: { userHandle: 'handle' } });
    expect(signedIn.user.id).toBe('u1');
    expect(signedIn.session.token).toEqual(expect.any(String));
    const update = d.query.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE passkeys'));
    expect(update?.[1]).toEqual(['pk1', 6]);
  });
});

describe('SimpleWebAuthnVerifier', () => {
  it('asks for a discoverable passkey with user verification', async () => {
    const options = await new SimpleWebAuthnVerifier(rp).creationOptions({
      userHandle: Buffer.from('handle').toString('base64url'),
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(options).toMatchObject({
      challenge: expect.any(String),
      rp: { name: 'TaleArt', id: 'localhost' },
      user: { name: 'ada@example.com', displayName: 'Ada', id: Buffer.from('handle').toString('base64url') },
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
  });

  it('asks for any discoverable passkey on sign-in', async () => {
    const options = await new SimpleWebAuthnVerifier(rp).requestOptions();
    expect(options).toMatchObject({ challenge: expect.any(String), rpId: 'localhost', userVerification: 'required' });
    expect((options as { allowCredentials?: unknown[] }).allowCredentials ?? []).toEqual([]);
  });

  it('turns a malformed response into PasskeyFailedError', async () => {
    await expect(new SimpleWebAuthnVerifier(rp).verifyRegistration({ id: 'x' }, 'c')).rejects.toBeInstanceOf(
      PasskeyFailedError,
    );
  });
});
