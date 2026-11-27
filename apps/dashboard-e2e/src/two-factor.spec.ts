import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { e2eDatabase } from '../scripts/e2e-database.mjs';
import { axeViolations } from './axe';
import { emptyInstall } from './session';

/**
 * Two-factor sign-in (epic two-factor, stories 8.x): the first admin sets up with a username and password,
 * turns the authenticator app on from My sign-in methods (the secret typed, the QR code shown, the recovery
 * codes saved), signs in with a code, uses a recovery code once, is held to Required, and turns the app off.
 * One fresh install, run in order. The codes are computed here from the secret, RFC 6238: HMAC-SHA1, six
 * digits, 30-second steps.
 *
 * E2E_SCREENSHOTS, when set, is a folder the tests save screenshots in.
 */

const shots = process.env['E2E_SCREENSHOTS'];
if (shots) mkdirSync(shots, { recursive: true });

const USERNAME = 'ada';
const PASSWORD = 'Correct-Horse-Battery-2026';

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await new Promise((resolve) => setTimeout(resolve, 300));
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// RFC 4648 base32, as the typed secret is written (spaces and case ignored).
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/\s+/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`Not a base32 character: ${char}`);
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// RFC 6238 over RFC 4226: the HMAC-SHA1 of the 30-second step as an 8-byte counter, dynamic truncation, six digits.
function totp(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}

const stepNow = (): number => Math.floor(Date.now() / 30_000);

/**
 * A step the server takes now: it accepts one step either side of now, and never a step at or before the last
 * one it accepted. Waits for the next step when the last accepted one is already the step after now.
 */
async function usableStep(lastStep: number): Promise<number> {
  while (lastStep > stepNow()) await sleep(30_000 - (Date.now() % 30_000) + 50);
  return Math.max(stepNow(), lastStep + 1);
}

/** A fresh install: no user, no sign-in settings left by a spec before this one. */
async function resetInstall(): Promise<void> {
  const client = new pg.Client({ connectionString: e2eDatabase(process.env).url });
  await client.connect();
  try {
    await client.query('DELETE FROM auth_settings');
  } finally {
    await client.end();
  }
  await emptyInstall();
}

