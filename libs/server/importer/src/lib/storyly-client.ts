import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';

/** The real Storyly External API; `STORYLY_API_URL` overrides it (the fake server in tests). */
export const DEFAULT_STORYLY_API_URL = 'https://api.storyly.io/external';

/** A Storyly app, as the import source. */
export interface SourceApp {
  id: string;
  name: string;
}

/** A Storyly instance: it becomes a zone. */
export interface SourceInstance {
  id: string;
  name: string;
}

/**
 * A record with a source position: a story group (it becomes a tale group) or
 * a story (it becomes a tale). `sortOrder` is null when the record carries no
 * usable `sort_order`.
 */
export interface SourceOrderedRecord {
  id: string;
  name: string;
  sortOrder: number | null;
}

/** A Storyly story group: it becomes a tale group placed in its instance's zone. */
export type SourceStoryGroup = SourceOrderedRecord;

/** A Storyly story: it becomes a tale of its group's tale group. */
export type SourceStory = SourceOrderedRecord;

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

// A `sort_order` as a number; the API types numbers as strings in places.
function sortOrderOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

// Records with an id, a title and their source position.
function orderedRecords(body: unknown, what: string): SourceOrderedRecord[] {
  const records = recordsOf(body, what);
  return namedRecords(records, what).map((record, index) => ({
    ...record,
    sortOrder: sortOrderOf((records[index] as { sort_order?: unknown }).sort_order),
  }));
}

// An id and a title from each record; anything else is an unexpected shape.
function namedRecords(body: unknown, what: string): { id: string; name: string }[] {
  return recordsOf(body, what).map((record, index) => {
    const r = record as { id?: unknown; title?: unknown } | null;
    if (typeof r !== 'object' || r === null) {
      throw new StorylyUnavailableError(`Storyly's ${what} response has an unexpected shape: record ${index + 1} is not an object`);
    }
    const id = typeof r.id === 'number' && Number.isFinite(r.id) ? String(r.id) : typeof r.id === 'string' ? r.id.trim() : '';
    if (!id) {
      throw new StorylyUnavailableError(`Storyly's ${what} response has an unexpected shape: record ${index + 1} has no id`);
    }
    if (typeof r.title !== 'string') {
      throw new StorylyUnavailableError(`Storyly's ${what} response has an unexpected shape: record ${id} has no title`);
    }
    return { id, name: r.title };
  });
}

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

  /** The apps the token can read. */
  async listApps(): Promise<SourceApp[]> {
    return namedRecords(await this.get('/app', {}, 'apps'), 'apps');
  }

  /** The instances of one app. */
  async listInstances(appId: string): Promise<SourceInstance[]> {
    return namedRecords(await this.get('/instance', { app_id: appId }, 'instances'), 'instances');
  }

  /** The story groups of one instance, in response order. */
  async listStoryGroups(instanceId: string): Promise<SourceStoryGroup[]> {
    return orderedRecords(await this.get('/story-group', { instance_id: instanceId }, 'story groups'), 'story groups');
  }

  /** The stories of one story group, in response order. */
  async listStories(storyGroupId: string): Promise<SourceStory[]> {
    return orderedRecords(await this.get('/story', { story_group_id: storyGroupId }, 'stories'), 'stories');
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
