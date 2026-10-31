// The TaleArt contract (AD-3) without the theme, tale document and text style
// helpers: `@taleart/contract/core`. Every shape here comes from
// openapi/openapi.yaml through the generated types; change the document, then
// run `npm exec nx -- run contract:generate`.
import type { components } from '../generated/api';
import {
  contentStatusValues,
  errorCodeValues,
  mediaContentTypeValues,
  userRoleValues,
} from '../generated/api';
import type { ThemeSettings } from './theme';

export type { paths, operations, components } from '../generated/api';

type Schemas = components['schemas'];

export type Health = Schemas['Health'];
export type Project = Schemas['Project'];
export type CreateProjectRequest = Schemas['CreateProjectRequest'];
export type Zone = Schemas['Zone'];
export type CreateZoneRequest = Schemas['CreateZoneRequest'];
export type UpdateZoneRequest = Schemas['UpdateZoneRequest'];
export type FrameType = Schemas['FrameType'];
/** A zone's display (AD-5, AD-17): a frame row, at most one per zone. The UI says Display. */
export type Frame = Schemas['Frame'];
export type SetFrameRequest = Schemas['SetFrameRequest'];
export type UpdateFrameRequest = Schemas['UpdateFrameRequest'];
export type TaleGroup = Schemas['TaleGroup'];
export type ZoneTaleGroup = Schemas['ZoneTaleGroup'];
export type ProjectTaleGroup = Schemas['ProjectTaleGroup'];
export type CreateTaleGroupRequest = Schemas['CreateTaleGroupRequest'];
export type RenameTaleGroupRequest = Schemas['RenameTaleGroupRequest'];
export type CopyTaleGroupRequest = Schemas['CopyTaleGroupRequest'];
export type DuplicateTaleRequest = Schemas['DuplicateTaleRequest'];
export type Tag = Schemas['Tag'];
export type TaleGroupTag = Schemas['TaleGroupTag'];
export type CreateTagRequest = Schemas['CreateTagRequest'];
export type SetTaleGroupTagsRequest = Schemas['SetTaleGroupTagsRequest'];
/** Sets a tale group's audience rule (epic viewer properties), or clears it with `null`. */
export type SetTaleGroupAudienceRequest = Schemas['SetTaleGroupAudienceRequest'];
/** A user list as a tale group is targeted to it (epic targeting R4), with its ID count, never its IDs. */
export type TaleGroupUserList = Schemas['TaleGroupUserList'];
export type SetTaleGroupUserListsRequest = Schemas['SetTaleGroupUserListsRequest'];
/** A tale group a user list targets. */
export type UserListTaleGroup = Schemas['UserListTaleGroup'];
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
/** The role matrix (`GET /roles`): each role with its permissions. */
export type ProjectRoleMatrix = Schemas['ProjectRoleMatrix'];
/** A user's membership of a project as members.manage and project.view callers see it. */
export type ProjectMember = Schemas['ProjectMember'];
export type AddProjectMemberRequest = Schemas['AddProjectMemberRequest'];
export type UpdateProjectMemberRequest = Schemas['UpdateProjectMemberRequest'];
export type CreateInvitationRequest = Schemas['CreateInvitationRequest'];
/** A pending invitation as the project's managers list it (never its link). */
export type PendingInvitation = Schemas['PendingInvitation'];
export type ProjectAuditAction = Schemas['ProjectAuditAction'];
export type ProjectAuditEntry = Schemas['ProjectAuditEntry'];
export type ProjectAuditLog = Schemas['ProjectAuditLog'];
export type User = Schemas['User'];
export type AuthState = Schemas['AuthState'];
/** A sign-in method on for the sign-in page: its id, label and kind (no configuration, no secret). */
export type AuthMethod = Schemas['AuthMethod'];
export type AuthMethodKind = Schemas['AuthMethodKind'];
export type PasswordSignInRequest = Schemas['PasswordSignInRequest'];
/** The password variant of setup and of an invitation: the name and email, then the username and password. */
export type PasswordRegistrationRequest = Schemas['PasswordRegistrationRequest'];
export type PasswordResetPreview = Schemas['PasswordResetPreview'];
export type RedeemPasswordResetRequest = Schemas['RedeemPasswordResetRequest'];
export type SetPasswordRequest = Schemas['SetPasswordRequest'];
/** The signed-in user's sign-in methods (My sign-in methods). Never a password or a secret. */
export type AccountMethods = Schemas['AccountMethods'];
export type AccountPasskey = Schemas['AccountPasskey'];
export type AccountIdentity = Schemas['AccountIdentity'];
export type AuthSettings = Schemas['AuthSettings'];
export type UpdateAuthSettingsRequest = Schemas['UpdateAuthSettingsRequest'];
export type AuthProviderKind = Schemas['AuthProviderKind'];
/** The non-secret settings of a provider; only the fields of its kind are set. */
export type AuthProviderConfig = Schemas['AuthProviderConfig'];
/** An external identity provider as the admin sees it: its settings, whether its secret is stored, never the secret. */
export type AuthProvider = Schemas['AuthProvider'];
export type SaveAuthProviderRequest = Schemas['SaveAuthProviderRequest'];
/** A password reset link, the only time its URL is shown. */
export type PasswordResetLink = Schemas['PasswordResetLink'];
export type SetupRequest = Schemas['SetupRequest'];
export type SignedIn = Schemas['SignedIn'];
export type RedeemInvitationRequest = Schemas['RedeemInvitationRequest'];
export type Invitation = Schemas['Invitation'];
export type InvitationPreview = Schemas['InvitationPreview'];
export type PasskeyCreationOptions = Schemas['PasskeyCreationOptions'];
export type PasskeyRequestOptions = Schemas['PasskeyRequestOptions'];
export type PasskeyResponse = Schemas['PasskeyResponse'];
/** A project's active site key as the dashboard shows it (AD-9 amended): prefix and date, never the key. */
/** A zone's active key as the dashboard shows it (AD-9): prefix and date, never the key. */
export type ZoneKeyInfo = Schemas['ZoneKeyInfo'];
/** A newly issued zone key, the only time the key itself is shown. */
export type IssuedZoneKey = Schemas['IssuedZoneKey'];
/** A project's active site key as the dashboard shows it (AD-9 amended): prefix and date, never the key. */
export type SiteKeyInfo = Schemas['SiteKeyInfo'];
export type InstallInfo = Schemas['InstallInfo'];
export type IssueSiteKeyRequest = Schemas['IssueSiteKeyRequest'];
/** A newly issued site key, the only time the key itself is shown. */
export type IssuedSiteKey = Schemas['IssuedSiteKey'];
/** A personal API token as its user sees it (epic developer experience 10.1): prefix and scope, never the token. */
export type ApiToken = Schemas['ApiToken'];
export type CreateApiTokenRequest = Schemas['CreateApiTokenRequest'];
/** A newly created API token, the only time the token itself is shown. */
export type IssuedApiToken = Schemas['IssuedApiToken'];
export type RevokedApiTokens = Schemas['RevokedApiTokens'];
/** A user of the install as an admin sees it (Users page): the sign-in methods held, never a secret. */
export type AdminUser = Schemas['AdminUser'];
/** The install's users for an admin, ordered by creation; `truncated` when the list was cut short. */
export type AdminUserList = Schemas['AdminUserList'];
/** The API token making the request, with its user (epic developer experience 10.3): what `taleart whoami` shows. */
export type CurrentApiToken = Schemas['CurrentApiToken'];
export type DeliveryFrame = Schemas['DeliveryFrame'];
export type DeliveryZone = Schemas['DeliveryZone'];
export type DeliveryTaleGroup = Schemas['DeliveryTaleGroup'];
export type DeliveryTale = Schemas['DeliveryTale'];
export type DeliveryMedia = Schemas['DeliveryMedia'];
export type DeliveryCover = Schemas['DeliveryCover'];
export type DeliveryTaleDocument = Schemas['DeliveryTaleDocument'];
export type DeliveryTaleElement = Schemas['DeliveryTaleElement'];
/** A project font a delivered tale uses (epic Tale Studio R18): its public URL and face descriptors. */
export type DeliveryFont = Schemas['DeliveryFont'];
/** A font face uploaded to a project (epic Tale Studio R18). */
export type ProjectFont = Schemas['ProjectFont'];
/** An image or video of a project, which tale documents reference by key (epic Tale Studio R5). */
export type ProjectMedia = Schemas['ProjectMedia'];
/** A delivered canvas: a media background's key is its public URL (AD-11). */
export type DeliveryCanvas = Schemas['DeliveryCanvas'];
export type ErrorCode = Schemas['ErrorCode'];
export type ErrorBody = Schemas['ErrorBody'];
/**
 * A project's theme (epic web zones R9): the fields it sets and the complete
 * theme. The generator marks fields with a default as required, so `theme`
 * is typed as the partial {@link ThemeSettings} here.
 */
