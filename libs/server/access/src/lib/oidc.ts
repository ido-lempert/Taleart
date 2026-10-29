import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, customFetch, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { ProviderAuthError } from './errors';

/** How long one provider request may take, the whole of it including the body (spec: 5 s). */
export const OIDC_TIMEOUT_MS = 5000;
/** The most bytes a discovery document, a JWKS or a token response may be (spec: 256 KB). */
export const OIDC_MAX_BYTES = 256 * 1024;
/** How long a fetched JWKS is kept before it is fetched again (spec: a short cache). */
export const JWKS_CACHE_MS = 5 * 60 * 1000;
/** Clock skew allowed on `exp`, `nbf` and `iat` (spec: 60 s). */
export const CLOCK_SKEW_SECONDS = 60;
/** The only signature algorithms an ID token may use: never `none` or HS* (spec). */
export const ID_TOKEN_ALGORITHMS = ['RS256', 'ES256', 'PS256'];
/** The audience of Apple's client-secret JWT. */
export const APPLE_AUDIENCE = 'https://appleid.apple.com';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The endpoints a discovery document names, all checked. */
export interface OidcEndpoints {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/** A URL a provider names must be https; http is allowed only on localhost, and only when `allowHttp` is set. */
export function providerUrl(value: unknown, allowHttp: boolean, failure: 'discovery_failed' | 'provider_unavailable'): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new ProviderAuthError(failure);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderAuthError(failure);
  }
  if (url.username || url.password) throw new ProviderAuthError(failure);
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && allowHttp && LOCAL_HOSTS.has(url.hostname)) return url;
  throw new ProviderAuthError(failure);
}

/**
 * Reads a response body up to {@link OIDC_MAX_BYTES}; a larger one is refused. The timer of the
 * caller covers this read too.
 */
async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > OIDC_MAX_BYTES) throw new Error('too large');
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OIDC_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * One request to a provider: a timeout of {@link OIDC_TIMEOUT_MS}, no redirects at all (a redirect
 * is refused, so a provider cannot send the request to another host), and a body capped at
 * {@link OIDC_MAX_BYTES}. Any failure is `failure`, with nothing of the provider's text.
 */
export async function fetchProvider(
  url: URL,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  failure: 'discovery_failed' | 'provider_unavailable',
): Promise<{ status: number; body: Uint8Array }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OIDC_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (res.status >= 300 && res.status < 400) throw new Error('redirect refused');
    const body = await readCapped(res);
    return { status: res.status, body };
  } catch {
    throw new ProviderAuthError(failure);
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonObject(bytes: Uint8Array, failure: 'discovery_failed' | 'provider_unavailable'): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Fall through to the refusal.
  }
  throw new ProviderAuthError(failure);
}

/**
 * Discovery (`<issuer>/.well-known/openid-configuration`). The document's issuer must equal the
 * configured one exactly, and its endpoints must pass {@link providerUrl}.
 */
