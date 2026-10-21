// Public surface of the TaleArt contract (AD-3). Every shape here comes from
// openapi/openapi.yaml through the generated types; change the document, then
// run `npm exec nx -- run contract:generate`.
import type { components } from './generated/api';
import {
  contentStatusValues,
  errorCodeValues,
  importStatusValues,
  mediaContentTypeValues,
  userRoleValues,
} from './generated/api';

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
export type UpdateFrameRequest = Schemas['UpdateFrameRequest'];
export type TaleGroup = Schemas['TaleGroup'];
export type ZoneTaleGroup = Schemas['ZoneTaleGroup'];
export type ProjectTaleGroup = Schemas['ProjectTaleGroup'];
export type CreateTaleGroupRequest = Schemas['CreateTaleGroupRequest'];
export type RenameTaleGroupRequest = Schemas['RenameTaleGroupRequest'];
export type CopyTaleGroupRequest = Schemas['CopyTaleGroupRequest'];
export type Tag = Schemas['Tag'];
export type TaleGroupTag = Schemas['TaleGroupTag'];
export type CreateTagRequest = Schemas['CreateTagRequest'];
export type SetTaleGroupTagsRequest = Schemas['SetTaleGroupTagsRequest'];
export type Tale = Schemas['Tale'];
export type CreateTaleRequest = Schemas['CreateTaleRequest'];
export type OrderTaleGroupsRequest = Schemas['OrderTaleGroupsRequest'];
export type OrderTalesRequest = Schemas['OrderTalesRequest'];
export type ContentStatus = Schemas['ContentStatus'];
export type SetStatusRequest = Schemas['SetStatusRequest'];
export type SettableStatus = SetStatusRequest['status'];
export type TaleMedia = Schemas['TaleMedia'];
export type MediaKind = Schemas['MediaKind'];
export type MediaContentType = Schemas['MediaContentType'];
export type UserRole = Schemas['UserRole'];
export type User = Schemas['User'];
export type AuthState = Schemas['AuthState'];
export type SetupRequest = Schemas['SetupRequest'];
export type SignedIn = Schemas['SignedIn'];
export type RedeemInvitationRequest = Schemas['RedeemInvitationRequest'];
export type Invitation = Schemas['Invitation'];
export type InvitationPreview = Schemas['InvitationPreview'];
export type PasskeyCreationOptions = Schemas['PasskeyCreationOptions'];
export type PasskeyRequestOptions = Schemas['PasskeyRequestOptions'];
export type PasskeyResponse = Schemas['PasskeyResponse'];
export type ZoneKeyInfo = Schemas['ZoneKeyInfo'];
export type IssuedZoneKey = Schemas['IssuedZoneKey'];
export type DeliveryFrame = Schemas['DeliveryFrame'];
export type DeliveryZone = Schemas['DeliveryZone'];
export type DeliveryTaleGroup = Schemas['DeliveryTaleGroup'];
export type DeliveryTale = Schemas['DeliveryTale'];
export type DeliveryMedia = Schemas['DeliveryMedia'];
export type Findanother toolAppsRequest = Schemas['Findanother toolAppsRequest'];
export type another toolApp = Schemas['another toolApp'];
export type StartImportRequest = Schemas['StartImportRequest'];
export type ImportStatus = Schemas['ImportStatus'];
export type ImportStarted = Schemas['ImportStarted'];
export type ImportCount = Schemas['ImportCount'];
export type ImportReport = Schemas['ImportReport'];
export type ImportJob = Schemas['ImportJob'];
export type ErrorCode = Schemas['ErrorCode'];
export type ErrorBody = Schemas['ErrorBody'];

/** Every machine error code the API can return. */
export const ERROR_CODES: readonly ErrorCode[] = errorCodeValues;

/** Every role a user can have. */
export const USER_ROLES: readonly UserRole[] = userRoleValues;

/** Every state an import job can be in. */
export const IMPORT_STATUSES: readonly ImportStatus[] = importStatusValues;

