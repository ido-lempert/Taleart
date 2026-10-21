import type { ImportDifference, ImportDifferenceEntity } from '@taleart/contract';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { checkRecord, storedText, type DifferenceBudget } from './record-shape';

/** The real Storyly External API; `STORYLY_API_URL` overrides it (the fake server in tests). */
export const DEFAULT_STORYLY_API_URL = 'https://api.storyly.io/external';

/** A checked source record: its id and its title ('' when it has none usable). */
export interface SourceRecord {
  id: string;
  name: string;
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

/**
 * A Storyly story group: it becomes a tale group placed in its instance's
 * zone. `segments` (its labels) is the source's value, unchecked: the label
 * import reads it.
 */
export interface SourceStoryGroup extends SourceOrderedRecord {
  segments?: unknown;
}

/**
 * A label of the app's labels list (Storyly's segments): a record with an id,
 * or a bare string with none. `label` is its name as the source gave it,
 * unchecked: the label import reads it, and a record's name that is absent or
 * not text is already a difference of the record.
 */
export interface SourceLabel {
  id: string | null;
  label: unknown;
  /** True for a bare string, whose text was not checked as a record. */
  bare: boolean;
}

/**
 * A Storyly story: it becomes a tale of its group's tale group. `media` (the
 * media URL) and `mimeType` are the source's values, unchecked: the media copy
 * checks them.
 */
export interface SourceStory extends SourceOrderedRecord {
  media?: unknown;
  mimeType?: unknown;
}

/**
 * One entry of a checked list: the record, or null when it cannot be imported
 * (not an object, or no usable id); how it differs from the shape the import
 * expects (FR-029); and how many more differences were found than built.
 */
export interface CheckedEntry<T> {
  record: T | null;
  differences: ImportDifference[];
  omitted: number;
}

/** A checked list: one entry per source record, in response order. */
export interface CheckedList<T> {
  entries: CheckedEntry<T>[];
}

/** The records of a checked list that can be imported, in response order. */
export const recordsOf = <T>(list: CheckedList<T>): T[] =>
  list.entries.flatMap((entry) => (entry.record === null ? [] : [entry.record]));

export interface StorylyClientOptions {
  /** Base URL of the External API, without a trailing slash. */
  baseUrl: string;
  token: string;
  /** Tests may pass their own fetch. */
  fetch?: typeof fetch;
  /** How long one request may take; 30 s by default. */
  timeoutMs?: number;
  /** The report's difference budget, shared with the rest of the import. */
  budget?: DifferenceBudget;
}

type AuthMode = 'bearer' | 'query';

// The records of a list response: a bare array, or an object whose `data` is one.
function listOf(body: unknown, what: string): unknown[] {
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
  token: string,
  budget: DifferenceBudget | undefined,
): CheckedList<SourceStory> {
  const text = (value: string) => storedText(value, token);
  return { entries: listOf(body, what).map((raw, index) => checkRecord(entity, raw, index + 1, { text, budget })) };
}

// Without the source position, for records that have none.
const unordered = (list: CheckedList<SourceOrderedRecord>): CheckedList<SourceRecord> => ({
  entries: list.entries.map(({ record, differences, omitted }) => ({
    record: record === null ? null : { id: record.id, name: record.name },
    differences,
    omitted,
  })),
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
    return unordered(await this.checked('/app', {}, 'apps', 'app'));
  }

  /** The instances of one app, checked. */
  async listInstances(appId: string): Promise<CheckedList<SourceInstance>> {
    return unordered(await this.checked('/instance', { app_id: appId }, 'instances', 'zone'));
  }

  /** The story groups of one instance, in response order, checked. */
  async listStoryGroups(instanceId: string): Promise<CheckedList<SourceStoryGroup>> {
    return this.checked('/story-group', { instance_id: instanceId }, 'story groups', 'taleGroup');
  }

  /**
   * The app's labels (Storyly's segments list), in response order: records
   * checked as the `tag` entity, bare strings taken as they are.
   */
  async listLabels(appId: string): Promise<CheckedList<SourceLabel>> {
    const body = await this.get('/segment', { app_id: appId }, 'labels');
    const text = (value: string) => storedText(value, this.options.token);
    return {
      entries: listOf(body, 'labels').map((raw, index): CheckedEntry<SourceLabel> => {
        if (typeof raw === 'string') return { record: { id: null, label: raw, bare: true }, differences: [], omitted: 0 };
        const { record, differences, omitted } = checkRecord('tag', raw, index + 1, { text, budget: this.options.budget });
        return { record: record === null ? null : { id: record.id, label: record.label, bare: false }, differences, omitted };
      }),
    };
  }

  /** The stories of one story group, in response order, checked. */
  async listStories(storyGroupId: string): Promise<CheckedList<SourceStory>> {
    return this.checked('/story', { story_group_id: storyGroupId }, 'stories', 'tale');
  }

  // GETs a list and checks each of its records.
  private async checked(
    path: string,
    query: Record<string, string>,
    what: string,
    entity: ImportDifferenceEntity,
  ): Promise<CheckedList<SourceStory>> {
    return checkedList(await this.get(path, query, what), what, entity, this.options.token, this.options.budget);
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