export type ProjectTheme = Omit<Schemas['ProjectTheme'], 'theme'> & { theme: ThemeSettings };

export * from './templates';
export * from './visibility';
export * from './targeting';
export * from './audience-rule';
export * from './audience';
export * from './user-lists';
export * from './external-user-id';
export * from './analytics';
export * from './project-roles';

/** Every machine error code the API can return. */
export const ERROR_CODES: readonly ErrorCode[] = errorCodeValues;

/** Every role a user can have. */
export const USER_ROLES: readonly UserRole[] = userRoleValues;

/** The http-only cookie holding the session token (AD-9). */
export const SESSION_COOKIE = 'taleart_session';

/** The http-only cookie that finds a pending passkey challenge on the server. */
export const CHALLENGE_COOKIE = 'taleart_challenge';

/** The http-only cookie that binds an external provider sign-in to this browser (spec: taleart_oauth). */
export const OAUTH_COOKIE = 'taleart_oauth';

/**
 * The short codes an external provider sign-in ends with, in the redirect to the dashboard
 * (`?auth_error=<code>`) and as the code of a refused start. Never provider text.
 */
export const PROVIDER_AUTH_ERROR_CODES = [
  'sign_in_failed',
  'email_not_verified',
  'email_mismatch',
  'email_taken',
  'setup_closed',
  'invitation_invalid',
  'identity_in_use',
  'session_required',
  'discovery_failed',
  'provider_unavailable',
] as const;

