import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The sign-in methods, as Settings > Sign-in methods lists them. `id` is the method id the API and the sign-in page use. */
export const SIGN_IN_METHODS = [
  { id: 'passkey', label: 'Passkey', kind: 'passkey', turnedOn: 'On from a fresh install.', stored: 'A passkey per device, with its public key; the private key stays on the device or in a password manager.' },
  { id: 'password', label: 'Username and password', kind: 'password', turnedOn: 'Off until an admin turns it on.', stored: 'A scrypt hash of the password, and the lower-case username.' },
  { id: 'google', label: 'Google (a preset)', kind: 'google', turnedOn: 'Added and turned on by an admin.', stored: 'Client ID and scopes in plain text; the client secret encrypted.' },
  { id: 'apple', label: 'Apple (a preset)', kind: 'apple', turnedOn: 'Added and turned on by an admin.', stored: 'Client ID, Team ID and Key ID in plain text; the .p8 private key encrypted.' },
  { id: 'oidc:<slug>', label: 'A generic OpenID Connect provider', kind: 'oidc', turnedOn: 'Added and turned on by an admin, under a slug the admin picks.', stored: 'Issuer, client ID and scopes in plain text; the client secret encrypted.' },
] as const;

/** The provider settings, by kind: the fields of Add a provider, and whether each is required, and where it is stored. */
export const PROVIDER_FIELDS = [
  { field: 'Slug (the URL name, e.g. company-sso)', kinds: 'Generic OpenID Connect', required: 'Yes, lower-case letters, digits and hyphens, up to 40', stored: 'Plain (the provider key)' },
  { field: 'Button name (display name)', kinds: 'All', required: 'Yes, up to 80 characters', stored: 'Plain' },
  { field: 'Issuer URL (issuer)', kinds: 'Generic OpenID Connect', required: 'Yes, https (http only for localhost outside production)', stored: 'Plain' },
  { field: 'Client ID (clientId)', kinds: 'All', required: 'Yes, up to 255 characters', stored: 'Plain' },
  { field: 'Scopes (scopes)', kinds: 'Generic OpenID Connect, Google', required: 'No; default openid email profile; must include openid; up to 200 characters', stored: 'Plain' },
  { field: 'Team ID (teamId)', kinds: 'Apple', required: 'Yes, 10 letters and digits', stored: 'Plain' },
  { field: 'Key ID (keyId)', kinds: 'Apple', required: 'Yes, 10 letters and digits', stored: 'Plain' },
  { field: 'Client secret, or the Apple .p8 private key as PEM (secret)', kinds: 'All', required: 'Yes, to make the provider usable; up to 8,192 characters', stored: 'Encrypted (AES-256-GCM, TALEART_SECRET_KEY); never returned by the API' },
] as const;

/** The environment variables that change sign-in. */
export const SIGN_IN_ENV = [
  { name: 'TALEART_SECRET_KEY', required: 'To save any provider secret', value: 'Base64 of 32 random bytes, e.g. openssl rand -base64 32.', effect: 'Encrypts provider secrets. Without a valid key the API still runs but refuses to save a secret (503 secret_key_missing).' },
  { name: 'TALEART_SETUP_PASSWORD', required: 'No', value: 'Only the literal true enables it. Default off.', effect: 'On an empty install, the first admin may set up with a username and password.' },
  { name: 'PUBLIC_API_URL', required: 'Set it for any real install', value: 'The public address of the API, default http://localhost:3333.', effect: 'The redirect URI is PUBLIC_API_URL plus /api/v1/auth/callback/<slug>.' },
  { name: 'RP_ORIGIN', required: 'Set it for any real install', value: 'The dashboard origin, default http://localhost:4200.', effect: 'Where the dashboard lives; passkeys and the cookie Secure flag follow it (Secure when it starts with https:).' },
  { name: 'RP_ID', required: 'Set it for any real install', value: 'The dashboard host name, default localhost.', effect: 'Passkeys are bound to this host name.' },
  { name: 'NODE_ENV', required: 'Set to production for a real install', value: 'Any value; production turns something off.', effect: 'Outside production, a provider issuer may be plain http on localhost. In production it must be https.' },
] as const;

