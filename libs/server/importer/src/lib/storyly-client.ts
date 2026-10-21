import type { ImportDifference, ImportDifferenceEntity } from '@taleart/contract';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { checkRecord } from './record-shape';

/** The real Storyly External API; `STORYLY_API_URL` overrides it (the fake server in tests). */
export const DEFAULT_STORYLY_API_URL = 'https://api.storyly.io/external';

/**
 * A checked source record: its id, its title ('' when it has none usable),
 * and how it differs from the shape the import expects (FR-029).
 */
export interface SourceRecord {
  id: string;
  name: string;
  /** The record's differences; none when absent. */
  differences?: ImportDifference[];
}

/** A Storyly app, as the import source. */
export type SourceApp = SourceRecord;

/** A Storyly instance: it becomes a zone. */
export type SourceInstance = SourceRecord;

/**
 * A record with a source position: a story group (it becomes a tale group) or
 * a story (it becomes a tale). `sortOrder` is null when the record carries no
 * usable `sort_order`.
 */
export interface SourceOrderedRecord extends SourceRecord {
  sortOrder: number | null;
}

/** A Storyly story group: it becomes a tale group placed in its instance's zone. */
export type SourceStoryGroup = SourceOrderedRecord;

/** A Storyly story: it becomes a tale of its group's tale group. */
export type SourceStory = SourceOrderedRecord;

/**
 * A checked list: the records that can be imported, in response order, and
 * one `invalidRecord` difference for each record that cannot (not an object,
 * or no usable id).
 */
export interface CheckedList<T> {
  records: T[];
  rejected: ImportDifference[];
}

export interface StorylyClientOptions {
  /** Base URL of the External API, without a trailing slash. */
  baseUrl: string;
  token: string;
  /** Tests may pass their own fetch. */
  fetch?: typeof fetch;
  /** How long one request may take; 30 s by default. */
  timeoutMs?: number;
}

type AuthMode = 'bearer' | 'query';

// The records of a list response: a bare array, or an object whose `data` is one.
function recordsOf(body: unknown, what: string): unknown[] {
  if (Array.isArray(body)) return body;
  const data = (body as { data?: unknown } | null)?.data;
  if (typeof body === 'object' && body !== null && Array.isArray(data)) return data;
  throw new StorylyUnavailableError(`Storyly's ${what} response has an unexpected shape: no list of records`);
}

// Checks each record of a list against its entity's expected shape (FR-029).
function checkedList(
  body: unknown,
  what: string,
  entity: ImportDifferenceEntity,
): CheckedList<SourceOrderedRecord> {
  const list: CheckedList<SourceOrderedRecord> = { records: [], rejected: [] };
  recordsOf(body, what).forEach((raw, index) => {
    const { record, differences } = checkRecord(entity, raw, index + 1);
    if (record === null) list.rejected.push(...differences);
    else list.records.push(record);
  });
  return list;
}

// Without the source position, for records that have none.
const unordered = (list: CheckedList<SourceOrderedRecord>): CheckedList<SourceRecord> => ({
  records: list.records.map(({ id, name, differences }) => ({ id, name, differences })),
  rejected: list.rejected,
});

/**
 * A read-only client of the Storyly External API. It sends the token as a
 * bearer token and, when Storyly refuses that, as the `token` query parameter
 * (epic decision); the form that worked is used from then on. It never writes.
 */
export class StorylyClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private mode: AuthMode | null = null;

  constructor(private readonly options: StorylyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** The apps the token can read, checked. */
  async listApps(): Promise<CheckedList<SourceApp>> {
    return unordered(checkedList(await this.get('/app', {}, 'apps'), 'apps', 'app'));
  }

  /** The instances of one app, checked. */
  async listInstances(appId: string): Promise<CheckedList<SourceInstance>> {
    return unordered(checkedList(await this.get('/instance', { app_id: appId }, 'instances'), 'instances', 'zone'));
  }

  /** The story groups of one instance, in response order, checked. */
  async listStoryGroups(instanceId: string): Promise<CheckedList<SourceStoryGroup>> {
    return checkedList(await this.get('/story-group', { instance_id: instanceId }, 'story groups'), 'story groups', 'taleGroup');
  }

  /** The stories of one story group, in response order, checked. */
  async listStories(storyGroupId: string): Promise<CheckedList<SourceStory>> {
    return checkedList(await this.get('/story', { story_group_id: storyGroupId }, 'stories'), 'stories', 'tale');
  }

  // GETs `path` and returns its JSON body. 401 and 403 count as a refused token.
  private async get(path: string, query: Record<string, string>, what: string): Promise<unknown> {
    const modes: AuthMode[] = this.mode ? [this.mode] : ['bearer', 'query'];
    for (const mode of modes) {
      const res = await this.request(path, query, mode, what);
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      if (!res.ok) throw new StorylyUnavailableError(`Storyly answered ${res.status} when listing ${what}`);
      this.mode = mode;
      try {
        return await res.json();
      } catch {
        throw new StorylyUnavailableError(`Storyly's ${what} response is not JSON`);
      }
    }
    throw new StorylyTokenInvalidError();
  }

  private async request(path: string, query: Record<string, string>, mode: AuthMode, what: string): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (mode === 'bearer') headers['Authorization'] = `Bearer ${this.options.token}`;
    else url.searchParams.set('token', this.options.token);
    try {
      return await this.fetchFn(url, { method: 'GET', headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      // The underlying error may quote the URL, which can hold the token: never pass it on.
      throw new StorylyUnavailableError(`Storyly could not be reached when listing ${what}`);
    }
  }
}
