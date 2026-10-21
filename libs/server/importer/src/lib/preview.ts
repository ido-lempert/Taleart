import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { MAX_IMPORT_SELECTED_ZONES, type ImportPreviewZone, type ImportSelection } from '@taleart/contract';
import { StorylyUnavailableError } from './errors';
import { storedText } from './record-shape';
import {
  recordsOf,
  type CheckedList,
  type SourceStory,
  type SourceStoryGroup,
  type StorylyClient,
} from './storyly-client';

/** What an import takes when a selection was picked: the selection without its key. */
export type ImportJobSelection = Omit<ImportSelection, 'selectionKey'>;

/** How many story group and story lists one preview reads to count, at most. */
export const PREVIEW_MAX_COUNT_REQUESTS = 100;
/** How long one preview spends counting, at most; zones not counted by then have null counts. */
export const PREVIEW_COUNT_DEADLINE_MS = 20_000;
/** How long one source request of a preview may take. */
export const PREVIEW_REQUEST_TIMEOUT_MS = 10_000;
/** How long a preview's selection key is accepted. */
export const SELECTION_KEY_TTL_MS = 30 * 60_000;

/** The source reads a preview makes: the Storyly client. */
export type PreviewSource = Pick<StorylyClient, 'listApps' | 'listInstances' | 'listStoryGroups' | 'listStories'>;

/** What an app holds: its zones with their counts, without the selection key. */
export interface AppPreview {
  appId: string;
  appName: string;
  zones: ImportPreviewZone[];
  zonesBeyond: number;
  countsComplete: boolean;
}

/** Preview limits; tests shorten them. */
export interface PreviewLimits {
  maxZones?: number;
  maxCountRequests?: number;
  countDeadlineMs?: number;
  now?: () => number;
}

const plain = <T>(list: readonly T[] | CheckedList<T>): CheckedList<T> =>
  Array.isArray(list)
    ? { entries: list.map((record: T) => ({ record, differences: [], omitted: 0 })) }
    : (list as CheckedList<T>);

/**
 * Reads what the app holds, for picking what to import: its instances (the
 * zones an import makes), each with how many story groups and stories it
 * lists. Bounded: at most `maxZones` zones are listed and `zonesBeyond` counts
 * the rest; counting reads at most `maxCountRequests` lists within
 * `countDeadlineMs`, and a zone whose counts were not read, or whose list
 * failed, gets null counts. A refused token and a failing app or instance list
 * throw, as the apps list does. Null when the token cannot read the app.
 * `token` only makes names safe to show; it is not kept.
 */
export async function previewApp(
  source: PreviewSource,
  appId: string,
  token: string,
  limits: PreviewLimits = {},
): Promise<AppPreview | null> {
  const now = limits.now ?? Date.now;
  const maxZones = limits.maxZones ?? MAX_IMPORT_SELECTED_ZONES;
  const maxRequests = limits.maxCountRequests ?? PREVIEW_MAX_COUNT_REQUESTS;
  const text = (value: string) => storedText(value, token);
  const app = recordsOf(await source.listApps()).find((record) => record.id === appId);
  if (!app) return null;

  // Each instance once, in response order, as the import reads them.
  const seen = new Set<string>();
  const instances = recordsOf(await source.listInstances(app.id)).filter((instance) => {
    if (seen.has(instance.id)) return false;
    seen.add(instance.id);
    return true;
  });
  const listed = instances.slice(0, maxZones);

  const deadline = now() + (limits.countDeadlineMs ?? PREVIEW_COUNT_DEADLINE_MS);
  let requests = 0;
  let complete = true;
  // One more list may be read: within the request budget and the deadline.
  const take = (): boolean => {
    if (requests >= maxRequests || now() >= deadline) {
      complete = false;
      return false;
    }
    requests++;
    return true;
  };
  // A list that cannot be read leaves its count unknown; a refused token still fails the preview.
  const read = async <T>(list: () => Promise<readonly T[] | CheckedList<T>>): Promise<CheckedList<T> | null> => {
    try {
      return plain(await list());
    } catch (err) {
      if (!(err instanceof StorylyUnavailableError)) throw err;
      complete = false;
      return null;
    }
  };

  const zones: ImportPreviewZone[] = [];
  for (const instance of listed) {
    const zone: ImportPreviewZone = {
      id: instance.id,
      name: text(instance.name.trim() || `Instance ${instance.id}`),
      taleGroups: null,
      tales: null,
    };
    zones.push(zone);
    if (!take()) continue;
    const groups = await read<SourceStoryGroup>(() => source.listStoryGroups(instance.id));
    if (groups === null) continue;
    zone.taleGroups = groups.entries.length;
    let tales: number | null = 0;
    const counted = new Set<string>();
    for (const group of recordsOf(groups)) {
      if (counted.has(group.id)) continue;
      counted.add(group.id);
      if (!take()) {
        tales = null;
        break;
      }
      const stories = await read<SourceStory>(() => source.listStories(group.id));
      if (stories === null) {
        tales = null;
        break;
      }
      tales += stories.entries.length;
    }
    zone.tales = tales;
  }
  return {
    appId: app.id,
    appName: text(app.name.trim() || app.id),
    zones,
    zonesBeyond: instances.length - listed.length,
    countsComplete: complete,
  };
}

/** Whom and what a selection key is for. */
export interface SelectionScope {
  projectId: string;
  appId: string;
  userId: string;
}

const KEY_VERSION = 'v1';

// The MAC key: derived from the token key, so the two are never the same bytes.
function macKey(tokenKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', tokenKey, Buffer.alloc(0), 'taleart import selection key v1', 32));
}

function mac(tokenKey: Buffer, signed: string): Buffer {
  return createHmac('sha256', macKey(tokenKey)).update(signed).digest();
}

/**
 * A key proving which zones a preview listed, for whom, until when: a start
 * with a selection must carry it, so a picked zone is one the app had. It
 * holds no token; it is signed with a key derived from `IMPORT_TOKEN_KEY` and
 * nothing is stored.
 */
export function signSelectionKey(
  tokenKey: Buffer,
  scope: SelectionScope,
  zoneIds: readonly string[],
  expiresAt: number,
): string {
  const payload = Buffer.from(
    JSON.stringify({ p: scope.projectId, a: scope.appId, u: scope.userId, z: zoneIds, e: expiresAt }),
  ).toString('base64url');
  const signed = `${KEY_VERSION}.${payload}`;
  return `${signed}.${mac(tokenKey, signed).toString('base64url')}`;
}

/**
 * The zone ids a selection key names, when it is genuine, unexpired and for
 * this scope; else null.
 */
export function verifySelectionKey(
  tokenKey: Buffer,
  key: string,
  scope: SelectionScope,
  now: number = Date.now(),
): Set<string> | null {
  const parts = key.split('.');
  if (parts.length !== 3 || parts[0] !== KEY_VERSION) return null;
  const expected = mac(tokenKey, `${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: { p?: unknown; a?: unknown; u?: unknown; z?: unknown; e?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.p !== scope.projectId || payload.a !== scope.appId || payload.u !== scope.userId) return null;
  if (typeof payload.e !== 'number' || payload.e <= now) return null;
  if (!Array.isArray(payload.z) || !payload.z.every((id): id is string => typeof id === 'string')) return null;
  return new Set(payload.z);
}