/** Every operation of the contract's Sign-in methods tag, as the OpenAPI document lists it. */
export const SIGN_IN_ENDPOINTS = [
  { method: 'GET', path: '/auth/account/methods', who: 'A signed-in user (session cookie)', purpose: 'The user\'s passkeys, password username and linked provider identities.' },
  { method: 'PUT', path: '/auth/account/password', who: 'A signed-in user', purpose: 'Set a password, or change it (the current password is needed when one is set).' },
  { method: 'DELETE', path: '/auth/account/password', who: 'A signed-in user', purpose: 'Remove the password, if another method stays usable.' },
  { method: 'DELETE', path: '/auth/account/passkeys/{passkeyId}', who: 'A signed-in user', purpose: 'Remove one of the user\'s passkeys, if another method stays usable.' },
  { method: 'DELETE', path: '/auth/account/identities/{identityId}', who: 'A signed-in user', purpose: 'Unlink one of the user\'s provider identities, if another method stays usable.' },
  { method: 'GET', path: '/auth/settings', who: 'An admin', purpose: 'Which methods are on, and whether the server has the secret key.' },
  { method: 'PUT', path: '/auth/settings', who: 'An admin', purpose: 'Turn the passkey and password methods on or off.' },
  { method: 'GET', path: '/auth/providers', who: 'An admin', purpose: 'The providers, with usable, hasSecret and the redirect URI. Never a secret.' },
  { method: 'PUT', path: '/auth/providers/{slug}', who: 'An admin', purpose: 'Add a provider, or replace its settings; send or remove its secret.' },
  { method: 'DELETE', path: '/auth/providers/{slug}', who: 'An admin', purpose: 'Remove a provider and its secret.' },
  { method: 'POST', path: '/auth/users/{userId}/password-reset', who: 'An admin', purpose: 'Issue a one-time reset link for a user (shown once).' },
  { method: 'GET', path: '/auth/providers/{slug}/start', who: 'Anyone, without a session (purpose link needs a session)', purpose: 'Start a sign-in, setup, invitation or link with a provider; redirects to the provider.' },
  { method: 'GET', path: '/auth/callback/{slug}', who: 'Anyone; the taleart_oauth cookie and the state must match', purpose: 'The redirect back from a provider.' },
  { method: 'POST', path: '/auth/callback/{slug}', who: 'Anyone; the same checks as the GET callback', purpose: 'The form-posted redirect back from Apple (response_mode=form_post).' },
  { method: 'POST', path: '/auth/providers/{slug}/test', who: 'An admin', purpose: 'Run the provider\'s discovery and report the issuer and endpoints. The secret is not used.' },
] as const;

/** The error codes of the sign-in methods, from the contract's ErrorCode enum, with what each one means. */
export const SIGN_IN_ERRORS = [
  { code: 'sign_in_failed', meaning: 'A sign-in was refused. The same answer for an unknown user, a wrong password, a method that is off, or a provider that is not usable.' },
  { code: 'password_rejected', meaning: 'The password does not meet the policy (12 to 128 characters, not the username or the email\'s local part, not a common password).' },
  { code: 'username_taken', meaning: 'The username is already in use.' },
  { code: 'password_incorrect', meaning: 'The current password is wrong when changing a password.' },
  { code: 'password_reset_invalid', meaning: 'The reset link is unknown, used, or past its 24 hours.' },
  { code: 'sign_in_method_disabled', meaning: 'The method is turned off.' },
  { code: 'last_sign_in_method', meaning: 'The change would leave no method usable: TaleArt will not remove the last one.' },
  { code: 'sign_in_lockout', meaning: 'The change would leave an admin with no way to sign in.' },
  { code: 'secret_key_missing', meaning: 'The server has no valid TALEART_SECRET_KEY, so a provider secret cannot be saved.' },
  { code: 'provider_not_found', meaning: 'No provider has that slug.' },
  { code: 'identity_in_use', meaning: 'The provider identity is already linked to another account.' },
  { code: 'email_not_verified', meaning: 'The provider did not verify the email, so the identity cannot redeem an invitation.' },
  { code: 'email_mismatch', meaning: 'The provider\'s verified email is not the email typed on the invitation page.' },
  { code: 'session_required', meaning: 'A link needs a signed-in user.' },
  { code: 'discovery_failed', meaning: 'The discovery document could not be read, or its issuer is not the configured one.' },
  { code: 'provider_unavailable', meaning: 'The provider\'s keys or endpoints could not be read.' },
  { code: 'invitation_invalid', meaning: 'The invitation is unknown, used, or past its 7 days.' },
  { code: 'setup_closed', meaning: 'The first admin already exists, so setup is closed.' },
  { code: 'passkey_failed', meaning: 'The passkey ceremony was refused or did not check out.' },
  { code: 'rate_limited', meaning: 'Too many attempts from this address. Wait, then try again .' },
  { code: 'not_found', meaning: 'The item does not exist, or it is another user\'s.' },
] as const;