/** True while an import job still has work ahead: queued or running. */
export function isImportActive(status: ImportStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** The http-only cookie holding the session token (AD-9). */
export const SESSION_COOKIE = 'taleart_session';

/** The http-only cookie that finds a pending passkey challenge on the server. */
export const CHALLENGE_COOKIE = 'taleart_challenge';

/** How long an invitation link can be used. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The dashboard path an invitation link opens: `/invite/<token>`. */
export function invitationPath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/** Delivery API base path (AD-2): SDKs only, zone keys only. */
export const DELIVERY_API_BASE = '/delivery/v1';

/** Base path of public media (AD-11): no session and no zone key. */
export const PUBLIC_MEDIA_BASE = '/media';

/**
 * The absolute public URL of a published tale's media (AD-11):
 * `<apiUrl>/media/<key>`. The key's slashes stay as they are; each segment is encoded.
 */
export function publicMediaUrl(apiUrl: string, key: string): string {
  const path = key.split('/').map(encodeURIComponent).join('/');
  return `${apiUrl.replace(/\/+$/, '')}${PUBLIC_MEDIA_BASE}/${path}`;
}

/** Every zone key starts with this (AD-9). */
export const ZONE_KEY_PREFIX = 'tak_';

/** How many characters of a key, after {@link ZONE_KEY_PREFIX}, its display prefix shows. */
export const ZONE_KEY_PREFIX_CHARS = 6;

/** The display prefix of a zone key: `tak_` and the next 6 characters. */
export function zoneKeyPrefix(key: string): string {
  return key.slice(0, ZONE_KEY_PREFIX.length + ZONE_KEY_PREFIX_CHARS);
}

/** The most characters a tag name holds, after trimming. */
export const MAX_TAG_NAME_LENGTH = 40;

/**
 * A tag name as it is stored: trimmed. Null when it is blank or longer than
 * {@link MAX_TAG_NAME_LENGTH} characters (counted as code points, as PostgreSQL does).
 */
export function normalizeTagName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_TAG_NAME_LENGTH ? name : null;
}

/** The most tales one tale group holds (FR-010). */
export const MAX_TALES_PER_GROUP = 100;

/** Every content type a tale's media may have. */
export const MEDIA_CONTENT_TYPES: readonly MediaContentType[] = mediaContentTypeValues;

/** The largest image (GIF included) a tale accepts, in bytes: 10 MB. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The largest video a tale accepts, in bytes: 100 MB. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** True when `value` is one of {@link MEDIA_CONTENT_TYPES}. */
export function isMediaContentType(value: unknown): value is MediaContentType {
  return (MEDIA_CONTENT_TYPES as readonly unknown[]).includes(value);
}

/** `video` for the video types, `image` for the rest (GIF included). */
export function mediaKind(contentType: MediaContentType): MediaKind {
  return contentType.startsWith('video/') ? 'video' : 'image';
}

