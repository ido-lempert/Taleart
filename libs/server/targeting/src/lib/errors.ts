import { ErrorCodes, MAX_TAG_NAME_LENGTH } from '@taleart/contract';

/** Thrown when a tag name is blank or longer than {@link MAX_TAG_NAME_LENGTH} characters. */
export class InvalidTagNameError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor() {
    super(`A tag name holds 1 to ${MAX_TAG_NAME_LENGTH} characters and no control characters`);
    this.name = 'InvalidTagNameError';
  }
}

/** Thrown when the project already has a tag with this name, ignoring case. */
export class TagExistsError extends Error {
  readonly code = ErrorCodes.tagExists;

  constructor(readonly tagName: string) {
    super(`This project already has a tag named "${tagName}"`);
    this.name = 'TagExistsError';
  }
}

/** Thrown when a tag id is unknown or names a tag of another project. */
export class TagNotFoundError extends Error {
  readonly code = ErrorCodes.tagNotFound;

  constructor(readonly tagId: string) {
    super('A tag id does not match a tag of this project');
    this.name = 'TagNotFoundError';
  }
}

/** Thrown when the project of the tags is gone. */
export class TagProjectNotFoundError extends Error {
  readonly code = ErrorCodes.projectNotFound;

  constructor(readonly projectId: string) {
    super('The project no longer exists');
    this.name = 'TagProjectNotFoundError';
  }
}
