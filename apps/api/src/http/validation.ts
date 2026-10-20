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

/** Reads a required array of strings from a JSON body, such as the ids of an order request. */
export function requiredStringArray(body: unknown, field: string): string[] {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (!Array.isArray(value)) {
    throw new HttpError(400, ErrorCodes.validationFailed, `${field} must be an array of ids`);
  }
  if (!value.every((item): item is string => typeof item === 'string')) {
    throw new HttpError(400, ErrorCodes.validationFailed, `Every item of ${field} must be a string`);
  }
  return value;
}
