// Public interface of the access module (AD-1). It owns the `projects`,
// `users`, `passkeys`, `sessions`, `auth_challenges`, `project_members`,
// `invitations`, `zone_keys`, `site_keys`, `api_tokens` and `api_token_projects` tables; other modules reach them only through these exports.
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
  addProjectMember,
  type Caller,
  type ProjectScope,
} from './lib/members';
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
  SiteKeyNotFoundError,
  ApiTokenNotFoundError,
  ApiTokenLimitError,
} from './lib/errors';
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
