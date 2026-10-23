import { ErrorCodes } from '@taleart/contract';

/**
 * Thrown when a response names no interactive component the visitor could see: a tale that is not
 * delivered in that zone now (unknown, of another project, hidden, outside its window, its group
 * off), or an element its published document does not show, or one that is not interactive. One
 * error for all, so a caller cannot tell which.
 */
export class ResponseTargetNotFoundError extends Error {
  readonly code = ErrorCodes.responseTargetNotFound;

  constructor() {
    super('No interactive component with this id is shown in this zone');
    this.name = 'ResponseTargetNotFoundError';
  }
}

/** Thrown when a response's value is not valid for its component, such as an option id the poll lacks. */
export class InvalidResponseValueError extends Error {
  readonly code = ErrorCodes.validationFailed;

  constructor(message = 'The value is not one of the choices of this component') {
    super(message);
    this.name = 'InvalidResponseValueError';
  }
}

/** Thrown when a response comes without a valid visitor id (epic UX rework 8.23): responses are kept per visitor. */
export class VisitorIdRequiredError extends Error {
  readonly code = ErrorCodes.visitorIdRequired;

  constructor() {
    super('A valid X-TaleArt-Visitor id is required to respond');
    this.name = 'VisitorIdRequiredError';
  }
}