/** One of {@link PROVIDER_AUTH_ERROR_CODES}. */
export type ProviderAuthErrorCode = (typeof PROVIDER_AUTH_ERROR_CODES)[number];

/** How long an invitation link can be used. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a password reset link can be used (admin-issued, one time). */
export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

/** The fewest and most characters of a password (any characters, no composition rules). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** The fewest and most characters of a username; stored in lower case. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 40;

/** The dashboard path a password reset link opens: `/password-reset/<token>`. */
export function passwordResetPath(token: string): string {
  return `/password-reset/${encodeURIComponent(token)}`;
}

/** The dashboard path an invitation link opens: `/invite/<token>`. */
export function invitationPath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/** Delivery API base path (AD-2): SDKs only, zone keys and site keys only. */
export const DELIVERY_API_BASE = '/delivery/v1';

/** Base path of public media (AD-11): no session and no zone or site key. */
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

/** Every site key starts with this (AD-9 amended, epic UX rework R3). */
export const SITE_KEY_PREFIX = 'tas_';

/** How many characters of a site key, after {@link SITE_KEY_PREFIX}, its display prefix shows. */
export const SITE_KEY_PREFIX_CHARS = 6;

/** The display prefix of a site key: `tas_` and the next 6 characters. */
export function siteKeyPrefix(key: string): string {
  return key.slice(0, SITE_KEY_PREFIX.length + SITE_KEY_PREFIX_CHARS);
}

