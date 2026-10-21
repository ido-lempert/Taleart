import type { ImportDifference, ImportDifferenceEntity } from '@taleart/contract';
import { StorylyTokenInvalidError, StorylyUnavailableError } from './errors';
import { labelText, MAX_LABEL_LIST_ENTRIES } from './labels';
import { checkRecord, storedText, type DifferenceBudget } from './record-shape';
import { isRetryableStatus, retryAfterMs, retryDelayMs, retryPolicy, sleep, type RetryPolicy } from './retry';

// A read already under way, given up as unreachable once `signal` aborts.
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  const stopped = () => new StorylyUnavailableError('Storyly could not be reached when listing stories');
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(stopped());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

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
  /** The record's id; null for a bare string or a record without a usable id. */
  id: string | null;
  /** The label's text, or null when it has none. */
  text: string | null;
  /**
   * True when the record is already a difference that covers its label: no
   * usable id (`invalidRecord`), or a name that is absent or not text.
   */
  reported: boolean;
}

/** A checked labels list: at most {@link MAX_LABEL_LIST_ENTRIES} entries, with `beyond` counting the rest. */
export interface CheckedLabelList extends CheckedList<SourceLabel> {
  beyond: number;
}

/** The largest response body read from Storyly; a larger one fails that call. */
export const MAX_STORYLY_RESPONSE_BYTES = 20 * 1024 * 1024;

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
  /**
   * True when its differences were built against a copy of the report's
   * budget and draw on the budget only when the import lists them, in reading
   * order (story groups and stories read with `chargeOnListing`).
   */
  uncharged?: boolean;
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
  /**
   * Story group and story lists are checked against a copy of the budget and
   * marked `uncharged`: the import draws on the budget when it lists them, so
   * lists read ahead or while media copies run cannot take the budget out of
   * reading order.
   */
  chargeOnListing?: boolean;
  /** How replies 429 and 5xx are tried again; {@link DEFAULT_RETRY_POLICY} by default. */
  retry?: Partial<RetryPolicy>;
  /** How many story lists may be read ahead at once; 4 by default. */
  readAhead?: number;
}

/** How many story lists are read ahead by default. */
export const DEFAULT_LIST_READ_AHEAD = 4;

type AuthMode = 'bearer' | 'query';

