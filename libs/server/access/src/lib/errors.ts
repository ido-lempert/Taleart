import { ErrorCodes } from '@taleart/contract';

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

/** Thrown when a zone has no active key to revoke. */
export class ZoneKeyNotFoundError extends Error {
  readonly code = ErrorCodes.zoneKeyNotFound;

  constructor() {
    super('This zone has no active key');
    this.name = 'ZoneKeyNotFoundError';
  }
}
