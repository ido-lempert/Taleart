// Public interface of the access module (AD-1). It owns the `projects`,
// `users`, `passkeys`, `sessions`, `auth_challenges`, `project_members`,
// `invitations`, `zone_keys`, `site_keys`, `api_tokens` and `api_token_projects` tables, and the sign-in
// method tables `user_identities`, `user_passwords`, `auth_settings`, `auth_providers` and `password_resets`;
// other modules reach them only through these exports.
export type {
  CheckedOutClient,
  CheckoutClient,
  Db,
  DbConnection,
  TransactionalDb,
  WithClientOptions,
} from './lib/db';
export { inTransaction, isSessionEndedError, rollback, withClient } from './lib/db';
export { migrateAccess } from './lib/migration';
export { listProjects, createProject, projectExists } from './lib/projects';
export {
  accessibleProjectIds,
  canAccessProject,
  projectRole,
  hasProjectPermission,
  addProjectMember,
  type Caller,
  type ProjectScope,
} from './lib/members';
export {
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
  recordProjectAudit,
  listProjectMembers,
  addMemberByEmail,
  updateMember,
  removeMember,
  joinInvitedProject,
  listPendingInvitations,
  revokeInvitation,
  listProjectAuditLog,
  type Actor,
} from './lib/projectMembers';
export {
  createInvitation,
  previewInvitation,
  startInvitation,
  finishInvitation,
  type NewInvitation,
  type JoinedProject,
} from './lib/invitations';
export {
  SetupClosedError,
  PasskeyFailedError,
  InvitationInvalidError,
  EmailTakenError,
  ZoneKeyNotFoundError,
  SiteKeyExistsError,
  UserNotFoundError,
  MemberExistsError,
  MemberNotFoundError,
  InvitationNotFoundError,
  LastProjectAdminError,
  SiteKeyNotFoundError,
  ApiTokenNotFoundError,
  ApiTokenLimitError,
  SignInRefusal,
  SignInFailedError,
  SignInThrottledError,
  PasswordRejectedError,
  InputInvalidError,
  UsernameTakenError,
  PasswordIncorrectError,
  PasswordResetInvalidError,
  SignInMethodDisabledError,
  LastSignInMethodError,
  SignInLockoutError,
  SecretKeyMissingError,
  ProviderNotFoundError,
  SignInItemNotFoundError,
} from './lib/errors';
export {
  enabledMethods,
  PASSWORD_METHOD,
  providerMethodId,
  signInSettings,
  setSignInSettings,
  type SignInSettings,
} from './lib/signInMethods';
export {
  PROVIDER_SECRET_MAX_BYTES,
  listProviders,
  saveProvider,
  deleteProvider,
  type ProviderContext,
} from './lib/providers';
export { SECRET_KEY_ENV, parseSecretKey, encryptSecret, decryptSecret } from './lib/secrets';
export { hashPassword, verifyPassword, checkPassword, normalizeUsername } from './lib/passwords';
export { PasswordThrottle, passwordWaitMs } from './lib/throttle';
export {
  setupWithPassword,
  redeemInvitationWithPassword,
  signInWithPassword,
  setOwnPassword,
  removeOwnPassword,
  type PasswordCredentials,
} from './lib/passwordSignIn';
export {
  issuePasswordReset,
  previewPasswordReset,
  redeemPasswordReset,
  type NewPasswordReset,
} from './lib/passwordResets';
export { accountMethods, removeOwnPasskey, removeOwnIdentity } from './lib/accountMethods';
export { listUsers, USER_DIRECTORY_LIMIT } from './lib/userDirectory';
export {
  API_TOKEN_LAST_USED_INTERVAL_MS,
  createApiToken,
  listApiTokens,
  revokeApiToken,
  revokeUserApiTokens,
  authenticateApiToken,
  touchApiToken,
  type NewApiToken,
  type AuthenticatedApiToken,
} from './lib/apiTokens';
export { issueSiteKey, revokeSiteKey, siteKeyInfo, projectForSiteKey } from './lib/siteKeys';
export {
  migrateZoneKeys,
  issueZoneKey,
  revokeZoneKey,
  zoneKeyInfo,
  zoneForKey,
  zoneIdsWithActiveKey,
  zoneInstalledSql,
  type KeyZone,
} from './lib/zoneKeys';
export {
  SimpleWebAuthnVerifier,
  type PasskeyVerifier,
  type NewPasskey,
  type StoredPasskey,
  type RelyingParty,
} from './lib/passkey-verifier';
export { CHALLENGE_TTL_MS } from './lib/challenges';
export {
  OAUTH_TTL_MS,
  startProviderLogin,
  completeProviderLogin,
  recordProviderCallback,
  testProvider,
  redirectUriFor,
  type ProviderFlow,
  type ProviderLoginResult,
  type ProviderTestResult,
} from './lib/providerLogin';
export {
  OIDC_TIMEOUT_MS,
  OIDC_MAX_BYTES,
  ID_TOKEN_ALGORITHMS,
  JWKS_CACHE_MS,
  discover,
  providerUrl,
} from './lib/oidc';
export { ProviderAuthError } from './lib/errors';
export { checkProviderSlug } from './lib/providers';
export {
  SESSION_TTL_MS,
  createSession,
  findSessionUser,
  deleteSession,
  hashSessionToken,
  type NewSession,
} from './lib/sessions';
export {
  setupRequired,
  createUser,
  startSetup,
  finishSetup,
  startSignIn,
  finishSignIn,
  type StartedCeremony,
  type SignedInUser,
} from './lib/auth';
