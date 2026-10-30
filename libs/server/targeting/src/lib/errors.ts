import {
  ErrorCodes,
  MAX_TAG_NAME_LENGTH,
  MAX_USER_LIST_CSV_ROWS,
  MAX_USER_LIST_NAME_LENGTH,
  MAX_USER_LISTS_PER_PROJECT,
} from '@taleart/contract';

/** Thrown when an audience rule breaks the contract's rules; the message is the reason (epic viewer properties). */
export class InvalidAudienceRuleError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor(readonly reason: string) {
    super(reason);
    this.name = 'InvalidAudienceRuleError';
  }
}

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

/** Thrown when a user list name is blank, too long or holds a control character (epic targeting R3). */
export class InvalidUserListNameError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor() {
    super(`A user list name holds 1 to ${MAX_USER_LIST_NAME_LENGTH} characters and no control characters`);
    this.name = 'InvalidUserListNameError';
  }
}

/** Thrown when the project already has a user list with this name, ignoring case. */
export class UserListExistsError extends Error {
  readonly code = ErrorCodes.userListExists;

  constructor() {
    super('This project already has a user list with this name');
    this.name = 'UserListExistsError';
  }
}

/** Thrown when the project already holds {@link MAX_USER_LISTS_PER_PROJECT} user lists. */
export class UserListLimitError extends Error {
  readonly code = ErrorCodes.userListLimitReached;

  constructor() {
    super(`A project holds at most ${MAX_USER_LISTS_PER_PROJECT} user lists. Delete one first.`);
    this.name = 'UserListLimitError';
  }
}

/** Thrown when a user list id is unknown or names a list of another project. */
export class UserListNotFoundError extends Error {
  readonly code = ErrorCodes.userListNotFound;

  constructor() {
    super('No user list of this project has this id');
    this.name = 'UserListNotFoundError';
  }
}

/** Thrown when the project of a new user list is gone. */
export class UserListProjectNotFoundError extends Error {
  readonly code = ErrorCodes.projectNotFound;

  constructor() {
    super('No project has this id');
    this.name = 'UserListProjectNotFoundError';
  }
}

/** Thrown while a CSV streams, when it holds more than {@link MAX_USER_LIST_CSV_ROWS} rows. Nothing is added. */
export class UserListFileTooLargeError extends Error {
  readonly code = ErrorCodes.userListFileTooLarge;

  constructor(message = `A CSV holds at most ${MAX_USER_LIST_CSV_ROWS.toLocaleString('en-US')} rows`) {
    super(message);
    this.name = 'UserListFileTooLargeError';
  }
}

/** Thrown while a CSV streams, at its first byte that is not UTF-8. It names no value. */
export class UserListFileNotUtf8Error extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor() {
    super('The file is not UTF-8 text. Save it as CSV UTF-8 and upload it again.');
    this.name = 'UserListFileNotUtf8Error';
  }
}
