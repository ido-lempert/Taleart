import { HttpErrorResponse } from '@angular/common/http';
import {
  ErrorCodes,
  isErrorBody,
  type AuthMethod,
  type AuthProviderKind,
  type components,
  type operations,
} from '@taleart/contract/core';
import { API_BASE } from './dashboard.store';

/*
 * Sign-in methods: the dashboard's helpers, in one file. The provider start, callback and test routes
 * and their types come from the generated contract; only the helpers that build URLs and words live here.
 */

/** Why the provider flow starts: a sign-in, the first admin's setup, an invitation, or linking to the signed-in user. */
export type ProviderPurpose = operations['startProviderSignIn']['parameters']['query']['purpose'];

/** The answer of `POST /auth/providers/{slug}/test`: `ok` with the issuer and endpoints, or a short `code`. */
export type ProviderTestResult = components['schemas']['ProviderTestResult'];

/** Field names of the password forms, for inline errors. */
export type PasswordField = 'username' | 'currentPassword' | 'password' | 'confirm';
export type PasswordFieldErrors = Partial<Record<PasswordField, string>>;

/** A refused password step: the message to show, and the field it belongs to when there is one. */
export interface PasswordRefusal {
  message: string;
  field?: 'username' | 'password';
  /** Seconds to wait, when the API throttled the attempt (429 with Retry-After). */
  retryAfter?: number;
  /** True when the link or invitation the form was for no longer works. */
  invalid?: boolean;
  /** True when setup has already been finished by someone else. */
  closed?: boolean;
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The API's error code of a failed request, or null. */
export function errorCode(err: unknown): string | null {
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.code : null;
}

/** The API's own message for a failed request when it sent the standard body, else the fallback. */
export function errorText(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse && err.status === 0) return 'Could not reach the API. Try again.';
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
}

/** Seconds from a Retry-After header, which is either a number of seconds or an HTTP date. Null when absent or unreadable. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * The URL that starts a provider flow: the browser navigates there and the API redirects to the provider.
 * An invitation names the invitee's email, which the provider's verified email must equal; setup and
 * sign-in take none (the email comes from the provider).
 */
export function providerStartUrl(slug: string, purpose: ProviderPurpose, token?: string, email?: string): string {
  const params = new URLSearchParams({ purpose });
  if (token !== undefined) params.set('token', token);
  if (email !== undefined) params.set('email', email);
  return `${API_BASE}/auth/providers/${encodeURIComponent(slug)}/start?${params.toString()}`;
}

/** A plain check that an address looks like an email: one @, a dot in the domain, no spaces. The API checks the rest. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** `POST` target of the admin's "Test" button. */
export function providerTestUrl(slug: string): string {
  return `${API_BASE}/auth/providers/${encodeURIComponent(slug)}/test`;
}

/** The sign-in method id of a provider: `google`, `apple`, or `oidc:<slug>`. */
export function providerMethodId(kind: AuthProviderKind, slug: string): string {
  return kind === 'oidc' ? `oidc:${slug}` : kind;
}

/** The label of a provider's button: "Continue with Google". */
export function continueLabel(method: Pick<AuthMethod, 'label'>): string {
  return `Continue with ${method.label}`;
}

/**
 * The friendly message for an `auth_error` code the provider callback put in the dashboard's URL.
 * The callback never sends provider text, so the codes are known; anything else gets the generic line.
 */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case ErrorCodes.signInFailed:
      return 'That sign-in did not work. Try another method.';
    case ErrorCodes.signInMethodDisabled:
      return 'That sign-in method is turned off. Try another one.';
    case ErrorCodes.invitationInvalid:
      return 'This invitation is no longer valid. Ask an admin for a new link.';
    case ErrorCodes.emailTaken:
      return 'An account with that email already exists. Sign in instead.';
    case ErrorCodes.providerNotFound:
    case ErrorCodes.secretKeyMissing:
      return 'That sign-in method is not set up yet. Ask an admin.';
    default:
      return 'Signing in with that provider did not finish. Try again.';
  }
}

/** The client-side checks of a password form, before the API sees it. Empty when it can be sent. */
export function checkPasswordForm(
  form: { username?: string; currentPassword?: string; password: string; confirm?: string },
  show: { username: boolean; currentPassword: boolean; confirm: boolean },
): PasswordFieldErrors {
  const found: PasswordFieldErrors = {};
  if (show.username) {
    const username = normalizeUsername(form.username ?? '');
    if (!username) found.username = 'Enter a username.';
    else if (!USERNAME_PATTERN.test(username)) {
      found.username = 'Use 3 to 40 letters, digits, dots, underscores or hyphens.';
    }
  }
  if (show.currentPassword && !form.currentPassword) found.currentPassword = 'Enter your current password.';
  const length = [...form.password].length;
  if (!form.password) found.password = 'Enter a password.';
  else if (length < PASSWORD_MIN_LENGTH) found.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (length > PASSWORD_MAX_LENGTH) found.password = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (show.confirm && form.confirm !== form.password) found.confirm = 'The passwords do not match.';
  return found;
}

/** Usernames are stored in lower case; the form accepts any case. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** A preset a new provider starts from. `oidc` takes its slug and name from the admin. */
export interface ProviderPreset {
  kind: AuthProviderKind;
  label: string;
  slug: string;
  displayName: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { kind: 'google', label: 'Google', slug: 'google', displayName: 'Google' },
  { kind: 'apple', label: 'Apple', slug: 'apple', displayName: 'Apple' },
  { kind: 'oidc', label: 'Generic OpenID Connect', slug: '', displayName: '' },
];