test.describe.serial('two-factor sign-in (authenticator app and recovery codes)', () => {
  let context: BrowserContext;
  let page: Page;
  let secret = Buffer.alloc(0);
  let recoveryCodes: string[] = [];
  // The last step the server accepted for the app's code: the enrolment's, then each sign-in's.
  let lastStep = -1;

  async function signOut(): Promise<void> {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('#sign-in-username')).toBeVisible();
  }

  async function signInWithPassword(): Promise<void> {
    await page.locator('#sign-in-username').fill(USERNAME);
    await page.locator('#sign-in-password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in with a password' }).click();
  }

  test.beforeAll(async ({ browser }) => {
    await resetInstall();
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
    await resetInstall();
  });

  test('the first admin sets up with a username and password', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Set up TaleArt' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Ada Admin');
    await page.getByLabel('Email', { exact: true }).fill('ada@example.test');
    await page.locator('#setup-username').fill(USERNAME);
    await page.locator('#setup-password').fill(PASSWORD);
    await page.locator('#setup-confirm').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account with password' }).click();
    await expect(page).toHaveURL(/\/zones$/);
  });

  test('Settings > Sign-in methods chooses Optional two-factor sign-in', async () => {
    await page.goto('/settings/sign-in-methods');
    const optional = page.getByRole('radio', { name: /^Optional/ });
    await optional.click();
    await expect(optional).toBeChecked();
    await page.reload();
    await expect(page.getByRole('radio', { name: /^Optional/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /^Off/ })).not.toBeChecked();
    await shot(page, '01-sign-in-methods-optional');
  });

  test('My sign-in methods sets up the app, shows the codes and says On', async () => {
    await page.goto('/settings/my-sign-in-methods');
    await expect(page.locator('#two-factor-state')).toHaveText('Not set up');
    await page.locator('#two-factor-set-up').click();

    const typed = /([A-Z2-7]{4}(?: [A-Z2-7]{4}){7})/.exec((await page.locator('#two-factor-secret').textContent()) ?? '');
    expect(typed).not.toBeNull();
    secret = base32Decode(typed![1]);
    expect(secret.length).toBe(20);
    await expect(page.locator('img.totp-qr')).toBeVisible();
    await expect(page.locator('#two-factor-uri')).toContainText('otpauth://totp/');
    await shot(page, '02-authenticator-set-up');
    expect(await axeViolations(page)).toEqual([]);

    // The code for this step turns the app on; the server keeps this step as spent.
    lastStep = stepNow();
    await page.locator('#two-factor-code').fill(totp(secret, lastStep));
    await page.locator('#two-factor-confirm').click();

    await expect(page.locator('#recovery-codes-list li')).toHaveCount(10);
    const codes = await page.locator('#recovery-codes-list li').allInnerTexts();
    recoveryCodes = codes;
    await shot(page, '03-recovery-codes');
    expect(await axeViolations(page)).toEqual([]);
    await page.locator('#recovery-codes-saved').click();
    await expect(page.locator('#recovery-codes-list')).toHaveCount(0);
    await expect(page.locator('#two-factor-state')).toHaveText('On');
    await expect(page.locator('#two-factor-left')).toHaveText('10 recovery codes left');
  });

  test('signs in with the password and the app code; a wrong code is refused', async () => {
    await signOut();
    await signInWithPassword();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    await shot(page, '04-code-screen');
    expect(await axeViolations(page)).toEqual([]);

    // No session yet: the dashboard sends a stranger back to sign-in (on another page, as this one keeps the code screen).
    const other = await context.newPage();
    await other.goto('/zones');
    await expect(other).toHaveURL(/\/sign-in/);
    await other.close();

    await page.locator('#sign-in-code').fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('#sign-in-code-error')).toBeVisible();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);

    // The code for the next step: the step used at enrolment is spent.
    const step = stepNow() + 1;
    await page.locator('#sign-in-code').fill(totp(secret, step));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/zones$/);
    lastStep = step;
  });

  test('a recovery code signs in once', async () => {
    await signOut();
    await signInWithPassword();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await expect(page.getByLabel('Recovery code')).toBeVisible();
    await page.locator('#sign-in-code').fill(recoveryCodes[0]);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/zones$/);

    await signOut();
    await signInWithPassword();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await page.locator('#sign-in-code').fill(recoveryCodes[0]);
    await page.getByRole('button', { name: 'Verify' }).click();
    // Refused: the sign-in stays on the page with the error (the second step may have ended, so the password is asked again).
    await expect(page.locator('#sign-in-code-error, #sign-in-password-error')).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
    await shot(page, '05-recovery-code-refused');
  });

  test('Required: the enrolled admin still gets the code screen', async () => {
    // The previous test ended on the sign-in page (not signed in): back in with the app's code first.
    await page.goto('/sign-in');
    await signInWithPassword();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    lastStep = await usableStep(lastStep);
    await page.locator('#sign-in-code').fill(totp(secret, lastStep));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/zones$/);

    await page.goto('/settings/sign-in-methods');
    const required = page.getByRole('radio', { name: /^Required/ });
    await required.click();
    await expect(required).toBeChecked();
    await page.reload();
    await expect(page.getByRole('radio', { name: /^Required/ })).toBeChecked();

    // Enrolled already, so the code screen is what Required asks for at sign-in.
    await signOut();
    await signInWithPassword();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    await shot(page, '06-required-code-screen');
    lastStep = await usableStep(lastStep);
    await page.locator('#sign-in-code').fill(totp(secret, lastStep));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/zones$/);
  });

  test('turning the app off: not while Required, and with a recovery code when Optional', async () => {
    await page.goto('/settings/my-sign-in-methods');
    await expect(page.locator('#two-factor-state')).toHaveText('On');
    await expect(page.locator('#two-factor-off-start')).toHaveCount(0);
    await shot(page, '06-required-no-turn-off');

    await page.goto('/settings/sign-in-methods');
    await page.getByRole('radio', { name: /^Optional/ }).click();
    await expect(page.getByRole('radio', { name: /^Optional/ })).toBeChecked();

    await page.goto('/settings/my-sign-in-methods');
    await page.locator('#two-factor-off-start').click();
    await page.locator('#two-factor-off-code').fill(recoveryCodes[1]);
    await page.locator('#two-factor-off-confirm').click();
    await expect(page.locator('#two-factor-state')).toHaveText('Not set up');
    expect(await axeViolations(page)).toEqual([]);

    // The password alone signs in now.
    await signOut();
    await signInWithPassword();
    await expect(page).toHaveURL(/\/zones$/);
    await expect(page.getByLabel('Authenticator code')).toHaveCount(0);
  });
});
