// Public surface of the TaleArt contract (AD-3). Every shape here comes from
// openapi/openapi.yaml through the generated types; change the document, then
// run `npm exec nx -- run contract:generate`.
import type { components } from './generated/api';
import { errorCodeValues } from './generated/api';

export type { paths, operations, components } from './generated/api';

type Schemas = components['schemas'];

export type Health = Schemas['Health'];
export type Project = Schemas['Project'];
export type CreateProjectRequest = Schemas['CreateProjectRequest'];
export type Zone = Schemas['Zone'];
export type CreateZoneRequest = Schemas['CreateZoneRequest'];
export type ErrorCode = Schemas['ErrorCode'];
export type ErrorBody = Schemas['ErrorBody'];

/** Every machine error code the API can return. */
export const ERROR_CODES: readonly ErrorCode[] = errorCodeValues;

/** Named error codes, so callers don't repeat string literals. */
export const ErrorCodes = {
  validationFailed: 'validation_failed',
  projectNotFound: 'project_not_found',
  notFound: 'not_found',
  internalError: 'internal_error',
} as const satisfies Record<string, ErrorCode>;

/** True when a value has the standard `{ error: { code, message } }` shape. */
export function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
