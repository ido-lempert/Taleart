import type { ErrorBody, ErrorCode } from '@taleart/contract';
import { ErrorCodes } from '@taleart/contract';
import { ProjectNotFoundError } from '@taleart/server-zones';
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
export const errorHandler: express.ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(errorBody(err.code, err.message));
    return;
  }
  if (err instanceof ProjectNotFoundError) {
    res.status(400).json(errorBody(err.code, err.message));
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
