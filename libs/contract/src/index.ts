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
import type { ThemeSettings } from './lib/theme';

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
export type Stage = Schemas['Stage'];
export type CreateStageRequest = Schemas['CreateStageRequest'];
export type RenameStageRequest = Schemas['RenameStageRequest'];
export type ApplyPlaybookRequest = Schemas['ApplyPlaybookRequest'];
export type AppliedPlaybook = Schemas['AppliedPlaybook'];
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
export type SetScheduleRequest = Schemas['SetScheduleRequest'];
export type TaleMedia = Schemas['TaleMedia'];
export type TaleGroupCover = Schemas['TaleGroupCover'];
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
export type DeliveryStage = Schemas['DeliveryStage'];
export type DeliveryZone = Schemas['DeliveryZone'];
export type DeliveryTaleGroup = Schemas['DeliveryTaleGroup'];
export type DeliveryTale = Schemas['DeliveryTale'];
export type DeliveryMedia = Schemas['DeliveryMedia'];
export type DeliveryCover = Schemas['DeliveryCover'];
export type DeliveryTaleDocument = Schemas['DeliveryTaleDocument'];
export type DeliveryTaleElement = Schemas['DeliveryTaleElement'];
export type FindStorylyAppsRequest = Schemas['FindStorylyAppsRequest'];
export type StorylyApp = Schemas['StorylyApp'];
export type StartImportRequest = Schemas['StartImportRequest'];
export type ImportStatus = Schemas['ImportStatus'];
export type ImportStarted = Schemas['ImportStarted'];
export type ImportCount = Schemas['ImportCount'];
export type ImportReport = Schemas['ImportReport'];
export type ImportJob = Schemas['ImportJob'];
export type ImportJobSummary = Schemas['ImportJobSummary'];
export type ImportProgress = Schemas['ImportProgress'];
export type ImportProgressCount = Schemas['ImportProgressCount'];
export type ImportDifference = Schemas['ImportDifference'];
export type ImportDifferenceEntity = Schemas['ImportDifferenceEntity'];
export type ImportDifferenceKind = Schemas['ImportDifferenceKind'];
export type ImportDifferenceRecord = Schemas['ImportDifferenceRecord'];
export type ImportMediaFailure = Schemas['ImportMediaFailure'];
export type ImportTagFailure = Schemas['ImportTagFailure'];
export type ImportChangeCount = Schemas['ImportChangeCount'];
export type ImportChanges = Schemas['ImportChanges'];
export type ImportPreviewRequest = Schemas['ImportPreviewRequest'];
export type ImportPreview = Schemas['ImportPreview'];
export type ImportPreviewZone = Schemas['ImportPreviewZone'];
export type ImportSelection = Schemas['ImportSelection'];
export type ImportEntityChoice = Schemas['ImportEntityChoice'];
export type ImportNotSelected = Schemas['ImportNotSelected'];
export type ImportNotSelectedZone = Schemas['ImportNotSelectedZone'];
export type ErrorCode = Schemas['ErrorCode'];
export type ErrorBody = Schemas['ErrorBody'];
/**
 * A project's theme (epic web zones R9): the fields it sets and the complete
 * theme. The generator marks fields with a default as required, so `theme`
 * is typed as the partial {@link ThemeSettings} here.
 */
export type ProjectTheme = Omit<Schemas['ProjectTheme'], 'theme'> & { theme: ThemeSettings };

export * from './lib/theme';
export * from './lib/playbooks';
export * from './lib/tale-document';

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

/** What an import never brings across, listed once on every report. */
export const IMPORT_NOT_IMPORTED_BY_DESIGN: readonly string[] = ['Conversion records', 'Stats'];

/** The most differences one import report stores; the rest are only counted. */
export const MAX_IMPORT_REPORT_DIFFERENCES = 5000;

/** The most zones a preview lists and a selection may pick; the report lists as many not-selected zones. */
export const MAX_IMPORT_SELECTED_ZONES = 500;

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

/** True when the text holds a control character (U+0000 to U+001F, U+007F), which a tag name may not hold. */
export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * A tag name as it is stored: trimmed. Null when it is blank, longer than
 * {@link MAX_TAG_NAME_LENGTH} characters (counted as code points, as PostgreSQL does),
 * or holds a control character.
 */