/** Every personal API token starts with this (epic developer experience 10.1); site keys start `tas_`. */
export const API_TOKEN_PREFIX = 'tat_';

/** How many characters of an API token, after {@link API_TOKEN_PREFIX}, its display prefix shows. */
export const API_TOKEN_PREFIX_CHARS = 6;

/** The display prefix of an API token: `tat_` and the next 6 characters. */
export function apiTokenPrefix(token: string): string {
  return token.slice(0, API_TOKEN_PREFIX.length + API_TOKEN_PREFIX_CHARS);
}

/** The most active (not revoked) API tokens one user holds. */
export const MAX_API_TOKENS_PER_USER = 50;

/** The longest name of an API token, in characters. */
export const MAX_API_TOKEN_NAME_LENGTH = 80;

/** The most projects one API token can be limited to. */
export const MAX_API_TOKEN_PROJECTS = 100;

/**
 * Base path of what the API serves to host pages besides the Delivery API (epic UX rework R13): the
 * Web SDK bundle and the test page. Its version follows the Delivery API's: the bundle at
 * `/sdk/v1/taleart.js` always reads `/delivery/v1`.
 */
export const SDK_BASE = '/sdk/v1';

/** The Web SDK bundle (an ES module) a host page loads: `<apiUrl>/sdk/v1/taleart.js`. */
export const SDK_BUNDLE_PATH = `${SDK_BASE}/taleart.js`;

/** The TaleArt-served test page that shows one zone: `<apiUrl>/sdk/v1/test-page#zoneKey=<key>`. */
export const SDK_TEST_PAGE_PATH = `${SDK_BASE}/test-page`;

/** The URL fragment parameter of the test page that holds the zone key (never the query: it would reach logs). */
export const TEST_PAGE_KEY_PARAM = 'zoneKey';

/** The npm package that ships the Web SDK (`npm i @lempert/taleart`). */
export const SDK_NPM_PACKAGE = '@lempert/taleart';

/** How long browsers keep the SDK at its stable URL ({@link SDK_BUNDLE_PATH}): five minutes, so a deploy reaches pages soon. */
export const SDK_CACHE_SECONDS = 300;

/** How long browsers keep the SDK at its pinned URL (`taleart.<hash>.js`): a year, since that file never changes. */
export const SDK_PINNED_CACHE_SECONDS = 31_536_000;

/**
 * How many SDK builds the API keeps serving at their pinned URLs unless SDK_BUILDS_KEPT says
 * otherwise, the current one included (story 8.21): a pinned page keeps working through this many
 * SDK builds the server serves, less one. `InstallInfo.sdkBuildsKept` gives the server's own number.
 */
export const DEFAULT_SDK_BUILDS_KEPT = 5;

/** What the install snippet says in place of the zone key when the key is not at hand (it is shown only once). */
export const ZONE_KEY_PLACEHOLDER = 'YOUR_ZONE_KEY';

/** The optional line of the snippet that shows the Web SDK's `Taleart.init` (every option is optional). */
export const INIT_SNIPPET_COMMENT = '<!-- Optional, once per page: <script>Taleart.init({ locale: "en" })</script> -->';

// An HTML attribute value in double quotes: the characters that could end it or start markup.
function htmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The script tag that loads the Web SDK as an ES module, from `info.sdkUrl`. */
export function sdkScriptTag(info: Pick<InstallInfo, 'sdkUrl'>): string {
  return `<script type="module" src="${htmlAttribute(info.sdkUrl)}"></script>`;
}

/**
 * The script tag that loads the Web SDK pinned to one build (`sdkPinnedUrl`) with Subresource
 * Integrity (`sdkIntegrity`), or null when the API has no bundle. `crossorigin` makes the browser
 * check the integrity of a file from another origin.
 */
