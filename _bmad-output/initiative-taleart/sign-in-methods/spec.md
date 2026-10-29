# Sign-in methods (2026-10-29)

Owner request: add more register and sign-in options, configured in the dashboard: username + password, SSO (OAuth2 / OpenID Connect), federation such as Google and Apple. This amends architecture AD-9 ("passkeys only, no passwords").
Owner decisions: registration stays **invitation only + the first admin** (no open sign-up, no domain auto-join); password recovery is an **admin-issued one-time reset link** (no email sender).

## Methods
| id | what |
|---|---|
| `passkey` | exists; stays |
| `password` | username + password |
| `oidc:<slug>` | a generic OpenID Connect provider an admin adds (issuer URL, discovery) |
| `google` | preset of OIDC (issuer `https://accounts.google.com`) |
| `apple` | Sign in with Apple (own client-secret JWT) |

An admin turns each on or off and edits it in the dashboard (Settings > Sign-in methods). Defaults on a fresh and on an existing install: passkey on, nothing else. At least one method must stay enabled, and at least one enabled method must be usable by every admin (reject a change that would lock all admins out: i.e. disabling passkey while no admin has another credential for an enabled method).

## Accounts and identities
- `users` stays the account. New table `user_identities` (id, user_id FK cascade, provider text, subject text, email text null, created_at, last_used_at; UNIQUE (provider, subject)). `provider` is `google`, `apple` or `oidc:<slug>`.
- New table `user_passwords` (user_id PK FK cascade, username text UNIQUE lower(), password_hash text, created_at, updated_at, must_change bool). Username: 3-40 chars `[a-z0-9._-]`, stored lower-case. Password: 12-128 chars, any characters (no composition rules), not equal to the username or the email's local part, not in a small built-in list of the most common passwords (ship ~100 entries). Hash: `scrypt` (node:crypto) with a random 16-byte salt, N=2^15, r=8, p=1, 64-byte output, stored as a self-describing string `scrypt$N$r$p$salt$hash` (base64url); compare with `timingSafeEqual`; a dummy hash is verified for unknown usernames so timing does not reveal them.
- Sign-in by an external provider NEVER creates an account by itself. A provider identity attaches to a user only (a) when redeeming an invitation or setting up the first admin (the invitation's email must equal the provider's verified email, see below), or (b) when a signed-in user links it in Settings > My sign-in methods. After that it signs in by (provider, subject), never by email.
- Verified email rule: an ID token's email is used only when `email_verified` is true (Apple: `email_verified` is `"true"` or true). Otherwise the identity cannot be used to redeem an invitation.
- A user may hold any mix of methods (passkey, password, identities). A user can remove a method only if another remains.

## Registration (invitation only + first admin)
- First admin setup and invitation redemption accept any ENABLED method: passkey (as now), password (choose username + password), or "continue with <provider>".
- Provider flow during setup/invitation: the browser starts the provider flow with the setup or invitation token in the signed `state`; on return the server checks the verified email equals the form/invitation email.

## Provider flow (OIDC, Google, Apple)
- Authorization code flow with PKCE (S256), `state` and `nonce`. `state`, `nonce`, `code_verifier`, purpose (`sign-in` | `setup` | `invitation:<token>` | `link:<userId>`) and expiry (10 min) are stored server-side in `auth_challenges` (existing table; add kind) and bound to the browser by a short-lived http-only cookie (`taleart_oauth`, path `/api/v1/auth`, SameSite=Lax); the callback fails if the cookie and state do not match; the challenge is single-use.
- Discovery from `<issuer>/.well-known/openid-configuration`; the discovery issuer must equal the configured issuer exactly; endpoints must be https (http allowed only for localhost issuers when `NODE_ENV` is not production). Fetches use a timeout (5 s), a size cap (256 KB) and no redirects to other hosts. The JWKS is cached with a short TTL.
- ID token validation with `jose`: signature (RS256/ES256/PS256 only, never `none` or HS*), `iss`, `aud` contains the client id (and `azp` rules when several), `exp`/`iat` with 60 s skew, `nonce`, and `at_hash` ignored. Userinfo is not used.
- Redirect URI: `<PUBLIC_API_URL>/api/v1/auth/callback/<provider>`; the dashboard shows it for the admin to register at the provider. Callback ends with a redirect to the dashboard (success or `?error=<code>`; codes never include provider text).
- Apple: client secret is an ES256 JWT (iss team id, sub client id, aud `https://appleid.apple.com`, ≤ 6 months, kid = key id) generated server-side from team id, key id and the `.p8` private key; the callback is a form POST (`response_mode=form_post`); the user's name arrives only on the first authorization and is not needed. Apple relay emails count as the user's email.
- Scopes: `openid email profile` (Apple: `name email`).