// A response body as text, read up to `limit` bytes: a longer one is refused before or while reading.
async function readLimited(res: Response, limit: number, what: string): Promise<string> {
  const tooLarge = () =>
    new StorylyUnavailableError(`Storyly's ${what} response is larger than ${limit / (1024 * 1024)} MB`);
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof StorylyUnavailableError) throw err;
    throw new StorylyUnavailableError(`Storyly's ${what} response broke off`);
  }
  return Buffer.concat(chunks).toString('utf8');
}

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
  private readonly retry: RetryPolicy;
  /** Until when every request waits, after a 429 (epoch ms). */
  private pausedUntil = 0;
  /** Story lists read ahead, by story group id: the parsed body or the failure, until listed. */
  private readonly ahead = new Map<string, Promise<unknown>>();

  constructor(private readonly options: StorylyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retry = retryPolicy(options.retry);
  }

  // Each list call may take a `signal` besides the per-request timeout: it aborts the read when it fires.

  /** The apps the token can read, checked. */
  async listApps(signal?: AbortSignal): Promise<CheckedList<SourceApp>> {
    return unordered(await this.checked('/app', {}, 'apps', 'app', signal));
  }

  /** The instances of one app, checked. */
  async listInstances(appId: string, signal?: AbortSignal): Promise<CheckedList<SourceInstance>> {
    return unordered(await this.checked('/instance', { app_id: appId }, 'instances', 'zone', signal));
  }

  /** The story groups of one instance, in response order, checked. */
  async listStoryGroups(instanceId: string, signal?: AbortSignal): Promise<CheckedList<SourceStoryGroup>> {
    const body = await this.get('/story-group', { instance_id: instanceId }, 'story groups', signal);
    return this.checkedContent(body, 'story groups', 'taleGroup');
  }

  /**
   * The app's labels (Storyly's segments list), in response order: records
   * checked as the `tag` entity, bare strings taken as they are. A record
   * without a usable id still names its label (tags need no source id). At
   * most {@link MAX_LABEL_LIST_ENTRIES} entries are checked; `beyond` counts the rest.
   */
  async listLabels(appId: string): Promise<CheckedLabelList> {
    const all = listOf(await this.get('/segment', { app_id: appId }, 'labels'), 'labels');
    const text = (value: string) => storedText(value, this.options.token);
    const budget = this.options.budget;
    const entries = all.slice(0, MAX_LABEL_LIST_ENTRIES).map((raw, index): CheckedEntry<SourceLabel> => {
      if (typeof raw === 'string') {
        return { record: { id: null, text: raw, reported: false }, differences: [], omitted: 0 };
      }
      const { record, differences, omitted } = checkRecord('tag', raw, index + 1, { text, budget });
      if (record !== null) {
        const label = typeof record.label === 'string' ? record.label : null;
        return { record: { id: record.id, text: label, reported: label === null }, differences, omitted };
      }
      // An object without a usable id: listed as invalidRecord, but its label can still become a tag.
      const label = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? labelText(raw) : null;
      return { record: label === null ? null : { id: null, text: label, reported: true }, differences, omitted };
    });
    return { entries, beyond: Math.max(0, all.length - MAX_LABEL_LIST_ENTRIES) };
  }

  /**
   * The stories of one story group, in response order, checked. A list read
   * ahead ({@link readAhead}) is taken from there, its failure included.
   */
  async listStories(storyGroupId: string, signal?: AbortSignal): Promise<CheckedList<SourceStory>> {
    const early = this.ahead.get(storyGroupId);
    this.ahead.delete(storyGroupId);
    const body = await (early
      ? untilAborted(early, signal)
      : this.get('/story', { story_group_id: storyGroupId }, 'stories', signal));
    return this.checkedContent(body, 'stories', 'tale');
  }

  /**
   * Starts reading a story group's stories before they are listed, unless
   * {@link StorylyClientOptions.readAhead} lists are read ahead already or
   * this one is. Nothing is checked until `listStories` asks for it.
   */
  readAhead(storyGroupId: string, signal?: AbortSignal): void {
    if (this.ahead.has(storyGroupId) || this.ahead.size >= (this.options.readAhead ?? DEFAULT_LIST_READ_AHEAD)) return;
    const body = this.get('/story', { story_group_id: storyGroupId }, 'stories', signal);
    // Its failure is thrown when it is listed; one never listed (the job stopped) is dropped.
    body.catch(() => undefined);
    this.ahead.set(storyGroupId, body);
  }

  // Checks a story group or story list; with chargeOnListing, against a copy of the budget, marked uncharged.
  private checkedContent(body: unknown, what: string, entity: ImportDifferenceEntity): CheckedList<SourceStory> {
    const budget = this.options.budget;
    if (!this.options.chargeOnListing || budget === undefined) {
      return checkedList(body, what, entity, this.options.token, budget);
    }
    const copy = { remaining: budget.remaining };
    return { ...checkedList(body, what, entity, this.options.token, copy), uncharged: true };
  }

  // GETs a list and checks each of its records.
  private async checked(
    path: string,
    query: Record<string, string>,
    what: string,
    entity: ImportDifferenceEntity,
    signal?: AbortSignal,
  ): Promise<CheckedList<SourceStory>> {
    const body = await this.get(path, query, what, signal);
    return checkedList(body, what, entity, this.options.token, this.options.budget);
  }

  // GETs `path` and returns its JSON body. 401 and 403 count as a refused token. 429 and 5xx are tried again
  // with backoff (or after Retry-After), and a 429 holds back every request of this client until it passes.
  private async get(path: string, query: Record<string, string>, what: string, signal?: AbortSignal): Promise<unknown> {
    const modes: AuthMode[] = this.mode ? [this.mode] : ['bearer', 'query'];
    for (const mode of modes) {
      let res: Response;
      for (let attempt = 1; ; attempt++) {
        // A 429 seen by any request of this client holds back the others until it passes.
        // Checked again after each wait: another request's 429 may have moved the pause later meanwhile. A little
        // jitter spreads the requests that wake together.
        for (let paused = this.pausedUntil - Date.now(); paused > 0; paused = this.pausedUntil - Date.now()) {
          await this.pause(paused + Math.random() * Math.min(250, paused / 10), what, signal);
        }
        res = await this.request(path, query, mode, what, signal);
        if (!isRetryableStatus(res.status) || attempt >= this.retry.attempts) break;
        const after = retryAfterMs(res.headers.get('retry-after'));
        await res.body?.cancel().catch(() => undefined);
        const wait = retryDelayMs(attempt - 1, after, this.retry);
        if (res.status === 429) this.pausedUntil = Math.max(this.pausedUntil, Date.now() + wait);
        await this.pause(wait, what, signal);
      }
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => undefined);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new StorylyUnavailableError(`Storyly answered ${res.status} when listing ${what}`);
      }
      this.mode = mode;
      const body = await readLimited(res, MAX_STORYLY_RESPONSE_BYTES, what);
      try {
        return JSON.parse(body);
      } catch {
        throw new StorylyUnavailableError(`Storyly's ${what} response is not JSON`);
      }
    }
    throw new StorylyTokenInvalidError();
  }

  private async pause(ms: number, what: string, signal?: AbortSignal): Promise<void> {
    try {
      await sleep(ms, signal);
    } catch {
      throw new StorylyUnavailableError(`Storyly could not be reached when listing ${what}`);
    }
  }

  private async request(
    path: string,
    query: Record<string, string>,
    mode: AuthMode,
    what: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (mode === 'bearer') headers['Authorization'] = `Bearer ${this.options.token}`;
    else url.searchParams.set('token', this.options.token);
    try {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      return await this.fetchFn(url, {
        method: 'GET',
        headers,
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch {
      // The underlying error may quote the URL, which can hold the token: never pass it on.
      throw new StorylyUnavailableError(`Storyly could not be reached when listing ${what}`);
    }
  }
}
