import type { TaleDocument } from '@taleart/contract/tale-document';
import { assetBytes } from './assets';
import {
  DEMO_GROUPS,
  DEMO_PROJECT_NAME,
  DEMO_TAGS,
  DEMO_THEME,
  DEMO_USER_LIST,
  DEMO_ZONES,
  demoCounts,

  type TaleSpec,
  type ZoneKey,
} from './content';
import { ElementBuilder, INK, withElements } from './documents';

/** The slice of the Management API client the seed needs: the CLI's client and the API's own both fit. */
export interface SeedClient {
  request<T>(
    method: string,
    path: string,
    options?: { json?: unknown; body?: Blob; contentType?: string },
  ): Promise<T>;
}

export interface SeedOptions {
  /** Seed even when the demo project exists (a second copy) or the token's user already has projects. */
  force?: boolean;
  /** Read what is there and say what would be made, changing nothing. */
  dryRun?: boolean;
  /** The time the demo's dates are counted from (countdowns, schedules). Now by default. */
  now?: Date;
  /** Progress, one line at a time. */
  log?: (message: string) => void;
  /** Runs once the project exists, for what the API alone can make (the demo team). */
  afterProject?: (project: { id: string; name: string }) => Promise<void>;
}

export type SeedCounts = ReturnType<typeof demoCounts>;

export type SeedResult =
  | { status: 'created'; project: { id: string; name: string }; counts: SeedCounts; zoneKeys: { slug: string; key: string }[] }
  | { status: 'exists'; project: { id: string; name: string } }
  | { status: 'dry-run'; counts: SeedCounts; name: string };