export function normalizeTagName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (hasControlCharacter(name)) return null;
  const length = [...name].length;
  return length >= 1 && length <= MAX_TAG_NAME_LENGTH ? name : null;
}

/** The most characters a stage key holds (epic web zones R7). */
export const MAX_STAGE_KEY_LENGTH = 64;

/**
 * A stage key: lowercase letters and digits in words joined by single
 * hyphens, such as `home-top`. A host page names it in
 * `<taleart-view stage="<key>">`, so it is set on create and never changes.
 */
export const STAGE_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** True when `value` is a valid stage key: {@link STAGE_KEY_PATTERN}, at most {@link MAX_STAGE_KEY_LENGTH} characters. */
export function isStageKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_STAGE_KEY_LENGTH && STAGE_KEY_PATTERN.test(value);
}

/**
 * A stage key suggested from a stage name: lowercase ASCII letters and digits,
 * every other run of characters a hyphen, trimmed to {@link MAX_STAGE_KEY_LENGTH}.
 * '' when the name has no letter or digit to keep.
 */
export function stageKeyFromName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.join('-').slice(0, MAX_STAGE_KEY_LENGTH).replace(/-+$/, '');
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

function startsWithBytes(data: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  return data.length >= offset + bytes.length && bytes.every((b, i) => data[offset + i] === b);
}

const asciiBytes = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

// Magic numbers: the leading bytes each accepted type must start with.
const MEDIA_SIGNATURES: Record<MediaContentType, (data: Uint8Array) => boolean> = {
  'image/png': (d) => startsWithBytes(d, [0x89, 0x50, 0x4e, 0x47]),
  'image/jpeg': (d) => startsWithBytes(d, [0xff, 0xd8, 0xff]),
  'image/gif': (d) => startsWithBytes(d, asciiBytes('GIF8')),
  'image/webp': (d) => startsWithBytes(d, asciiBytes('RIFF')) && startsWithBytes(d, asciiBytes('WEBP'), 8),
  'video/mp4': (d) => startsWithBytes(d, asciiBytes('ftyp'), 4),
  'video/webm': (d) => startsWithBytes(d, [0x1a, 0x45, 0xdf, 0xa3]),
};

/** How many leading bytes {@link matchesMagicNumber} reads at most. */
export const MEDIA_MAGIC_BYTES = 12;

/**
 * True when the file's leading bytes match the declared type: the rule every
 * stored tale media passes, whether uploaded or imported.
 */
export function matchesMagicNumber(contentType: MediaContentType, data: Uint8Array): boolean {
  return MEDIA_SIGNATURES[contentType](data);
}

const MEDIA_EXTENSIONS: Record<MediaContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** The file extension a storage key gets for this type. */
export function mediaExtension(contentType: MediaContentType): string {
  return MEDIA_EXTENSIONS[contentType];
}

/** Where the Management API serves a tale's media. Content stores only a storage key (AD-11). */
export function taleMediaUrl(taleId: string): string {
  return `/api/v1/tales/${encodeURIComponent(taleId)}/media`;
}

/**
 * The largest animated tale group cover (a video, a GIF, an animated WebP or
 * an APNG), in bytes: 300 KB, so animated covers fit the 1.5 s budget (epic
 * web zones R10, R12). The cap is an [ASSUMPTION] the user confirms.
 */
export const MAX_ANIMATED_COVER_BYTES = 300 * 1024;

/** The largest cover of this type accepted, in bytes: 300 KB animated, else the tale media limit. */
export function maxCoverBytes(contentType: MediaContentType, animated: boolean): number {
  return animated ? MAX_ANIMATED_COVER_BYTES : maxMediaBytes(contentType);
}

