import { ErrorCodes, MAX_API_TOKENS_PER_USER, type ErrorCode, type ProviderAuthErrorCode } from '@taleart/contract';

/** Thrown when setup is attempted after a user exists. */
export class SetupClosedError extends Error {
  readonly code = ErrorCodes.setupClosed;

  constructor() {
    super('TaleArt is already set up. Sign in with your passkey.');
    this.name = 'SetupClosedError';
  }
}

/** Thrown when a passkey challenge is missing, expired or used, or a passkey check fails. */
export class PasskeyFailedError extends Error {
  readonly code = ErrorCodes.passkeyFailed;

  constructor(message = 'The passkey could not be verified') {
    super(message);
    this.name = 'PasskeyFailedError';
  }
}

/** Thrown when an invitation link is unknown, used or expired. */
export class InvitationInvalidError extends Error {
  readonly code = ErrorCodes.invitationInvalid;

  constructor() {
    super('This invitation is no longer valid. Ask an admin for a new link.');
    this.name = 'InvitationInvalidError';
  }
}

/** Thrown when an invitee names an email that already belongs to a user. */
export class EmailTakenError extends Error {
  readonly code = ErrorCodes.emailTaken;

  constructor() {
    super('A user with this email already exists. Sign in instead.');
    this.name = 'EmailTakenError';
  }
}

/** Thrown when a conditional issue finds the project's site key already active: nothing is rotated. */
export class SiteKeyExistsError extends Error {
  readonly code = ErrorCodes.siteKeyExists;

  constructor() {
    super('This project already has a site key. Rotate it to replace it; rotating affects every zone of the project.');
    this.name = 'SiteKeyExistsError';
  }
}

/** Thrown when a zone has no active key to revoke. */
export class ZoneKeyNotFoundError extends Error {
  readonly code = ErrorCodes.zoneKeyNotFound;

  constructor() {
    super('This zone has no active key');
    this.name = 'ZoneKeyNotFoundError';
  }
}

/** Thrown when a project has no active site key to revoke. */
export class SiteKeyNotFoundError extends Error {
  readonly code = ErrorCodes.siteKeyNotFound;

  constructor() {
    super('This project has no active site key');
    this.name = 'SiteKeyNotFoundError';
  }
}

/** Thrown when a user has no such active API token: unknown, revoked, or another user's. */
export class ApiTokenNotFoundError extends Error {
  readonly code = ErrorCodes.apiTokenNotFound;

  constructor() {
    super('You have no active API token with this id');
    this.name = 'ApiTokenNotFoundError';
  }
}

/** Thrown when a user already holds the most active API tokens allowed. */
export class ApiTokenLimitError extends Error {
  readonly code = ErrorCodes.apiTokenLimitReached;

  constructor() {
    super(`You have ${MAX_API_TOKENS_PER_USER} active API tokens, the most allowed. Revoke one you no longer use.`);
    this.name = 'ApiTokenLimitError';
  }
}

/**
 * A refusal of a sign-in method (password sign-in, the method settings, providers, reset links and
 * the signed-in user's own methods). The API maps it to `status` and `code` as they are.
 */
export class SignInRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Wrong username, wrong password, or the password method is off: all the same, so a caller learns
 * nothing about which (no username enumeration, no method probing).
 */
export class SignInFailedError extends SignInRefusal {
  constructor() {
    super(401, ErrorCodes.signInFailed, 'The username or password is not correct');
  }
}

/** The username or password is failing too often: the caller waits `retryAfterSeconds`. */
export class SignInThrottledError extends SignInRefusal {
  constructor(readonly retryAfterSeconds: number) {
    super(429, ErrorCodes.rateLimited, 'Too many failed sign-in attempts for this username. Try again later.');
  }
}

/** A password that breaks the policy (length, username, email, common password). */
export class PasswordRejectedError extends SignInRefusal {
  constructor(message: string) {
    super(400, ErrorCodes.passwordRejected, message);
  }
}

/** A username, slug, config value or other input that is malformed. */
export class InputInvalidError extends SignInRefusal {
  constructor(message: string) {
    super(400, ErrorCodes.validationFailed, message);
  }
}

/** A username that another user already holds. */
export class UsernameTakenError extends SignInRefusal {
  constructor() {
    super(409, ErrorCodes.usernameTaken, 'That username is taken. Choose another.');
  }
}

/** The signed-in user's current password is wrong. */
export class PasswordIncorrectError extends SignInRefusal {
  constructor() {
    super(403, ErrorCodes.passwordIncorrect, 'The current password is not correct');
  }
}

/** A reset link that is unknown, used or expired, or that cannot be used while the password method is off. */
export class PasswordResetInvalidError extends SignInRefusal {
  constructor() {
    super(410, ErrorCodes.passwordResetInvalid, 'This password reset link is no longer valid. Ask an admin for a new one.');
  }
}