/** The largest file of this type a tale accepts, in bytes. */
export function maxMediaBytes(contentType: MediaContentType): number {
  return mediaKind(contentType) === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/** Where the Management API serves a tale's media. Content stores only a storage key (AD-11). */
export function taleMediaUrl(taleId: string): string {
  return `/api/v1/tales/${encodeURIComponent(taleId)}/media`;
}

/** Every status key of the AD-6 scheme. */
export const CONTENT_STATUSES: readonly ContentStatus[] = contentStatusValues;

/**
 * The HTTP code of each status key (AD-6), defined here once. `draft` maps to
 * 204 as an [ASSUMPTION] the user confirms.
 */
export const CONTENT_STATUS_HTTP_CODES: Readonly<Record<ContentStatus, number>> = {
  draft: 204,
  live: 200,
  scheduled: 202,
  processing: 102,
  'invalid-media': 422,
  paused: 403,
  'blocked-by-group': 423,
  expired: 410,
  'quota-reached': 429,
  archived: 404,
};

/** The HTTP code of a status key (AD-6). */
export function statusHttpCode(status: ContentStatus): number {
  return CONTENT_STATUS_HTTP_CODES[status];
}

/** True when `value` is one of {@link CONTENT_STATUSES}. */
export function isContentStatus(value: unknown): value is ContentStatus {
  return (CONTENT_STATUSES as readonly unknown[]).includes(value);
}

/** The status keys a person sets on a tale group or tale: publish, pause (or restore), archive. */
export const SETTABLE_STATUSES: readonly SettableStatus[] = ['live', 'paused', 'archived'];

/** True when `value` is one of {@link SETTABLE_STATUSES}. */
export function isSettableStatus(value: unknown): value is SettableStatus {
  return (SETTABLE_STATUSES as readonly unknown[]).includes(value);
}

/**
 * The stored statuses each settable status may be set from, the same for tale
 * groups and tales: publish (`live`) from draft or paused; pause (`paused`)
 * from live, or restore from archived; archive from draft, live or paused.
 */
const STATUS_SOURCES: Readonly<Record<SettableStatus, readonly ContentStatus[]>> = {
  live: ['draft', 'paused'],
  paused: ['live', 'archived'],
  archived: ['draft', 'live', 'paused'],
};

/**
 * True when content stored as `from` may be set to `to`. Setting the current
 * status again is allowed and changes nothing.
 */
export function canSetStatus(from: ContentStatus, to: SettableStatus): boolean {
  return from === to || STATUS_SOURCES[to].includes(from);
}

/** The statuses content stored as `from` can be set to, other than itself, in action order. */
export function nextStatuses(from: ContentStatus): SettableStatus[] {
  return SETTABLE_STATUSES.filter((to) => to !== from && STATUS_SOURCES[to].includes(from));
}

/**
 * A tale's status as read (AD-6): `blocked-by-group` while the tale is live
 * and its group is paused, else the tale's stored key.
 */
export function readTaleStatus(stored: ContentStatus, groupStatus: ContentStatus): ContentStatus {
  return stored === 'live' && groupStatus === 'paused' ? 'blocked-by-group' : stored;
}

/** Named error codes, so callers don't repeat string literals. */
export const ErrorCodes = {
  validationFailed: 'validation_failed',
  projectNotFound: 'project_not_found',
  notFound: 'not_found',
  zoneNotFound: 'zone_not_found',
  unknownFrameType: 'unknown_frame_type',
  invalidFrameSettings: 'invalid_frame_settings',
  frameNotFound: 'frame_not_found',
  taleGroupNotFound: 'tale_group_not_found',
  taleGroupFull: 'tale_group_full',
  taleNotFound: 'tale_not_found',
  orderMismatch: 'order_mismatch',
  mediaNotFound: 'media_not_found',
  unsupportedMediaType: 'unsupported_media_type',
  mediaTooLarge: 'media_too_large',
  unauthenticated: 'unauthenticated',
  setupClosed: 'setup_closed',
  passkeyFailed: 'passkey_failed',
  forbidden: 'forbidden',
  invitationInvalid: 'invitation_invalid',
  emailTaken: 'email_taken',
  tagExists: 'tag_exists',
  tagNotFound: 'tag_not_found',
  zoneKeyNotFound: 'zone_key_not_found',
  invalidZoneKey: 'invalid_zone_key',
  another toolTokenInvalid: 'another tool_token_invalid',
  another toolUnavailable: 'another tool_unavailable',
  importerNotConfigured: 'importer_not_configured',
  invalidStatusTransition: 'invalid_status_transition',
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

/**
 * The settings of a `bar` frame, as `frame-types/bar.schema.json` defines them
 * (epic web zones R2). The schema is the source of the values and defaults;
 * the Delivery API returns every field, filled with its default when unset.
 */
export interface BarSettings {
  shape: 'circle' | 'rounded-square';
  size: 'small' | 'medium' | 'large';
  showTitles: boolean;
  alignment: 'start' | 'center';
  /** Space between items in px, 4 to 24. */
  gap: number;
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
