import { ErrorCodes } from '@taleart/contract';
import { HttpError } from './errors';

/** Reads a required, non-blank string field from a JSON body. */
export function requiredString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new HttpError(400, ErrorCodes.validationFailed, `${field} is required`);
  }
  return text;
}