/** Setup or an invitation with a password while the password method is off. */
export class SignInMethodDisabledError extends SignInRefusal {
  constructor() {
    super(403, ErrorCodes.signInMethodDisabled, 'The password sign-in method is off. Ask an admin to turn it on.');
  }
}

/** A change that would leave no sign-in method on, or the user with no method that stays usable. */
export class LastSignInMethodError extends SignInRefusal {
  constructor(message: string) {
    super(409, ErrorCodes.lastSignInMethod, message);
  }
}

/** A change that would leave no sign-in method that every admin can use. */
export class SignInLockoutError extends SignInRefusal {
  constructor() {
    super(
      409,
      ErrorCodes.signInLockout,
      'This change would lock an admin out: keep a sign-in method on that every admin can use (a passkey, a password or a linked provider)',
    );
  }
}

/** A provider secret cannot be saved: the server has no valid TALEART_SECRET_KEY. */
export class SecretKeyMissingError extends SignInRefusal {
  constructor() {
    super(
      503,
      ErrorCodes.secretKeyMissing,
      'The server has no valid TALEART_SECRET_KEY (32 bytes, base64), so provider secrets cannot be saved',
    );
  }
}

/** A provider slug that is not configured. */
export class ProviderNotFoundError extends SignInRefusal {
  constructor() {
    super(404, ErrorCodes.providerNotFound, 'No sign-in provider has this slug');
  }
}

/** A user's own passkey, identity or password that is not theirs or does not exist. */
export class SignInItemNotFoundError extends SignInRefusal {
  constructor(message: string) {
    super(404, ErrorCodes.notFound, message);
  }
}

/** The status and message of each short code an external provider sign-in ends with (never provider text). */
const PROVIDER_AUTH_ERRORS: Record<ProviderAuthErrorCode, { status: number; message: string }> = {
  sign_in_failed: { status: 401, message: 'The sign-in with this provider did not succeed. Try again.' },
  email_not_verified: { status: 403, message: 'The provider has not verified this email address' },
  email_mismatch: { status: 403, message: 'The provider email does not match the invitation' },
  email_taken: { status: 409, message: 'A user with this email already exists. Sign in instead.' },
  setup_closed: { status: 409, message: 'TaleArt is already set up. Sign in instead.' },
  invitation_invalid: { status: 410, message: 'This invitation is no longer valid. Ask an admin for a new link.' },
  identity_in_use: { status: 409, message: 'This provider account is already linked to a TaleArt user' },
  session_required: { status: 403, message: 'Sign in to link a provider to your account' },
  discovery_failed: { status: 503, message: 'The provider could not be reached or its settings are not valid' },
  provider_unavailable: { status: 503, message: 'The provider could not be reached. Try again later.' },
};

/**
 * A refusal of an external provider sign-in (OpenID Connect, Google, Apple). The code is one of
 * {@link PROVIDER_AUTH_ERROR_CODES}; the message is fixed text, never what the provider said.
 */
export class ProviderAuthError extends SignInRefusal {
  constructor(readonly authCode: ProviderAuthErrorCode) {
    super(PROVIDER_AUTH_ERRORS[authCode].status, authCode as ErrorCode, PROVIDER_AUTH_ERRORS[authCode].message);
  }
}

/** Thrown when no user has the email a member is added by (invite a new person instead). */
export class UserNotFoundError extends Error {
  readonly code = ErrorCodes.userNotFound;

  constructor() {
    super('No user has this email. Invite them instead.');
    this.name = 'UserNotFoundError';
  }
}

/** Thrown when the user is already a member of the project (change their role instead). */
export class MemberExistsError extends Error {
  readonly code = ErrorCodes.memberExists;

  constructor() {
    super('This user is already a member of the project. Change their role instead.');
    this.name = 'MemberExistsError';
  }
}

/** Thrown when the user is not a member of the project. */
export class MemberNotFoundError extends Error {
  readonly code = ErrorCodes.memberNotFound;

  constructor() {
    super('This user is not a member of the project');
    this.name = 'MemberNotFoundError';
  }
}

/** Thrown when a project has no pending invitation with this id. */
export class InvitationNotFoundError extends Error {
  readonly code = ErrorCodes.invitationNotFound;

  constructor() {
    super('This project has no pending invitation with this id');
    this.name = 'InvitationNotFoundError';
  }
}

/** Thrown when a change would leave a project without an active admin member, and no global admin makes it. */
export class LastProjectAdminError extends Error {
  readonly code = ErrorCodes.lastProjectAdmin;

  constructor() {
    super('A project needs at least one active admin. Make someone else an admin first.');
    this.name = 'LastProjectAdminError';
  }
}
