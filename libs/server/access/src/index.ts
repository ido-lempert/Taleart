// Public interface of the access module (AD-1). It owns the `projects`,
// `users`, `passkeys`, `sessions`, `auth_challenges`, `project_members`,
// `invitations` and `site_keys` tables; other modules reach them only through these exports.
export type { Db, DbConnection, TransactionalDb } from './lib/db';
export { inTransaction } from './lib/db';
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
  SiteKeyNotFoundError,
} from './lib/errors';
export { issueSiteKey, revokeSiteKey, siteKeyInfo, projectForSiteKey, zoneInstalledSql } from './lib/siteKeys';
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
