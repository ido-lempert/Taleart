import { ErrorCodes } from '@taleart/contract';

/** Thrown when Storyly refuses the token, as a bearer token and as the `token` parameter. */
export class StorylyTokenInvalidError extends Error {
  readonly code = ErrorCodes.storylyTokenInvalid;

  constructor() {
    super('Storyly refused this API token. Check the token and try again.');
    this.name = 'StorylyTokenInvalidError';
  }
}

/**
 * Thrown when Storyly cannot be reached, answers an error, or answers a shape
 * the importer does not expect. The message never carries the token.
 */
export class StorylyUnavailableError extends Error {
  readonly code = ErrorCodes.storylyUnavailable;

  constructor(message: string) {
    super(message);
    this.name = 'StorylyUnavailableError';
  }
}