/** The security properties of sign-in, as the docs state them. The spec checks the code's values against the constants above. */
export const SECURITY_PROPERTIES = [
  'Stored as hashes or encrypted: passwords as scrypt hashes; session and reset tokens as SHA-256 hashes; provider secrets as AES-256-GCM ciphertext. The API never returns a password, a reset token or a provider secret.',
  'Passwords: 12 to 128 characters, with no composition rules; not the username or the email\'s local part; not one of about 100 common passwords. scrypt with N=2^15, r=8, p=1, a 64-byte key and a random 16-byte salt. Compared in constant time; an unknown username is checked against a dummy hash, so timing does not reveal it.',
  'Throttling: 5 failed password sign-ins for a username wait 30 seconds, doubling per failure, up to 15 minutes; failures are forgotten after an hour. Per address: 10 password sign-ins in a burst, then 10 a minute. Provider sign-ins: 20 in a burst, then 20 a minute. The throttle is in memory, per API process.',
  'Session revocation: a password change or a reset ends the user\'s other sessions; the session making the change stays signed in. A reset ends every session and starts a new one.',
  'Provider flows use PKCE (S256), a state and a nonce of 32 random bytes each, stored server-side and bound to the browser by the taleart_oauth cookie (http-only, SameSite=Lax, path /api/v1/auth, 10 minutes). Each challenge is single use.',
  'ID tokens: only RS256, ES256 and PS256 signatures are accepted (never none or HS*); issuer, audience, expiry and nonce are checked, with 60 seconds of clock skew.',
  'Discovery: the document\'s issuer must equal the configured issuer exactly; endpoints must be https (plain http only on localhost outside production); 5 second timeout; 256 KiB size cap; redirects are refused. The JWKS is cached for 5 minutes.',
  'Apple: the client secret is an ES256 JWT signed with the .p8 key, with the key ID in its header, created for each sign-in with a 5-minute lifetime and never stored.',
  'Email: a provider email is used only when the provider verified it. A provider identity never creates an account by itself, and an account is never matched by email alone. An identity attaches to a user only when redeeming an invitation (the verified email equals the email typed on the invitation page), in the first-admin setup, or when a signed-in user links it.',
  'Registration is by invitation only, plus the first admin on an empty install. There is no open sign-up and no domain auto-join.',
  'Password recovery is an admin-issued link: 32 random bytes, valid once for 24 hours, a new link replaces the unused earlier ones, and it is shown once. TaleArt sends no email.',
  'Sessions: 7 days, a random token in an http-only cookie (taleart_session, SameSite=Strict, Secure on https). API tokens are unchanged and are not used for sign-in.',
] as const;

