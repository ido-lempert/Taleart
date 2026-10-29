import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { API_BASE } from './dashboard.store';
import {
  accountRefusal,
  adminRefusal,
  authErrorMessage,
  checkPasswordForm,
  continueLabel,
  errorCode,
  errorText,
  isAllowedIssuer,
  isEmail,
  PROVIDER_PRESETS,
  providerBody,
  providerMethodId,
  providerProblems,
  providerStartUrl,
  providerTestText,
  providerTestUrl,
  retryAfterSeconds,
  slugOfMethod,
  type ProviderDraft,
} from './sign-in-methods';

function apiError(
  status: number,
  code: string,
  message = 'Refused.',
  headers?: Record<string, string>,
): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { error: { code, message } },
    headers: headers ? new HttpHeaders(headers) : undefined,
  });
}

const DRAFT: ProviderDraft = {
  kind: 'oidc',
  slug: 'corp',
  displayName: 'Corp ID',
  enabled: true,
  issuer: 'https://id.example.com',
  clientId: 'client-1',
  teamId: '',
  keyId: '',
};

describe('sign-in method helpers', () => {
  it('builds the provider start and test URLs the API serves', () => {
    expect(providerStartUrl('google', 'sign-in')).toBe(`${API_BASE}/auth/providers/google/start?purpose=sign-in`);
    expect(providerStartUrl('corp', 'invitation', 'tok 1')).toBe(
      `${API_BASE}/auth/providers/corp/start?purpose=invitation&token=tok+1`,
    );
    expect(providerStartUrl('apple', 'link')).toBe(`${API_BASE}/auth/providers/apple/start?purpose=link`);
    expect(providerStartUrl('corp', 'invitation', 'tok', 'ada@example.com')).toBe(
      `${API_BASE}/auth/providers/corp/start?purpose=invitation&token=tok&email=ada%40example.com`,
    );
    expect(providerTestUrl('corp')).toBe(`${API_BASE}/auth/providers/corp/test`);
  });

  it('maps a method id to its provider slug and label', () => {
    expect(slugOfMethod('oidc:corp')).toBe('corp');
    expect(slugOfMethod('google')).toBe('google');
    expect(providerMethodId('oidc', 'corp')).toBe('oidc:corp');
    expect(providerMethodId('apple', 'apple')).toBe('apple');
    expect(continueLabel({ label: 'Google' })).toBe('Continue with Google');
  });

  it('turns an auth_error code into a friendly message, with a generic line for anything else', () => {
    expect(authErrorMessage(null)).toBeNull();
    expect(authErrorMessage('invitation_invalid')).toContain('no longer valid');
    expect(authErrorMessage('email_taken')).toContain('already exists');
    expect(authErrorMessage('secret_key_missing')).toContain('not set up');
    expect(authErrorMessage('something_new')).toBe('Signing in with that provider did not finish. Try again.');
  });

  it('reads Retry-After as seconds or as a date', () => {
    expect(retryAfterSeconds(null)).toBeNull();
    expect(retryAfterSeconds('30')).toBe(30);
    expect(retryAfterSeconds('garbage')).toBeNull();
    const now = Date.parse('2026-10-29T10:00:00Z');
    expect(retryAfterSeconds('Thu, 29 Oct 2026 10:01:30 GMT', now)).toBe(90);
    expect(retryAfterSeconds('Thu, 29 Oct 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('reads the API error code and message, and says when the API could not be reached', () => {
    const refused = apiError(401, 'sign_in_failed', 'No.');
    expect(errorCode(refused)).toBe('sign_in_failed');
    expect(errorCode(new Error('x'))).toBeNull();
    expect(errorText(refused, 'fallback')).toBe('No.');
    expect(errorText(new HttpErrorResponse({ status: 0 }), 'fallback')).toBe('Could not reach the API. Try again.');
    expect(errorText(new Error('x'), 'fallback')).toBe('fallback');
  });

  it('checks a password form before sending: username, password length, match', () => {
    const shown = { username: true, currentPassword: false, confirm: true };
    expect(checkPasswordForm({ username: '', password: 'x', confirm: 'x' }, shown).username).toBe('Enter a username.');
    expect(checkPasswordForm({ username: 'ab', password: 'x', confirm: 'x' }, shown).username).toContain('3 to 40');
    expect(checkPasswordForm({ username: 'Ada.L', password: 'short', confirm: 'short' }, shown).password).toBe(
      'Use at least 12 characters.',
    );
    expect(
      checkPasswordForm({ username: 'ada', password: 'x'.repeat(129), confirm: 'x'.repeat(129) }, shown).password,
    ).toBe('Use at most 128 characters.');
    expect(
      checkPasswordForm({ username: 'ada', password: 'correct horse 1', confirm: 'correct horse 2' }, shown),
    ).toEqual({
      confirm: 'The passwords do not match.',
    });
    expect(
      checkPasswordForm({ username: 'Ada.L', password: 'correct horse 1', confirm: 'correct horse 1' }, shown),
    ).toEqual({});
  });

  it('asks for the current password only when the form shows it', () => {
    const shown = { username: false, currentPassword: true, confirm: false };
    expect(checkPasswordForm({ currentPassword: '', password: 'correct horse 1' }, shown).currentPassword).toBe(
      'Enter your current password.',
    );
    expect(
      checkPasswordForm({ currentPassword: '', password: 'correct horse 1' }, { ...shown, currentPassword: false }),
    ).toEqual({});
  });

  it('accepts only https issuers, and http for localhost', () => {
    expect(isAllowedIssuer('https://id.example.com')).toBe(true);
    expect(isAllowedIssuer('http://localhost:8080')).toBe(true);
    expect(isAllowedIssuer('http://id.example.com')).toBe(false);
    expect(isAllowedIssuer('not a url')).toBe(false);
  });
});

describe('provider drafts', () => {
  it('offers the three kinds with their presets', () => {
    expect(PROVIDER_PRESETS.map((p) => p.kind)).toEqual(['google', 'apple', 'oidc']);
    expect(PROVIDER_PRESETS[0]).toMatchObject({ slug: 'google', displayName: 'Google' });
  });

  it('asks for the fields of the kind, and for a secret when none is stored', () => {
    expect(providerProblems({ ...DRAFT, displayName: ' ' }, false, { op: 'keep' }, true).displayName).toContain(
      'Enter the name',
    );
    expect(providerProblems({ ...DRAFT, slug: 'Bad Slug' }, false, { op: 'replace', value: 'x' }, true).slug).toContain(
      'lower-case',
    );
    expect(
      providerProblems({ ...DRAFT, issuer: 'http://id.example.com' }, false, { op: 'replace', value: 'x' }, true)
        .issuer,
    ).toContain('https');
    expect(providerProblems(DRAFT, false, { op: 'keep' }, true).secret).toBe('Enter the client secret.');
    expect(providerProblems(DRAFT, true, { op: 'keep' }, false)).toEqual({});
    expect(providerProblems(DRAFT, true, { op: 'replace', value: '  ' }, false).secret).toBe(
      'Enter the client secret.',
    );
  });

  it('checks the Apple team ID, key ID and private key', () => {
    const apple: ProviderDraft = {
      ...DRAFT,
      kind: 'apple',
      slug: 'apple',
      displayName: 'Apple',
      teamId: 'ABC',
      keyId: 'KEY1234567',
    };
    const found = providerProblems(apple, false, { op: 'keep' }, false);
    expect(found.teamId).toBe('The team ID is 10 letters and digits.');
    expect(found.keyId).toBeUndefined();
    expect(found.secret).toBe('Paste the private key.');
    expect(providerProblems({ ...apple, teamId: 'ABCDE12345' }, true, { op: 'remove' }, false)).toEqual({});
  });

  it('builds the body with only the fields of the kind, and the secret only when it changes', () => {
    expect(providerBody(DRAFT, { op: 'keep' })).toEqual({
      displayName: 'Corp ID',
      enabled: true,
      config: { issuer: 'https://id.example.com', clientId: 'client-1' },
    });
    expect(providerBody(DRAFT, { op: 'replace', value: 's3cret' })).toMatchObject({ secret: 's3cret' });
    expect(providerBody(DRAFT, { op: 'remove' })).toMatchObject({ secret: null });
    const google = providerBody({ ...DRAFT, kind: 'google', slug: 'google', displayName: 'Google' }, { op: 'keep' });
    expect(google.config).toEqual({ clientId: 'client-1' });
    const apple = providerBody(
      { ...DRAFT, kind: 'apple', slug: 'apple', teamId: 'ABCDE12345', keyId: 'KEY1234567' },
      { op: 'replace', value: 'PEM' },
    );
    expect(apple.config).toEqual({ clientId: 'client-1', teamId: 'ABCDE12345', keyId: 'KEY1234567' });
  });
});

describe('the invitation email', () => {
  it('is well-formed or not, without the API', () => {
    expect(isEmail('ada@example.com')).toBe(true);
    expect(isEmail(' ada@example.com ')).toBe(true);
    expect(isEmail('ada@example')).toBe(false);
    expect(isEmail('ada @example.com')).toBe(false);
    expect(isEmail('')).toBe(false);
  });
});

describe('refusals and test results in words', () => {
  it('explains the lock-out and the missing key for an admin', () => {
    expect(adminRefusal(apiError(409, 'last_sign_in_method'), 'x')).toContain('Keep at least one sign-in method on');
    expect(adminRefusal(apiError(409, 'sign_in_lockout'), 'x')).toContain('no way to sign in');
    expect(adminRefusal(apiError(503, 'secret_key_missing'), 'x')).toContain('TALEART_SECRET_KEY');
    expect(adminRefusal(apiError(400, 'validation_failed', 'Name is required.'), 'x')).toBe('Name is required.');
  });

  it('explains the last method for a signed-in user', () => {
    expect(accountRefusal(apiError(409, 'last_sign_in_method'), 'x')).toContain('Keep at least one sign-in method');
    expect(accountRefusal(apiError(404, 'not_found', 'Gone.'), 'x')).toBe('Gone.');
  });

  it('says what a provider test found, without a secret', () => {
    expect(
      providerTestText({ ok: true, issuer: 'https://id.example.com', endpoints: { authorization: 'a', token: 't', jwks: 'j' } }),
    ).toBe("The provider's settings work. Issuer: https://id.example.com. Endpoints found: authorization, token, jwks.");
    expect(providerTestText({ ok: false, code: 'sign_in_failed' })).toBe(
      'The provider did not pass the check: sign in failed.',
    );
    expect(providerTestText({ ok: false })).toBe('The provider did not pass the check.');
  });
});