/** The values of the provider drawer, before they are checked and sent. */
export interface ProviderDraft {
  kind: AuthProviderKind;
  slug: string;
  displayName: string;
  enabled: boolean;
  issuer: string;
  clientId: string;
  teamId: string;
  keyId: string;
}

/** What the drawer does with the stored secret: keep it, replace it with the typed one, or remove it. */
export type SecretAction = { op: 'keep' } | { op: 'replace'; value: string } | { op: 'remove' };

export type ProviderField = 'slug' | 'displayName' | 'issuer' | 'clientId' | 'teamId' | 'keyId' | 'secret';

/** Whether an issuer URL is https, or http on localhost (the API decides the rest). */
export function isAllowedIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** The problems of a provider draft, by field. Empty when it can be saved. */
export function providerProblems(
  draft: ProviderDraft,
  hasSecret: boolean,
  secret: SecretAction,
  isNew: boolean,
): Partial<Record<ProviderField, string>> {
  const found: Partial<Record<ProviderField, string>> = {};
  const name = draft.displayName.trim();
  if (!name) found.displayName = 'Enter the name the sign-in button shows.';
  else if ([...name].length > 80) found.displayName = 'Use at most 80 characters.';
  if (draft.kind === 'oidc') {
    if (isNew && !SLUG_PATTERN.test(draft.slug.trim())) {
      found.slug = 'Use lower-case letters, digits and hyphens, starting with a letter or digit, up to 40 characters.';
    }
    if (!draft.issuer.trim()) found.issuer = 'Enter the issuer URL.';
    else if (!isAllowedIssuer(draft.issuer.trim()))
      found.issuer = 'Use an https address, such as https://id.example.com.';
  }
  if (!draft.clientId.trim()) found.clientId = 'Enter the client ID.';
  if (draft.kind === 'apple') {
    if (!/^[A-Za-z0-9]{10}$/.test(draft.teamId.trim())) found.teamId = 'The team ID is 10 letters and digits.';
    if (!/^[A-Za-z0-9]{10}$/.test(draft.keyId.trim())) found.keyId = 'The key ID is 10 letters and digits.';
  }
  // A secret must be typed when it is replaced, or kept while none is stored. Removing one is always allowed.
  if (secret.op === 'replace' && !secret.value.trim()) {
    found.secret = draft.kind === 'apple' ? 'Paste the private key.' : 'Enter the client secret.';
  } else if (secret.op === 'keep' && !hasSecret) {
    found.secret = draft.kind === 'apple' ? 'Paste the private key.' : 'Enter the client secret.';
  }
  return found;
}

/** The body of `PUT /auth/providers/{slug}`: only the fields of the kind, and the secret only when it changes. */
export function providerBody(
  draft: ProviderDraft,
  secret: SecretAction,
): {
  displayName: string;
  enabled: boolean;
  config: Record<string, string>;
  secret?: string | null;
} {
  const config: Record<string, string> =
    draft.kind === 'oidc'
      ? { issuer: draft.issuer.trim(), clientId: draft.clientId.trim() }
      : draft.kind === 'apple'
        ? { clientId: draft.clientId.trim(), teamId: draft.teamId.trim(), keyId: draft.keyId.trim() }
        : { clientId: draft.clientId.trim() };
  const body: { displayName: string; enabled: boolean; config: Record<string, string>; secret?: string | null } = {
    displayName: draft.displayName.trim(),
    enabled: draft.enabled,
    config,
  };
  if (secret.op === 'replace') body.secret = secret.value;
  if (secret.op === 'remove') body.secret = null;
  return body;
}

/** The label of the write-only secret field: the Apple private key, or the client secret. */
export function secretLabel(kind: AuthProviderKind): string {
  return kind === 'apple' ? 'Private key (.p8)' : 'Client secret';
}

/** The provider slug a method id names: `google`, `apple`, or the slug of `oidc:<slug>`. */
export function slugOfMethod(id: string): string {
  return id.startsWith('oidc:') ? id.slice('oidc:'.length) : id;
}

/** What an admin's change refused by the API means, in words: the lock-out, the last method, the missing key. */
export function adminRefusal(err: unknown, fallback: string): string {
  switch (errorCode(err)) {
    case ErrorCodes.lastSignInMethod:
      return 'Keep at least one sign-in method on. Turn another method on first.';
    case ErrorCodes.signInLockout:
      return 'That would leave an admin with no way to sign in. Every admin needs a passkey, a password, or a linked provider that is on. Give each admin one of those first, then try again.';
    case ErrorCodes.secretKeyMissing:
      return 'The server has no TALEART_SECRET_KEY, so provider secrets cannot be saved. Set TALEART_SECRET_KEY on the API, restart it, then try again.';
    default:
      return errorText(err, fallback);
  }
}

/** What a signed-in user's removal refused by the API means, in words. */
export function accountRefusal(err: unknown, fallback: string): string {
  if (errorCode(err) === ErrorCodes.lastSignInMethod) {
    return 'Keep at least one sign-in method. Add another (a passkey, a password or a linked provider) before removing this one.';
  }
  return errorText(err, fallback);
}

/** The result of a provider test as one sentence for the admin. */
export function providerTestText(result: ProviderTestResult): string {
  if (!result.ok) {
    const reason = result.code ? `: ${result.code.replace(/_/g, ' ')}` : '';
    return `The provider did not pass the check${reason}.`;
  }
  const checked = Object.keys(result.endpoints ?? {});
  const endpoints = checked.length > 0 ? ` Endpoints found: ${checked.join(', ')}.` : '';
  return `The provider's settings work.${result.issuer ? ` Issuer: ${result.issuer}.` : ''}${endpoints}`;
}