export function pinnedSdkScriptTag(info: Pick<InstallInfo, 'sdkPinnedUrl' | 'sdkIntegrity'>): string | null {
  if (!info.sdkPinnedUrl || !info.sdkIntegrity) return null;
  return `<script type="module" src="${htmlAttribute(info.sdkPinnedUrl)}" integrity="${htmlAttribute(info.sdkIntegrity)}" crossorigin="anonymous"></script>`;
}

/**
 * One `<taleart-view>` that shows a zone by its zone key (or {@link ZONE_KEY_PLACEHOLDER}), escaped
 * for a double-quoted attribute. The key names the zone, so the element needs no slug and no API URL
 * (the script's origin is the default). A page with several zones has one of these per zone key.
 */
export function zoneElement(zoneKey: string | null): string {
  return `<taleart-view zone-key="${htmlAttribute(zoneKey || ZONE_KEY_PLACEHOLDER)}"></taleart-view>`;
}

/**
 * The copy-ready HTML that shows a zone on a host page: the Web SDK's script tag, the optional
 * `Taleart.init` line and the zone's `<taleart-view>`. The dashboard's Install tab and the docs app
 * both show this text, and the docs check holds the Web SDK README to it.
 */
export function installSnippet(info: Pick<InstallInfo, 'sdkUrl'>, zoneKey: string | null): string {
  return [sdkScriptTag(info), INIT_SNIPPET_COMMENT, zoneElement(zoneKey)].join('\n');
}

/**
 * The npm variant of the snippet: the install command, the import that also gives `init`, and the
 * zone's `<taleart-view>` for the HTML. Used where the host app bundles the Web SDK itself.
 */
export function npmSnippet(zoneKey: string | null): string {
  return [
    `npm i ${SDK_NPM_PACKAGE}`,
    `import { init } from '${SDK_NPM_PACKAGE}';`,
    '// Optional, once per page: init({ locale: "en" })',
    zoneElement(zoneKey),
  ].join('\n');
}

/**
 * The test page for a zone: the zone key, when given, in the URL fragment (`#zoneKey=…`), which the
 * browser never sends to a server or in a Referer. Without a key the page asks for one.
 */
export function testPageLink(info: Pick<InstallInfo, 'testPageUrl'>, zoneKey: string | null): string {
  return zoneKey ? `${info.testPageUrl}#${TEST_PAGE_KEY_PARAM}=${encodeURIComponent(zoneKey)}` : info.testPageUrl;
}

/** The Delivery API's query parameter that names a zone by its slug, sent with a site key. */
export const DELIVERY_ZONE_PARAM = 'zone';

/** The most characters a tale group's name holds, after trimming (counted as code points). */
export const MAX_TALE_GROUP_NAME_LENGTH = 100;

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

/** The most characters a zone slug holds (epic UX rework R1). */
export const MAX_ZONE_SLUG_LENGTH = 64;

/**
 * A zone slug: lowercase letters and digits in words joined by single
 * hyphens, such as `home-top`, unique in the zone's project (epic UX rework
 * R1, AD-17). A host page names the zone with it in `zone="<slug>"`.
 */
export const ZONE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** True when `value` is a valid zone slug: {@link ZONE_SLUG_PATTERN}, at most {@link MAX_ZONE_SLUG_LENGTH} characters. */
export function isZoneSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ZONE_SLUG_LENGTH && ZONE_SLUG_PATTERN.test(value);
}

/**
 * A zone slug suggested from a name: lowercase ASCII letters and digits,
 * every other run of characters a hyphen, trimmed to {@link MAX_ZONE_SLUG_LENGTH}.
 * '' when the name has no letter or digit to keep.
 */
export function zoneSlugFromName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.join('-').slice(0, MAX_ZONE_SLUG_LENGTH).replace(/-+$/, '');
}

/**
 * `base`, or `base-2`, `base-3`, … : the first that `taken` does not hold, cut so it stays
 * within {@link MAX_ZONE_SLUG_LENGTH} characters. An empty base reads `zone`.
 */
