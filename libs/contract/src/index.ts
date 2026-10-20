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
export type FrameType = Schemas['FrameType'];
export type Frame = Schemas['Frame'];
export type CreateFrameRequest = Schemas['CreateFrameRequest'];
export type ErrorCode = Schemas['ErrorCode'];
export type ErrorBody = Schemas['ErrorBody'];

/** Every machine error code the API can return. */
export const ERROR_CODES: readonly ErrorCode[] = errorCodeValues;

/** Named error codes, so callers don't repeat string literals. */
export const ErrorCodes = {
  validationFailed: 'validation_failed',
  projectNotFound: 'project_not_found',
  notFound: 'not_found',
  zoneNotFound: 'zone_not_found',
  unknownFrameType: 'unknown_frame_type',
  invalidFrameSettings: 'invalid_frame_settings',
  internalError: 'internal_error',
} as const satisfies Record<string, ErrorCode>;

/**
 * The frame-type registry (AD-5) is configuration, not code: it lives in
 * `libs/contract/frame-types/`, as `registry.json` plus one JSON Schema file
 * per type. A new type is a new entry and schema file, with no migration.
 * These are the shapes of that configuration; the API loads the files at start.
 */
export const FRAME_TYPE_REGISTRY_FILE = 'registry.json';

/** One entry of `frame-types/registry.json`. */
export interface FrameTypeRegistryEntry {
  /** Registry key, stored on each frame as `type`. */
  key: string;
  /** Name shown to dashboard users. */
  label: string;
  /** File name, next to `registry.json`, of the JSON Schema for `settings`. */
  schema: string;
}

/** The shape of `frame-types/registry.json`. */
export interface FrameTypeRegistryFile {
  types: FrameTypeRegistryEntry[];
}

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