## Secrets and configuration storage
- New table `auth_providers` (slug PK, kind `oidc|google|apple`, display_name, enabled, config jsonb non-secret (issuer, clientId, scopes override, teamId, keyId), secret_enc bytea null, updated_at, updated_by). Password and passkey on/off live in a one-row `auth_settings` (passkey_enabled, password_enabled).
- Provider secrets (client secret, Apple private key) are encrypted at rest with AES-256-GCM, random 12-byte nonce per value, key from env `TALEART_SECRET_KEY` (32 bytes, base64). Without the key the API still runs but refuses to save a secret (clear error) and providers needing a secret are shown as "not usable". Secrets are write-only: the API never returns them, only `hasSecret`. Never log them.
- Config reads/writes: admin only. Management API `GET/PUT/DELETE /auth/providers...`, `GET/PUT /auth/settings` (design the paths in OpenAPI; keep them OUT of API-token reach like other `/auth/*` routes).
- `GET /auth/state` (public) additionally returns the enabled methods: `{ methods: [{ id, label, kind }] }` for the sign-in page (no config, no secrets).

## Password sign-in and abuse controls
- `POST /auth/password/sign-in` {username, password}: the same 401 body for unknown user, wrong password, disabled method. Rate limit per IP (reuse the existing limiter) and per username: 5 failures → exponential delay up to 15 min (store failure counters in memory or a table; fine for a single instance; document it). No username enumeration.
- Sessions: as today (server-side, http-only cookie). Password change and reset revoke the user's other sessions.
- Self-service: signed-in user can set/change their password (needs the current one, unless none) and link/unlink methods (Settings > My sign-in methods).
- Admin reset: an admin issues a one-time reset link for a user (table `password_resets`: token hash, user_id, expires in 24 h, used_at); redeeming sets a new password, signs the user in, revokes other sessions. The link is shown once. Same table pattern as invitations. Admin can also add a password method to a user this way.

## Dashboard
- Sign-in page lists the enabled methods (buttons "Continue with Google", etc., and a username + password form). Setup and invitation pages offer the same choices.
- Settings > Sign-in methods (admin): toggles for passkey and password, provider list with add/edit/delete, the redirect URI to copy, secret field (write-only, "set" badge), a "Test" button that runs discovery and reports issuer/endpoints OK or the error. Settings > My sign-in methods (any user): linked methods, set password, link/unlink.
- Users page (admin): "Issue reset link" per user.

## Docs
Guide "Sign-in methods" with numbered steps and real screenshots (enable password; add Google; add a generic OIDC provider; Apple; first admin and invitation with a provider; reset link), a reference page with tables (methods, provider config fields, env variables, endpoints, error codes, security properties), update to the architecture note AD-9 in `_bmad-output/initiative-taleart/architecture-taleart/architecture-taleart.md`. Never name competing products; naming the identity providers (Google, Apple) is fine in these pages and only here.

## Out of scope
Open sign-up, domain auto-join, SAML, MFA beyond passkeys, SCIM, email sending, social login for the Delivery API.