export function uniqueZoneSlug(base: string, taken: (slug: string) => boolean): string {
  const root = (base || 'zone').slice(0, MAX_ZONE_SLUG_LENGTH).replace(/-+$/, '');
  if (!taken(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const slug = `${root.slice(0, MAX_ZONE_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken(slug)) return slug;
  }
}

/** The most tales one tale group holds (FR-010). */
export const MAX_TALES_PER_GROUP = 100;

/**
 * The most tale groups that are not archived one project holds (epic UX rework R14). Archived groups
 * do not count: archiving one frees a place, and restoring one needs a free place.
 */
export const MAX_TALE_GROUPS_PER_PROJECT = 500;

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
 * stored tale media passes.
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

/** Where the Management API serves a file of the project's media (epic Tale Studio R5), with a session. */
export function projectMediaFileUrl(projectId: string, key: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/media/file?key=${encodeURIComponent(key)}`;
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
 * and its group is Off (`draft` or `paused`, amended 2026-10-23), else
 * {@link readContentStatus} of the tale's stored key and its own window. The
 * group's window does not change the tale's status; the Delivery API checks
 * both windows.
 */
export function readTaleStatus(
  stored: ContentStatus,
  groupStatus: ContentStatus,
  window: ScheduleWindow = OPEN_WINDOW,
  now: Date = new Date(),
): ContentStatus {
  if (stored === 'live' && (groupStatus === 'draft' || groupStatus === 'paused')) return 'blocked-by-group';
  return readContentStatus(stored, window, now);
}

/**
 * How the dashboard shows a tale group's stored status (AD-6, amended
 * 2026-10-23, owner decisions D2 and D3): `on` for `live`, `archived` for
 * `archived`, else `off` (`draft`, `paused` and any key a process set).
 * Display names only: nothing stores them.
 */
export type GroupShownStatus = 'on' | 'off' | 'archived';

/** How the dashboard shows a tale's stored status: `shown` for `live`, `archived`, else `hidden`. */
export type TaleShownStatus = 'shown' | 'hidden' | 'archived';

/** The words for each shown status, defined once. */
export const SHOWN_STATUS_LABELS: Readonly<Record<GroupShownStatus | TaleShownStatus, string>> = {
  on: 'On',
  off: 'Off',
  shown: 'Shown',
  hidden: 'Hidden',
  archived: 'Archived',
};

/** A tale group's shown status from its stored key: On (`live`), Off (`draft`, `paused`), Archived. */
export function groupShownStatus(stored: ContentStatus): GroupShownStatus {
  return stored === 'live' ? 'on' : stored === 'archived' ? 'archived' : 'off';
}

/** A tale's shown status from its stored key: Shown (`live`), Hidden (`draft`, `paused`), Archived. */
export function taleShownStatus(stored: ContentStatus): TaleShownStatus {
  return stored === 'live' ? 'shown' : stored === 'archived' ? 'archived' : 'hidden';
}

/**
 * The stored key the On/Off (group) or Shown/Hidden (tale) switch sets (AD-6):
 * `live` to turn on or show, `paused` to turn off or hide; null when content
 * stored as `stored` is already there (a `draft` is already Off and Hidden) or
 * the switch does not apply (archived, or a key a process set, such as
 * `processing`).
 */
export function switchStatus(stored: ContentStatus, on: boolean): SettableStatus | null {
  if (!isSwitchable(stored)) return null;
  if (on) return stored === 'live' ? null : 'live';
  return stored === 'live' ? 'paused' : null;
}

/** True when the On/Off or Shown/Hidden switch applies to content stored as `stored`: `draft`, `live` or `paused`. */
export function isSwitchable(stored: ContentStatus): boolean {
  return stored === 'draft' || stored === 'live' || stored === 'paused';
}

/** The stored key of a new tale (AD-6 amended): `live`, so a group turned On shows it. New groups start `draft`. */
export const NEW_TALE_STATUS: ContentStatus = 'live';

/** The stored key of a new tale group (AD-6 amended): `draft`, which shows as Off. */
export const NEW_TALE_GROUP_STATUS: ContentStatus = 'draft';

/** Named error codes, so callers don't repeat string literals. */
export const ErrorCodes = {
  validationFailed: 'validation_failed',
  projectNotFound: 'project_not_found',
  notFound: 'not_found',
  zoneNotFound: 'zone_not_found',
  unknownFrameType: 'unknown_frame_type',
  invalidFrameSettings: 'invalid_frame_settings',
  invalidTheme: 'invalid_theme',
  displayNotFound: 'display_not_found',
  displayExists: 'display_exists',
  slugTaken: 'slug_taken',
  taleGroupNotFound: 'tale_group_not_found',
  taleGroupFull: 'tale_group_full',
  taleGroupLimitReached: 'tale_group_limit_reached',
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
  siteKeyNotFound: 'site_key_not_found',
  siteKeyExists: 'site_key_exists',
  invalidSiteKey: 'invalid_site_key',
  apiTokenNotFound: 'api_token_not_found',
  apiTokenLimitReached: 'api_token_limit_reached',
  rateLimited: 'rate_limited',
  invalidStatusTransition: 'invalid_status_transition',
  taleGroupArchived: 'tale_group_archived',
  unknownTemplate: 'unknown_template',
  concurrentChange: 'concurrent_change',
  invalidTaleDocument: 'invalid_tale_document',
  taleDocumentTooLarge: 'tale_document_too_large',
  staleRevision: 'stale_revision',
  nothingToPublish: 'nothing_to_publish',
  fontNotFound: 'font_not_found',
  fontExists: 'font_exists',
  fontInUse: 'font_in_use',
  fontLimitReached: 'font_limit_reached',
  fontStorageFull: 'font_storage_full',
  mediaLimitReached: 'media_limit_reached',
  mediaStorageFull: 'media_storage_full',
  uploadBusy: 'upload_busy',
  lengthRequired: 'length_required',
  responseTargetNotFound: 'response_target_not_found',
  visitorIdRequired: 'visitor_id_required',
  userListNotFound: 'user_list_not_found',
  userListExists: 'user_list_exists',
  userListLimitReached: 'user_list_limit_reached',
  userListFileTooLarge: 'user_list_file_too_large',
  signInFailed: 'sign_in_failed',
  passwordRejected: 'password_rejected',
  usernameTaken: 'username_taken',
  passwordIncorrect: 'password_incorrect',
  passwordResetInvalid: 'password_reset_invalid',
  signInMethodDisabled: 'sign_in_method_disabled',
  lastSignInMethod: 'last_sign_in_method',
  signInLockout: 'sign_in_lockout',
  secretKeyMissing: 'secret_key_missing',
  providerNotFound: 'provider_not_found',
  identityInUse: 'identity_in_use',
  emailNotVerified: 'email_not_verified',
  emailMismatch: 'email_mismatch',
  sessionRequired: 'session_required',
  discoveryFailed: 'discovery_failed',
  providerUnavailable: 'provider_unavailable',
  userNotFound: 'user_not_found',
  memberExists: 'member_exists',
  memberNotFound: 'member_not_found',
  invitationNotFound: 'invitation_not_found',
  lastProjectAdmin: 'last_project_admin',
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
  /**
   * How each tale group is drawn (epic end-user redesign P4). `ring` is the default look. Optional in
   * this type so constants written before P4 still compile; the Delivery API always fills it.
   */
  layout?: 'ring' | 'chip' | 'poster' | 'stack';
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
  /**
   * How the slides are shown (epic end-user redesign P5). `carousel` is the default look. Optional in
   * this type like `BarSettings.layout`; the Delivery API always fills it.
   */
  variant?: 'carousel' | 'coverflow' | 'peek' | 'deck' | 'sticky' | 'strip';
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
