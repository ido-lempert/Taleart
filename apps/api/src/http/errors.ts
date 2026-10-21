import type { ErrorBody, ErrorCode } from '@taleart/contract';
import { ErrorCodes } from '@taleart/contract';
import {
  InvalidFrameSettingsError,
  ProjectNotFoundError,
  UnknownFrameTypeError,
  ZoneNotFoundError,
} from '@taleart/server-zones';
import {
  InvalidScheduleError,
  InvalidStatusTransitionError,
  OrderMismatchError,
  TaleGroupFullError,
  TaleGroupNotFoundError,
  TaleGroupNotInProjectError,
  TaleNotFoundError,
} from '@taleart/server-tales';
import {
  EmailTakenError,
  InvitationInvalidError,
  PasskeyFailedError,
  SetupClosedError,
  ZoneKeyNotFoundError,
} from '@taleart/server-access';
import { InvalidTagNameError, TagExistsError, TagNotFoundError } from '@taleart/server-targeting';
import { StorylyTokenInvalidError, StorylyUnavailableError } from '@taleart/server-importer';
import type express from 'express';

/** An error that maps directly to an HTTP status and the standard error body. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Responds 404 with the standard body for any route nothing else handled. */
export const notFoundHandler: express.RequestHandler = (req, res) => {
  res.status(404).json(errorBody(ErrorCodes.notFound, `No route for ${req.method} ${req.path}`));
};

/** Turns any thrown error into the standard `{ error: { code, message } }` body. */
// Express recognises an error handler by its four parameters, so _next stays.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: express.ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(errorBody(err.code, err.message));
    return;
  }
  if (
    err instanceof ZoneNotFoundError ||
    err instanceof TaleGroupNotFoundError ||
    err instanceof TaleNotFoundError ||
    err instanceof ZoneKeyNotFoundError
  ) {
    res.status(404).json(errorBody(err.code, err.message));
    return;
  }
  if (err instanceof InvitationInvalidError) {
    res.status(410).json(errorBody(err.code, err.message));
    return;
  }
  if (
    err instanceof TaleGroupFullError ||
    err instanceof OrderMismatchError ||
    err instanceof SetupClosedError ||
    err instanceof EmailTakenError ||
    err instanceof TagExistsError ||
    err instanceof InvalidStatusTransitionError
  ) {
    res.status(409).json(errorBody(err.code, err.message));
    return;
  }
  if (
    err instanceof PasskeyFailedError ||
    err instanceof ProjectNotFoundError ||
    err instanceof UnknownFrameTypeError ||
    err instanceof InvalidFrameSettingsError ||
    err instanceof InvalidTagNameError ||
    err instanceof TagNotFoundError ||
    err instanceof TaleGroupNotInProjectError ||
    err instanceof InvalidScheduleError ||
    err instanceof StorylyTokenInvalidError
  ) {
    res.status(400).json(errorBody(err.code, err.message));
    return;
  }
  // The import source failed or answered a shape the importer does not expect.
  if (err instanceof StorylyUnavailableError) {
    res.status(502).json(errorBody(err.code, err.message));
    return;
  }
  // A body parser rejects a body over its limit this way: express.raw() on the
  // media upload (100 MB), express.json() elsewhere.
  if ((err as { type?: string })?.type === 'entity.too.large') {
    if (/\/media$/.test(req.path)) {
      res.status(413).json(errorBody(ErrorCodes.mediaTooLarge, 'The file is larger than 100 MB'));
    } else {
      res.status(413).json(errorBody(ErrorCodes.validationFailed, 'Request body is too large'));
    }
    return;
  }
  // express.json() rejects a malformed body with a 400 and type entity.parse.failed.
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json(errorBody(ErrorCodes.validationFailed, 'Request body is not valid JSON'));
    return;
  }
  console.log(
    JSON.stringify({
      level: 'error',
      msg: 'unhandled error',
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    }),
  );
  res.status(500).json(errorBody(ErrorCodes.internalError, 'Internal error'));
};