@Component({
  selector: 'docs-sign-in-methods-reference',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 tabindex="-1">Sign-in methods reference</h1>
    <p class="lede">
      The sign-in methods of a TaleArt install: what each is, what an admin configures for an identity provider, the
      environment variables, the endpoints, the error codes and the security properties. For the steps to set them up,
      see the <a routerLink="/guides/sign-in-methods">Sign-in methods guide</a>.
    </p>

    <h2 id="methods">Methods</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="methods-caption">
      <table id="methods">
        <caption id="methods-caption">Sign-in methods</caption>
        <thead>
          <tr>
            <th scope="col">Method id</th>
            <th scope="col">Label</th>
            <th scope="col">Kind</th>
            <th scope="col">Turned on</th>
            <th scope="col">What is stored</th>
          </tr>
        </thead>
        <tbody>
          @for (m of methods; track m.id) {
          <tr>
            <th scope="row"><code>{{ m.id }}</code></th>
            <td>{{ m.label }}</td>
            <td>{{ m.kind }}</td>
            <td>{{ m.turnedOn }}</td>
            <td>{{ m.stored }}</td>
          </tr>
          }
        </tbody>
      </table>
    </div>
    <p>
      A fresh install has the passkey on and the password off. Each admin can turn the passkey and the password on or off in
      Settings > Sign-in methods. At least one method must stay on, and every admin must keep one usable method.
    </p>

    <h2 id="provider-fields">Provider settings</h2>
    <p>
      An admin adds a provider in Settings > Sign-in methods > Add a provider. The kind is Google, Apple or Generic OpenID
      Connect. The redirect URI to register at the provider is <code>PUBLIC_API_URL/api/v1/auth/callback/&lt;slug&gt;</code>,
      for example <code>https://api.example.com/api/v1/auth/callback/google</code>, and it appears in the drawer once the
      provider is saved. Secrets are write-only: the API never returns them, only whether one is set.
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="provider-fields-caption">
      <table id="provider-fields">
        <caption id="provider-fields-caption">Provider settings, by kind</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Kinds</th>
            <th scope="col">Required</th>
            <th scope="col">Where it is stored</th>
          </tr>
        </thead>
        <tbody>
          @for (f of providerFields; track f.field) {
          <tr>
            <th scope="row">{{ f.field }}</th>
            <td>{{ f.kinds }}</td>
            <td>{{ f.required }}</td>
            <td>{{ f.stored }}</td>
          </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="env">Environment variables</h2>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="env-caption">
      <table id="env">
        <caption id="env-caption">Environment variables of the API for sign-in</caption>
        <thead>
          <tr>
            <th scope="col">Variable</th>
            <th scope="col">Required</th>
            <th scope="col">Value</th>
            <th scope="col">Effect</th>
          </tr>
        </thead>
        <tbody>
          @for (v of env; track v.name) {
          <tr>
            <th scope="row"><code>{{ v.name }}</code></th>
            <td>{{ v.required }}</td>
            <td>{{ v.value }}</td>
            <td>{{ v.effect }}</td>
          </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="endpoints">Endpoints</h2>
    <p>The Sign-in methods tag of the <a routerLink="/api-reference">API reference</a>. Every path is listed here.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="endpoints-caption">
      <table id="endpoints">
        <caption id="endpoints-caption">Sign-in methods endpoints</caption>
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Path</th>
            <th scope="col">Who may call</th>
            <th scope="col">Purpose</th>
          </tr>
        </thead>
        <tbody>
          @for (e of endpoints; track e.method + e.path) {
          <tr>
            <td><code>{{ e.method }}</code></td>
            <td><code>{{ e.path }}</code></td>
            <td>{{ e.who }}</td>
            <td>{{ e.purpose }}</td>
          </tr>
          }
        </tbody>
      </table>
    </div>
    <p>
      None of these accept an API token: a request with an <code>Authorization</code> header is refused. Admin endpoints need
      an admin session.
    </p>

    <h2 id="errors">Error codes</h2>
    <p>
      Every error answers the standard body, with a <code>code</code> field such as <code>{{ errorSample }}</code>. The
      codes of sign-in are:
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-labelledby="errors-caption">
      <table id="errors">
        <caption id="errors-caption">Sign-in error codes</caption>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Meaning</th>
          </tr>
        </thead>
        <tbody>
          @for (err of errors; track err.code) {
          <tr>
            <th scope="row"><code>{{ err.code }}</code></th>
            <td>{{ err.meaning }}</td>
          </tr>
          }
        </tbody>
      </table>
    </div>

    <h2 id="security">Security properties</h2>
    <ul>
      @for (item of security; track $index) {
      <li>{{ item }}</li>
      }
    </ul>
    <p>
      API tokens are unchanged: a token still calls the Management API as its user, and sign-in methods are never reached
      with one. See <a routerLink="/api-tokens">API tokens</a>.
    </p>
  `,
})
export class SignInMethodsReferencePage {
  protected readonly methods = SIGN_IN_METHODS;
  protected readonly providerFields = PROVIDER_FIELDS;
  protected readonly env = SIGN_IN_ENV;
  protected readonly endpoints = SIGN_IN_ENDPOINTS;
  protected readonly errors = SIGN_IN_ERRORS;
  protected readonly security = SECURITY_PROPERTIES;
  protected readonly errorSample = '{"error":{"code":"sign_in_failed"}}';
}