/** Where the Management API serves a tale group's cover. Content stores only a storage key (AD-11). */
export function taleGroupCoverUrl(taleGroupId: string): string {
  return `/api/v1/tale-groups/${encodeURIComponent(taleGroupId)}/cover`;
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

/** A start and end time (AD-6): ISO 8601 UTC strings or Dates, null for an open bound. */
export interface ScheduleWindow {
  startsAt: string | Date | null;
  endsAt: string | Date | null;
}

/** No start and no end: always inside. */
export const OPEN_WINDOW: ScheduleWindow = { startsAt: null, endsAt: null };

function toMillis(value: string | Date): number {
  return typeof value === 'string' ? Date.parse(value) : value.getTime();
}

/**
 * Where `now` lies against a window: `before` its start, `after` its end
 * (the end itself counts as after), else `inside`. A missing bound is open.
 */
export function windowPosition(window: ScheduleWindow, now: Date = new Date()): 'before' | 'inside' | 'after' {
  const at = now.getTime();
  const { startsAt, endsAt } = window;
  if (startsAt && at < toMillis(startsAt)) return 'before';
  if (endsAt && at >= toMillis(endsAt)) return 'after';
  return 'inside';
}

/** True when the window contains `now`: at or after its start and before its end (AD-6). */
export function isInWindow(window: ScheduleWindow, now: Date = new Date()): boolean {
  return windowPosition(window, now) === 'inside';
}

/** True when a window is acceptable: an open bound, or an end later than the start. */
export function isValidWindow(window: ScheduleWindow): boolean {
  const { startsAt, endsAt } = window;
  return !startsAt || !endsAt || toMillis(endsAt) > toMillis(startsAt);
}

/**
 * Content's status as read (AD-6): a stored key other than `live` as stored
 * (paused content reads paused whatever its window); live content reads
 * `scheduled` before its start, `expired` from its end on, else `live`.
 * Nothing stores `scheduled` or `expired`.
 */
export function readContentStatus(
  stored: ContentStatus,
  window: ScheduleWindow,
  now: Date = new Date(),
): ContentStatus {
  if (stored !== 'live') return stored;
  const position = windowPosition(window, now);
  return position === 'before' ? 'scheduled' : position === 'after' ? 'expired' : 'live';
}

/**
 * A tale's status as read (AD-6): `blocked-by-group` while the tale is live
 * and its group is paused, else {@link readContentStatus} of the tale's
 * stored key and its own window. The group's window does not change the
 * tale's status; the Delivery API checks both windows.
 */
export function readTaleStatus(
  stored: ContentStatus,
  groupStatus: ContentStatus,
  window: ScheduleWindow = OPEN_WINDOW,
  now: Date = new Date(),
): ContentStatus {
  if (stored === 'live' && groupStatus === 'paused') return 'blocked-by-group';
  return readContentStatus(stored, window, now);
}

/** Named error codes, so callers don't repeat string literals. */
export const ErrorCodes = {
  validationFailed: 'validation_failed',
  projectNotFound: 'project_not_found',
  notFound: 'not_found',
  zoneNotFound: 'zone_not_found',
  unknownFrameType: 'unknown_frame_type',
  invalidFrameSettings: 'invalid_frame_settings',
  invalidTheme: 'invalid_theme',
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
  storylyTokenInvalid: 'storyly_token_invalid',
  storylyUnavailable: 'storyly_unavailable',
  importerNotConfigured: 'importer_not_configured',
  importSelectionInvalid: 'import_selection_invalid',
  previewBusy: 'preview_busy',
  invalidStatusTransition: 'invalid_status_transition',
  stageNotFound: 'stage_not_found',
  stageKeyTaken: 'stage_key_taken',
  unknownPlaybook: 'unknown_playbook',
  playbookAlreadyApplied: 'playbook_already_applied',
  concurrentChange: 'concurrent_change',
  invalidTaleDocument: 'invalid_tale_document',
  taleDocumentTooLarge: 'tale_document_too_large',
  staleRevision: 'stale_revision',
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

/**
 * The settings of a `banner` frame, as `frame-types/banner.schema.json`
 * defines them (epic web zones R3). The schema is the source of the values
 * and defaults; the Delivery API returns every field, filled with its default
 * when unset.
 */
export interface BannerSettings {
  aspectRatio: '16:9' | '3:1' | '1:1';
  autoplay: boolean;
  /** Seconds per slide while autoplaying, 3 to 15. */
  intervalSeconds: number;
  showDots: boolean;
  loop: boolean;
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