export async function discover(issuer: string, allowHttp: boolean): Promise<OidcEndpoints> {
  const base = providerUrl(issuer, allowHttp, 'discovery_failed');
  const url = new URL(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, base.origin);
  const { status, body } = await fetchProvider(url, { headers: { Accept: 'application/json' } }, 'discovery_failed');
  if (status !== 200) throw new ProviderAuthError('discovery_failed');
  const doc = parseJsonObject(body, 'discovery_failed');
  if (doc['issuer'] !== issuer) throw new ProviderAuthError('discovery_failed');
  const endpoints: OidcEndpoints = {
    issuer,
    authorizationEndpoint: providerUrl(doc['authorization_endpoint'], allowHttp, 'discovery_failed').toString(),
    tokenEndpoint: providerUrl(doc['token_endpoint'], allowHttp, 'discovery_failed').toString(),
    jwksUri: providerUrl(doc['jwks_uri'], allowHttp, 'discovery_failed').toString(),
  };
  return endpoints;
}

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * The key set of a provider, fetched with the same restrictions (jose's fetch is ours), cached for
 * {@link JWKS_CACHE_MS}. A new key id from the provider makes jose fetch the set again, once per cooldown.
 */
export function providerJwks(jwksUri: string, allowHttp: boolean): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksByUri.get(jwksUri);
  if (cached) return cached;
  const url = providerUrl(jwksUri, allowHttp, 'provider_unavailable');
  const jwks = createRemoteJWKSet(url, {
    cacheMaxAge: JWKS_CACHE_MS,
    timeoutDuration: OIDC_TIMEOUT_MS,
    [customFetch]: async (target: string | URL) => {
      const { status, body } = await fetchProvider(new URL(String(target)), { headers: { Accept: 'application/json' } }, 'provider_unavailable');
      if (status !== 200) throw new ProviderAuthError('provider_unavailable');
      return new Response(Buffer.from(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  jwksByUri.set(jwksUri, jwks);
  return jwks;
}

/** The PKCE S256 challenge of a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** A fresh random value, base64url (state, nonce, PKCE verifier). */
export function randomValue(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Compares two strings in constant time; different lengths are simply not equal. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The authorization request URL: code flow, PKCE S256, state and nonce; Apple gets form_post. */
export function authorizationUrl(input: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  formPost: boolean;
}): string {
  const url = new URL(input.endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scope);
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.formPost) url.searchParams.set('response_mode', 'form_post');
  return url.toString();
}

/** The client secret of an Apple provider: an ES256 JWT signed with the team's `.p8` key (spec). */
export async function appleClientSecret(input: { teamId: string; keyId: string; clientId: string; privateKeyPem: string }): Promise<string> {
  const key = await importPKCS8(input.privateKeyPem, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: input.keyId })
    .setIssuer(input.teamId)
    .setSubject(input.clientId)
    .setAudience(APPLE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

/**
 * Exchanges the code for tokens (client_secret_post, with the PKCE verifier) and returns the ID token.
 * Refused unless the response is 200 with an `id_token` string.
 */
export async function exchangeCode(input: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  codeVerifier: string;
  allowHttp: boolean;
}): Promise<string> {
  const url = providerUrl(input.tokenEndpoint, input.allowHttp, 'provider_unavailable');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.codeVerifier,
  });
  const { status, body } = await fetchProvider(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString() },
    'provider_unavailable',
  );
  if (status !== 200) throw new ProviderAuthError('sign_in_failed');
  const doc = parseJsonObject(body, 'provider_unavailable');
  const idToken = doc['id_token'];
  if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > 16 * 1024) throw new ProviderAuthError('sign_in_failed');
  return idToken;
}

/** The claims of a verified ID token that sign-in uses. */
export interface VerifiedIdentity {
  subject: string;
  email: string | null;
  /** True only when the provider says the email is verified (`true` or `"true"`). */
  emailVerified: boolean;
  name: string | null;
}

/**
 * Verifies an ID token with jose: signature (RS256, ES256 or PS256 only), `iss` exactly the issuer,
 * `aud` the client id (`azp` must be the client id when there are several audiences), `exp`, `iat`
 * and `nbf` with {@link CLOCK_SKEW_SECONDS} of skew, and `nonce` equal to the one sent. Any failure
 * is `sign_in_failed`. Userinfo is not used, and `at_hash` is not checked (spec).
 */
export async function verifyIdToken(
  token: string,
  input: { jwks: ReturnType<typeof createRemoteJWKSet>; issuer: string; clientId: string; nonce: string },
): Promise<VerifiedIdentity> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, input.jwks, {
      issuer: input.issuer,
      audience: input.clientId,
      algorithms: ID_TOKEN_ALGORITHMS,
      clockTolerance: CLOCK_SKEW_SECONDS,
    }));
  } catch {
    throw new ProviderAuthError('sign_in_failed');
  }
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (audiences.length > 1 && payload['azp'] !== input.clientId) throw new ProviderAuthError('sign_in_failed');
  if (payload['azp'] !== undefined && payload['azp'] !== input.clientId) throw new ProviderAuthError('sign_in_failed');
  if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW_SECONDS) throw new ProviderAuthError('sign_in_failed');
  if (typeof payload['nonce'] !== 'string' || !sameSecret(payload['nonce'], input.nonce)) throw new ProviderAuthError('sign_in_failed');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255) throw new ProviderAuthError('sign_in_failed');
  const email = typeof payload['email'] === 'string' && payload['email'].length > 0 ? payload['email'] : null;
  const verified = payload['email_verified'];
  const name = typeof payload['name'] === 'string' && payload['name'].trim() ? payload['name'].trim().slice(0, 200) : null;
  return {
    subject: payload.sub,
    email,
    emailVerified: email !== null && (verified === true || verified === 'true'),
    name,
  };
}