/** Thrown when the install already has content and `force` is off. `code` is stable for callers. */
export class SeedRefusedError extends Error {
  readonly code = 'seed_refused';
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

interface Id {
  id: string;
}
interface ProjectRef extends Id {
  name: string;
}
interface TaleRevision {
  document: TaleDocument | null;
  revision: number;
  published: { revision: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const jpeg = (name: Parameters<typeof assetBytes>[0]): Blob => new Blob([new Uint8Array(assetBytes(name))], { type: 'image/jpeg' });

/**
 * Makes the demo project through the Management API, so every value passes the API's own checks:
 * the project with its theme, three zones with their displays, five tale groups with covers, tags and
 * thirteen tales (picture, text, buttons, a countdown, a promo code, a poll, a quiz, a rating and a
 * reaction), one user list. A project already named {@link DEMO_PROJECT_NAME} makes a run a no-op, and
 * a user who already has other projects is refused, unless `force` is set.
 */
export async function seedDemo(client: SeedClient, options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const get = <T>(path: string) => client.request<T>('GET', path);
  const send = <T>(method: string, path: string, json?: unknown) => client.request<T>(method, path, json === undefined ? {} : { json });
  const upload = <T>(path: string, body: Blob, contentType: string) => client.request<T>('PUT', path, { body, contentType });

  const projects = await get<ProjectRef[]>('/projects');
  const existing = projects.find((p) => p.name === DEMO_PROJECT_NAME);
  if (existing && !options.force) return { status: 'exists', project: existing };
  if (projects.length > 0 && !options.force) {
    throw new SeedRefusedError(
      `This install already has ${projects.length} project${projects.length === 1 ? '' : 's'}: the demo is for an empty install. Use --force to add it anyway.`,
    );
  }
  const name = existing ? uniqueName(projects, DEMO_PROJECT_NAME) : DEMO_PROJECT_NAME;
  if (options.dryRun) return { status: 'dry-run', name, counts: demoCounts() };

  const project = await send<ProjectRef>('POST', '/projects', { name });
  log(`Created project ${project.name}`);
  await send('PUT', `/projects/${project.id}/theme`, DEMO_THEME);
  log('Set the theme');

  const zones = new Map<ZoneKey, { id: string; slug: string }>();
  for (const spec of DEMO_ZONES) {
    const zone = await send<Id & { slug: string }>('POST', '/zones', { name: spec.name, projectId: project.id, template: spec.template });
    if (spec.frame) await send('POST', `/zones/${zone.id}/frame`, spec.frame);
    zones.set(spec.key, zone);
    log(`Created zone ${spec.name}`);
  }

  const tags = new Map<string, string>();
  for (const tag of DEMO_TAGS) tags.set(tag, (await send<Id>('POST', `/projects/${project.id}/tags`, { name: tag })).id);

  const list = await send<Id>('POST', `/projects/${project.id}/user-lists`, { name: DEMO_USER_LIST.name });
  await client.request('POST', `/projects/${project.id}/user-lists/${list.id}/ids`, {
    body: new Blob([DEMO_USER_LIST.ids.join('\n')], { type: 'text/plain' }),
    contentType: 'text/plain',
  });

  for (const spec of DEMO_GROUPS) {
    const zoneOf = (key: ZoneKey) => {
      const zone = zones.get(key);
      if (!zone) throw new Error(`The demo has no zone ${key}`);
      return zone;
    };
    const [first, ...others] = spec.zones;
    const group = await send<Id>('POST', `/zones/${zoneOf(first).id}/tale-groups`, { name: spec.name });
    for (const key of others) await send('PUT', `/zones/${zoneOf(key).id}/tale-groups/${group.id}`);
    await upload(`/tale-groups/${group.id}/cover`, jpeg(spec.cover), 'image/jpeg');
    await send('PUT', `/tale-groups/${group.id}/tags`, { tagIds: spec.tags.map((t) => tags.get(t)) });
    for (const tale of spec.tales) await makeTale(group, tale);
    if (spec.schedule) {
      await send('PUT', `/tale-groups/${group.id}/schedule`, { startsAt: after(now, spec.schedule.startsInDays), endsAt: null });
    }
    await send('PUT', `/tale-groups/${group.id}/status`, { status: 'live' });
    log(`Created tale group ${spec.name} with ${spec.tales.length} tales`);
  }

  async function makeTale(group: Id, spec: TaleSpec): Promise<void> {
    const tale = await send<Id>('POST', `/tale-groups/${group.id}/tales`, { title: spec.title });
    await upload(`/tales/${tale.id}/media`, jpeg(spec.picture), 'image/jpeg');
    const builder = new ElementBuilder(INK[spec.ink], hashNumber(spec.title));
    spec.compose(builder, now);
    // The picture is the tale's own media, which the API has put in the document as its first element.
    const state = await get<TaleRevision>(`/tales/${tale.id}/document`);
    if (!state.document) throw new Error(`The API did not compose the picture of ${spec.title} into its document`);
    const saved = await send<TaleRevision>('PUT', `/tales/${tale.id}/document`, {
      document: withElements(state.document, builder.elements),
      revision: state.revision,
      sawTaleMedia: true,
    });
    if (spec.hidden) {
      await send('PUT', `/tales/${tale.id}/status`, { status: 'paused' });
      return;
    }
    await send('POST', `/tales/${tale.id}/document/publish`, { revision: saved.revision, publishedRevision: saved.published.revision });
    if (spec.schedule) {
      await send('PUT', `/tales/${tale.id}/schedule`, {
        startsAt: after(now, spec.schedule.startsInDays),
        endsAt: after(now, spec.schedule.startsInDays + spec.schedule.lastsDays),
      });
    }
  }

  // A key each, so the zones count as installed and the groups read as visible; the keys are the result's to show.
  const zoneKeys: { slug: string; key: string }[] = [];
  for (const zone of zones.values()) {
    const issued = await send<{ key: string }>('POST', `/zones/${zone.id}/key`, {});
    zoneKeys.push({ slug: zone.slug, key: issued.key });
  }
  log('Issued a key for each zone');

  if (options.afterProject) await options.afterProject(project);
  return { status: 'created', project, counts: demoCounts(), zoneKeys };
}

const after = (now: Date, days: number): string => new Date(now.getTime() + days * DAY_MS).toISOString();

// A small number from a title, so element ids differ between tales and stay the same between runs.
function hashNumber(text: string): number {
  let n = 0;
  for (const char of text) n = (n * 31 + (char.codePointAt(0) ?? 0)) % 0xffffff;
  return n + 1;
}

function uniqueName(projects: readonly ProjectRef[], base: string): string {
  const taken = new Set(projects.map((p) => p.name));
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}


