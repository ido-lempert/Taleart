import { ErrorCodes, MAX_API_TOKENS_PER_USER } from '@taleart/contract';

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
