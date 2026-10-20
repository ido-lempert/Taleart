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
