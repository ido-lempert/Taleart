import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { PasswordThrottle, PASSWORD_FAILURES_BEFORE_WAIT } from './throttle';
import { signInWithPassword } from './passwordSignIn';
import { SignInFailedError, SignInThrottledError } from './errors';

/** A fake database: password sign-in on, no user for any name, and each query yields so requests overlap. */
function slowDb(): Db {
  const query = async (sql: string) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (sql.includes('auth_settings')) return { rows: [{ passkeyEnabled: true, passwordEnabled: true }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  return { query } as unknown as Db;
}

async function outcome(promise: Promise<unknown>): Promise<'failed' | 'throttled' | 'other'> {
  try {
    await promise;
    return 'other';
  } catch (err) {
    if (err instanceof SignInFailedError) return 'failed';
    if (err instanceof SignInThrottledError) return 'throttled';
    return 'other';
  }
}

describe('password sign-in throttle', () => {
  it('counts overlapping guesses for one username before any of them finishes', async () => {
    const throttle = new PasswordThrottle();
    const db = slowDb();
    const attempts = Array.from({ length: 8 }, (_, i) =>
      outcome(signInWithPassword(db, throttle, { username: 'alice', password: `guess-${i}` })),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === 'failed')).toHaveLength(PASSWORD_FAILURES_BEFORE_WAIT);
    expect(results.filter((r) => r === 'throttled')).toHaveLength(8 - PASSWORD_FAILURES_BEFORE_WAIT);
  });

  it('still allows five wrong guesses in a row and then throttles, one at a time', async () => {
    const throttle = new PasswordThrottle();
    const db = slowDb();
    const results: string[] = [];
    for (let i = 0; i < 7; i++) {
      results.push(await outcome(signInWithPassword(db, throttle, { username: 'bob', password: `guess-${i}` })));
    }
    expect(results).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'throttled', 'throttled']);
  });
});
