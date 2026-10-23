import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import {
  ErrorCodes,
  isErrorBody,
  MAX_TALE_GROUPS_PER_PROJECT,
  type Frame,
  type FrameType,
  type Invitation,
  type Project,
  type ProjectTaleGroup,
  type SetScheduleRequest,
  type SettableStatus,
  type Tag,
  type Tale,
  type TaleGroup,
  type TaleGroupCover,
  type Zone,
  type ZoneTaleGroup,
  type ZoneTemplateKey,
} from '@taleart/contract/core';
import type { TaleStatusResult } from '@taleart/contract/tale-document';
import { firstValueFrom, type Subscription } from 'rxjs';

// The Management API, on the dashboard's own origin: the dev server proxies
// /api to the API (proxy.conf.json), so the session cookie is same-origin.
export const API_BASE = '/api/v1';

/** Media URLs from the API are paths on the API's origin, which is the dashboard's own. */
export const API_ORIGIN = '';

/** The localStorage key holding the project picked in the top bar. */
export const SELECTED_PROJECT_KEY = 'taleart.selectedProjectId';

/** Which create drawer is open, and for what. */
/** How a tale media upload reports and stops: `progress` gets the share sent (null when unknown). */
export interface MediaUploadOptions {
  progress?: (sent: number | null) => void;
  signal?: AbortSignal;
  /** The content type to declare, when the browser gave the file none. */
  type?: string;
}

export type DrawerRequest =
  | { kind: 'project' }
  | { kind: 'invite'; projectId: string }
  | { kind: 'zone' }
  | { kind: 'editZone'; zoneId: string }
  | { kind: 'display'; zoneId: string }
  | { kind: 'displaySettings'; zoneId: string }
  /**
   * A new tale group in the zone `zoneId`; with `projectId` (the Tale groups page, epic UX rework
   * R14) the drawer offers the project's zones and "Not in a zone", starting at `zoneId` ('' for none).
   */
  | { kind: 'taleGroup'; zoneId: string; projectId?: string }
  | { kind: 'tale'; taleGroupId: string }
  | { kind: 'tags'; taleGroupId: string }
  | { kind: 'renameTaleGroup'; taleGroupId: string }
  | { kind: 'placeTaleGroup'; taleGroupId: string }
  | { kind: 'removeTaleGroup'; zoneId: string; taleGroupId: string }
  | { kind: 'copyTaleGroup'; taleGroupId: string }
  /** `focus: 'media'` (Replace media, epic UX rework R11) puts focus on the media file field. */
  | { kind: 'taleMedia'; taleId: string; focus?: 'media' }
  | { kind: 'cover'; taleGroupId: string }
  | { kind: 'schedule'; target: ScheduleTarget; id: string };

/** What a schedule drawer sets the start and end time of (AD-6). */
export type ScheduleTarget = 'taleGroup' | 'tale';

/** A tale group's own fields, as both the project's list and a zone's carry them (epic UX rework R14). */
export type TaleGroupSummary = Omit<TaleGroup, 'tales'>;

// How many of the tales are Shown (stored `live`, AD-6 amended).
function shownTales(tales: readonly Pick<Tale, 'storedStatus'>[]): number {
  return tales.filter((tale) => tale.storedStatus === 'live').length;
}

// The key of a group's tale order queue (story 8.19): one per group, whichever view orders its
// tales (the zone page or the Tale groups page); zone ids, the other keys, are UUIDs.
function taleOrderKey(taleGroupId: string): string {
  return `tales:${taleGroupId}`;
}

/**
 * How a tale group read on its own stands while it has no answer to show (story 8.19): being read,
 * gone (403 or 404: removed, or not the caller's), or not read (any other failure).
 */
export type GroupReadState = 'loading' | 'gone' | 'error';

// The answer to one group's read: the group, gone (403 or 404), or another failure.
type GroupRead = { group: TaleGroup } | { gone: true } | { error: unknown };

// A record without one key.
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

// The groups with one group's tales replaced.
function withTales(groups: ZoneTaleGroup[], taleGroupId: string, tales: Tale[]): ZoneTaleGroup[] {
  return groups.map((g) => (g.id === taleGroupId ? { ...g, tales } : g));
}

/** Orders tags by name ignoring case, then by name, then by id: the one tag order of the dashboard. */
export function compareTags(a: { id: string; name: string }, b: { id: string; name: string }): number {
  return (
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
    a.name.localeCompare(b.name) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// The API's own message when it sent the standard error body, else the fallback.
function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
}

// A refused tale group create or copy: the API's message, which says plainly when the project is
// full (epic UX rework R14); the client's own wording only when that message is missing.
function taleGroupCreateMessage(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse) || !isErrorBody(err.error)) return fallback;
  const { code, message } = err.error.error;
  if (code === ErrorCodes.taleGroupLimitReached && !message.trim()) {
    return `This project already has ${MAX_TALE_GROUPS_PER_PROJECT} tale groups that are not archived, the most it can hold. Archive a tale group to make room.`;
  }
  return message;
}

/** The control a refusal of a zone change is about; null when it names none. */
export type ZoneField = 'name' | 'slug' | 'template' | 'project' | null;

/** A refused zone change: the message to show, and the field it is about, so only that field is marked. */
/**
 * A tale's title from its media file's name: without the extension, with underscores and hyphens
 * read as spaces, at most 100 characters; "Tale" when nothing is left.
 */
export function taleTitleFromFile(name: string): string {
  const title = name
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...title].slice(0, 100).join('').trim() || 'Tale';
}

export interface ZoneChangeResult {
  message: string;
  field: ZoneField;
  /** The zone created or changed; absent when refused. */
  zoneId?: string;
}

// The field a refusal of a zone change is about: from its code, or a message naming the field.
function zoneErrorField(err: unknown): ZoneField {
  if (!(err instanceof HttpErrorResponse) || !isErrorBody(err.error)) return null;
  const { code, message } = err.error.error;
  if (code === 'slug_taken' || /^slug\b/.test(message)) return 'slug';
  if (code === 'unknown_template' || /^template\b/.test(message)) return 'template';
  if (code === 'project_not_found' || code === 'forbidden' || /^projectId\b/.test(message)) return 'project';
  return /^name\b/.test(message) ? 'name' : null;
}

/** All dashboard data and every Management API call. Create calls resolve to '' or the message to show. */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly projects = signal<Project[]>([]);
  readonly zones = signal<Zone[]>([]);
  readonly frameTypes = signal<FrameType[]>([]);
  /**
   * Each zone's tale groups, each with its tales and its position in that zone,
   * keyed by zone id. A group placed in several zones shows in each (AD-14).
   */
  readonly taleGroups = signal<Record<string, ZoneTaleGroup[]>>({});
  /**
   * Each project's tale groups by name, placed in a zone or not, keyed by project id: only the
   * projects a page asked for with {@link ensureProjectTaleGroups}, kept fresh by each refresh.
   */
  readonly projectTaleGroups = signal<Record<string, ProjectTaleGroup[]>>({});
  /** The projects whose tale group list a page asked for, and those being read on their own now. */
  private readonly wantedProjectGroups = new Set<string>();
  private readonly readingProjectGroups = new Set<string>();
  /**
   * Tale groups read on their own, with their tales, keyed by id (story 8.19): the groups a page
   * opened with {@link ensureTaleGroup}, such as a group in no zone, which no zone's list holds.
   * Their visibility is in any zone, as the project's list gives it. Kept fresh by each refresh.
   */
  readonly readGroups = signal<Record<string, TaleGroup>>({});
  /** Per wanted group without an answer to show: being read, gone or failed (story 8.19); absent once read. */
  readonly groupReads = signal<Record<string, GroupReadState>>({});
  /**
   * How many holders want each group read on its own ({@link ensureTaleGroup}: the Tale groups
   * page's open view, Tale Studio), and the groups being read on their own now.
   */
  private readonly wantedGroups = new Map<string, number>();
  private readonly readingGroups = new Set<string>();
  /** The id of the tale group created last, by either create (epic UX rework R14); null before one. */
  readonly createdTaleGroupId = signal<string | null>(null);
  /** '' or why setup's first project was not created, shown once on the zones page's "Create your first project". */
  readonly firstProjectRefusal = signal('');
  /** Each project's tags by name, keyed by project id. */
  readonly tags = signal<Record<string, Tag[]>>({});
  /** True once the first refresh finished, successfully or not. */
  readonly loaded = signal(false);
  readonly apiDown = signal(false);

  readonly drawer = signal<DrawerRequest | null>(null);
  /**
   * Order requests run one at a time per list, so the database applies them in the order they were
   * made: per zone for its groups' order, per group (`tales:<id>`, story 8.19) for its tales' order,
   * from whichever page. Per key: the tail of that queue, how many requests are not settled, and an
   * epoch bumped by a refusal so moves queued behind it are dropped; per zone and per group, the
   * last order the API confirmed.
   */
  private readonly orderQueues = new Map<string, Promise<unknown>>();
  private readonly confirmedGroups = new Map<string, ZoneTaleGroup[]>();
  private readonly confirmedTales = new Map<string, Tale[]>();
  private readonly pendingOrders = new Map<string, number>();
  /** Zones a refresh skipped while their order writes were pending: read again once those settle. */
  private readonly staleOrders = new Set<string>();
  private readonly orderEpochs = new Map<string, number>();
  /** Bumped per tale on each upload, so a replaced file at the same URL is fetched again. */
  private readonly mediaVersions = signal<Record<string, number>>({});
  /** Bumped per tale group on each cover change, so a replaced cover at the same URL is fetched again. */
  private readonly coverVersions = signal<Record<string, number>>({});
  /** The element that opened the drawer; focus returns to it on close. */
  drawerOpener: HTMLElement | null = null;

  private readonly storedProjectId = signal(this.readStoredProjectId());

  /** The picked project when it still exists, else the first project, else ''. */
  readonly selectedProjectId = computed(() => {
    const projects = this.projects();
    const stored = this.storedProjectId();
    return projects.some((p) => p.id === stored) ? stored : (projects[0]?.id ?? '');
  });
  readonly selectedProject = computed(() => this.projects().find((p) => p.id === this.selectedProjectId()));
  readonly projectZones = computed(() => this.zones().filter((z) => z.projectId === this.selectedProjectId()));

  selectProject(projectId: string): void {
    this.storedProjectId.set(projectId);
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts for this visit only.
    }
  }

  /** Opens a drawer; focus returns, when it closes, to the control that opened it: the event's target, or `opener`. */
  openDrawer(request: DrawerRequest, event?: Event | HTMLElement): void {
    const target = event instanceof HTMLElement ? event : event?.currentTarget;
    this.drawerOpener = target instanceof HTMLElement ? target : null;
    this.drawer.set(request);
  }

  closeDrawer(): void {
    this.drawer.set(null);
  }

  projectName(projectId: string): string {
    return this.projects().find((p) => p.id === projectId)?.name ?? 'Unknown project';
  }

  // A type missing from the registry is shown by its raw key; the dashboard does not fail on it (AD-5).
  frameTypeLabel(type: string): string {
    return this.frameTypes().find((t) => t.key === type)?.label ?? type;
  }

  zone(zoneId: string): Zone | undefined {
    return this.zones().find((z) => z.id === zoneId);
  }

  /** The zone's display (its one frame, AD-17), or null when it has none. */
  displayOf(zoneId: string): Frame | null {
    return this.zone(zoneId)?.frame ?? null;
  }

  /** The registry entry of a frame type, with its settings schema, if the API listed it. */
  frameType(key: string): FrameType | undefined {
    return this.frameTypes().find((t) => t.key === key);
  }

  /** True when the frame type's schema has fields to edit. */
  hasSettings(key: string): boolean {
    const properties = (this.frameType(key)?.schema as { properties?: object } | undefined)?.properties;
    return !!properties && Object.keys(properties).length > 0;
  }

  taleGroupsOf(zoneId: string): ZoneTaleGroup[] {
    return this.taleGroups()[zoneId] ?? [];
  }

  /**
   * A tale group with its tales: as some zone lists it, else as it was read on its own (a group in
   * no zone, story 8.19); its content is the same in every zone (AD-14).
   */
  taleGroup(taleGroupId: string): TaleGroup | undefined {
    return this.zoneTaleGroup(taleGroupId) ?? this.readGroups()[taleGroupId];
  }

  /** A tale group as some zone lists it, with its tales and its position there. */
  private zoneTaleGroup(taleGroupId: string): ZoneTaleGroup | undefined {
    return Object.values(this.taleGroups())
      .flat()
      .find((g) => g.id === taleGroupId);
  }

  /**
   * A tale group's own fields (name, project, status, window, cover, tags, zones), wherever it is
   * listed: its project's list first, else a zone's (epic UX rework R14). The one lookup for anything
   * but its tales, so a group in no zone is found too.
   */
  groupSummary(taleGroupId: string): TaleGroupSummary | undefined {
    return this.projectTaleGroup(taleGroupId) ?? this.taleGroup(taleGroupId);
  }

  /** The project's tale groups by name, including those placed in no zone. */
  projectTaleGroupsOf(projectId: string): ProjectTaleGroup[] {
    return this.projectTaleGroups()[projectId] ?? [];
  }

  /** A tale group as its project's list shows it, placed in a zone or not. */
  projectTaleGroup(taleGroupId: string): ProjectTaleGroup | undefined {
    return Object.values(this.projectTaleGroups())
      .flat()
      .find((g) => g.id === taleGroupId);
  }

  /** The zones of the group's project that do not hold the group yet: where "Show in another zone" can place it. */
  zonesToPlace(taleGroupId: string): Zone[] {
    const group = this.groupSummary(taleGroupId);
    if (!group) return [];
    return this.zones().filter((z) => z.projectId === group.projectId && !group.zoneIds.includes(z.id));
  }

  tagsOf(projectId: string): Tag[] {
    return this.tags()[projectId] ?? [];
  }

  /** A tale as a zone's list or a group read on its own holds it (story 8.19). */
  tale(taleId: string): Tale | undefined {
    return [...Object.values(this.taleGroups()).flat(), ...Object.values(this.readGroups())]
      .flatMap((g) => g.tales)
      .find((t) => t.id === taleId);
  }

  /** The absolute URL of a tale's media, or '' when it has none. */
  mediaSrc(tale: Tale): string {
    if (!tale.media) return '';
    const version = this.mediaVersions()[tale.id];
    return `${API_ORIGIN}${tale.media.url}${version ? `?v=${version}` : ''}`;
  }

  /** The URL of a tale group's cover, or '' when it has none. */
  coverSrc(group: { id: string; cover: TaleGroupCover | null }): string {
    if (!group.cover) return '';
    const version = this.coverVersions()[group.id];
    return `${API_ORIGIN}${group.cover.url}${version ? `?v=${version}` : ''}`;
  }

  /**
   * Reads a project's tale group list once, when a page needs it (the Tale groups page, a zone page,
   * Duplicate); later refreshes keep it fresh. A refresh that starts meanwhile wins over this read.
   */
  ensureProjectTaleGroups(projectId: string): void {
    if (!projectId) return;
    this.wantedProjectGroups.add(projectId);
    if (projectId in this.projectTaleGroups() || this.readingProjectGroups.has(projectId)) return;
    this.readingProjectGroups.add(projectId);
    const generation = this.generation;
    const run = this.refreshes;
    firstValueFrom(this.http.get<ProjectTaleGroup[]>(`${API_BASE}/projects/${encodeURIComponent(projectId)}/tale-groups`))
      .then(
        (list) => {
          if (generation === this.generation && run === this.refreshes) {
            this.projectTaleGroups.update((lists) => ({ ...lists, [projectId]: list }));
          }
        },
        () => undefined,
      )
      .finally(() => this.readingProjectGroups.delete(projectId));
  }

  /**
   * Reads one tale group with its tales (`GET /tale-groups/{id}`) for a holder that shows it (the
   * Tale groups page's group view, Tale Studio for a tale in no zone); later refreshes keep it fresh
   * until every holder has called {@link releaseTaleGroup}. Until it is read, {@link groupReads}
   * says it is loading, gone or failed.
   */
  ensureTaleGroup(taleGroupId: string): void {
    if (!taleGroupId) return;
    this.wantedGroups.set(taleGroupId, (this.wantedGroups.get(taleGroupId) ?? 0) + 1);
    this.readOwnGroup(taleGroupId, false);
  }

  /** Reads a wanted group again, such as after its read failed (the page's Try again). */
  retryTaleGroup(taleGroupId: string): void {
    if (this.wantedGroups.has(taleGroupId)) this.readOwnGroup(taleGroupId, true);
  }

  /**
   * One holder no longer shows the group; once none does, it is forgotten (refreshes no longer read
   * it), with its tale order bookkeeping when no order write is pending.
   */
  releaseTaleGroup(taleGroupId: string): void {
    const left = (this.wantedGroups.get(taleGroupId) ?? 0) - 1;
    if (left > 0) {
      this.wantedGroups.set(taleGroupId, left);
      return;
    }
    this.wantedGroups.delete(taleGroupId);
    this.readGroups.update((groups) => without(groups, taleGroupId));
    this.groupReads.update((reads) => without(reads, taleGroupId));
    if ((this.pendingOrders.get(taleOrderKey(taleGroupId)) ?? 0) === 0) this.forgetTaleOrder(taleGroupId);
  }

  // Reads a wanted group on its own, unless it is being read, or (`again` false) already read. An
  // answer is shown unless a refresh that started meanwhile already showed a newer one.
  private readOwnGroup(taleGroupId: string, again: boolean): void {
    if (this.readingGroups.has(taleGroupId) || (!again && taleGroupId in this.readGroups())) return;
    this.readingGroups.add(taleGroupId);
    if (!(taleGroupId in this.readGroups())) this.groupReads.update((reads) => ({ ...reads, [taleGroupId]: 'loading' }));
    const generation = this.generation;
    const run = this.refreshes;
    void this.readGroup(taleGroupId).then((read) => {
      this.readingGroups.delete(taleGroupId);
      if (generation !== this.generation || !this.wantedGroups.has(taleGroupId)) return;
      if (run !== this.refreshes && taleGroupId in this.readGroups()) return;
      if ('error' in read) {
        // As a refresh's failed read does: the API-down banner (a 401 goes to sign-in instead).
        if (!(read.error instanceof HttpErrorResponse && read.error.status === 401)) this.apiDown.set(true);
        if (!(taleGroupId in this.readGroups())) this.groupReads.update((reads) => ({ ...reads, [taleGroupId]: 'error' }));
        return;
      }
      this.applyGroupReads([taleGroupId], [read]);
    });
  }

  // One group with its tales: gone on 403 or 404 (removed, or not the caller's), else the failure.
  private async readGroup(taleGroupId: string): Promise<GroupRead> {
    try {
      return { group: await firstValueFrom(this.http.get<TaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}`)) };
    } catch (error) {
      return error instanceof HttpErrorResponse && (error.status === 403 || error.status === 404) ? { gone: true } : { error };
    }
  }

  /**
   * Shows answers to group reads, merged into what is shown at that moment: a group read is shown
   * (keeping its tales' order while an order write is pending), a gone one dropped and marked gone,
   * a wanted group these reads did not cover (opened meanwhile) kept as it is, and a group no longer
   * wanted dropped. Failed reads are not passed here: what was shown stays.
   */
  private applyGroupReads(ids: readonly string[], reads: readonly GroupRead[]): void {
    const answered = new Map(ids.map((id, i) => [id, reads[i]]));
    this.readGroups.update((shown) => {
      const next: Record<string, TaleGroup> = {};
      for (const id of this.wantedGroups.keys()) {
        const read = answered.get(id);
        if (read && 'group' in read) next[id] = this.withPendingTales(read.group, shown[id]?.tales);
        else if (!read && shown[id]) next[id] = shown[id];
      }
      return next;
    });
    this.groupReads.update((states) => {
      const next = { ...states };
      for (const [id, read] of answered) {
        if ('group' in read) delete next[id];
        else if ('gone' in read) next[id] = 'gone';
      }
      for (const id of Object.keys(next)) if (!this.wantedGroups.has(id)) delete next[id];
      return next;
    });
  }

  /** Bumped by reset(), so a refresh that started before it writes nothing. */
  private generation = 0;

  /** Forgets all loaded data, for example after sign-out. */
  reset(): void {
    this.generation++;
    this.loadingFor = null;
    this.projects.set([]);
    this.zones.set([]);
    this.frameTypes.set([]);
    this.taleGroups.set({});
    this.projectTaleGroups.set({});
    this.wantedProjectGroups.clear();
    this.readGroups.set({});
    this.groupReads.set({});
    this.wantedGroups.clear();
    this.createdTaleGroupId.set(null);
    this.tags.set({});
    this.loaded.set(false);
    this.apiDown.set(false);
    this.drawer.set(null);
  }

  /** Bumped by each refresh, so an older one still loading writes nothing over a newer one's answers. */
  private refreshes = 0;
  /** The newest refresh still loading, or done; the one whose answers the store shows. */
  private latestRefresh: Promise<void> = Promise.resolve();

  /**
   * Reads everything again. Resolves once the newest refresh has finished: a refresh that a newer
   * one supersedes waits for that one, so a caller never goes on with answers the store dropped.
   */
  async refresh(): Promise<void> {
    let awaited = this.load();
    this.latestRefresh = awaited;
    await awaited;
    while (this.latestRefresh !== awaited) {
      awaited = this.latestRefresh;
      await awaited;
    }
  }

  /** The signed-in user whose data is loading, and that load, until it ends; reset() forgets both. */
  private loadingFor: object | null = null;
  private userLoad: Promise<void> = Promise.resolve();

  /**
   * Loads a signed-in user's data: the shell's sign-in effect and a reconnect that read the auth
   * state share one load while it runs, whichever asks first.
   */
  loadFor(user: object): Promise<void> {
    if (user !== this.loadingFor) {
      this.loadingFor = user;
      const load = this.refresh().finally(() => {
        if (this.userLoad === load) this.loadingFor = null;
      });
      this.userLoad = load;
    }
    return this.userLoad;
  }

  /**
   * One tale with its visibility in any zone (epic UX rework R7), as Tale Studio's status line
   * shows it; null when it cannot be read. A failure does not show the API-down banner: the
   * studio reads this in the background.
   */
  async readTale(taleId: string): Promise<Tale | null> {
    try {
      return await firstValueFrom(this.http.get<Tale>(`${API_BASE}/tales/${encodeURIComponent(taleId)}`));
    } catch {
      return null;
    }
  }

  private async load(): Promise<void> {
    const generation = this.generation;
    const run = ++this.refreshes;
    const current = () => generation === this.generation && run === this.refreshes;
    try {
      const projects = await firstValueFrom(this.http.get<Project[]>(`${API_BASE}/projects`));
      if (!current()) return;
      this.projects.set(projects);
      const zones = await firstValueFrom(this.http.get<Zone[]>(`${API_BASE}/zones`));
      if (!current()) return;
      this.zones.set(zones);
      const frameTypes = await firstValueFrom(this.http.get<FrameType[]>(`${API_BASE}/frame-types`));
      if (!current()) return;
      this.frameTypes.set(frameTypes);
      const groups = await this.loadEach<ZoneTaleGroup[]>(zones, (id) => `/zones/${id}/tale-groups`);
      if (!current()) return;
      this.taleGroups.set(this.keepPendingTales(this.keepPendingOrders(groups)));
      const tags = await this.loadEach<Tag[]>(projects, (id) => `/projects/${encodeURIComponent(id)}/tags`);
      if (!current()) return;
      this.tags.set(tags);
      // The groups read on its own are read with the project lists, in parallel. Each is read even
      // when a zone lists it: a zone's list gives its visibility in that zone, the Tale groups
      // page's view shows it in any zone (story 8.19).
      const ids = [...this.wantedGroups.keys()];
      const [projectGroups, reads] = await Promise.all([
        this.loadEach<ProjectTaleGroup[]>(
          projects.filter((p) => this.wantedProjectGroups.has(p.id)),
          (id) => `/projects/${encodeURIComponent(id)}/tale-groups`,
        ),
        Promise.all(ids.map((id) => this.readGroup(id))),
      ]);
      if (!current()) return;
      // A failed group read fails the refresh as any other read does; the groups keep what they show.
      const failed = reads.find((read): read is { error: unknown } => 'error' in read);
      if (failed) throw failed.error;
      this.projectTaleGroups.set(projectGroups);
      this.applyGroupReads(ids, reads);
      this.apiDown.set(false);
    } catch (err) {
      // A 401 means the session ended; the auth interceptor sends the user to sign-in.
      if (current() && !(err instanceof HttpErrorResponse && err.status === 401)) this.apiDown.set(true);
    } finally {
      if (current()) this.loaded.set(true);
    }
  }

  /** GETs one API path per project or zone, in parallel, keyed by its id; any failure rejects the whole load. */
  private async loadEach<T>(
    items: readonly { id: string }[],
    path: (id: string) => string,
  ): Promise<Record<string, T>> {
    const results = await Promise.all(
      items.map((item) => firstValueFrom(this.http.get<T>(`${API_BASE}${path(item.id)}`))),
    );
    return Object.fromEntries(items.map((item, i) => [item.id, results[i]]));
  }

  async createProject(name: string): Promise<string> {
    try {
      const project = await firstValueFrom(this.http.post<Project>(`${API_BASE}/projects`, { name }));
      this.selectProject(project.id);
      this.firstProjectRefusal.set('');
    } catch (err) {
      return apiErrorMessage(err, 'Project was not saved.');
    }
    await this.refresh();
    return '';
  }

  /** Creates a one-time invitation link to a project (admins only); the link is shown only now. */
  async createInvitation(projectId: string): Promise<{ invitation: Invitation | null; message: string }> {
    try {
      const invitation = await firstValueFrom(
        this.http.post<Invitation>(`${API_BASE}/projects/${encodeURIComponent(projectId)}/invitations`, {}),
      );
      return { invitation, message: '' };
    } catch (err) {
      return { invitation: null, message: apiErrorMessage(err, 'The invitation was not created. Try again.') };
    }
  }

  /** Creates a zone; an empty slug lets the API make one from the name, unique in the project (epic UX rework R1). */
  async createZone(name: string, projectId: string, slug = '', template?: ZoneTemplateKey): Promise<ZoneChangeResult> {
    let created: Zone;
    try {
      // A template sets the zone's display in the same request (epic UX rework R5).
      created = await firstValueFrom(
        this.http.post<Zone>(`${API_BASE}/zones`, { name, projectId, ...(slug && { slug }), ...(template && { template }) }),
      );
    } catch (err) {
      return {
        // With one project there is no picker to point at.
        message: apiErrorMessage(
          err,
          this.projects().length === 1
            ? 'Zone was not saved. Enter a name.'
            : 'Zone was not saved. Choose a project and enter a name.',
        ),
        field: zoneErrorField(err),
      };
    }
    await this.refresh();
    return { message: '', field: null, zoneId: created.id };
  }

  /** Renames a zone or changes its slug (epic UX rework R1); a page names the zone by its slug. */
  async updateZone(zoneId: string, change: { name?: string; slug?: string }): Promise<ZoneChangeResult> {
    let saved: Zone;
    try {
      saved = await firstValueFrom(this.http.patch<Zone>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}`, change));
    } catch (err) {
      return { message: apiErrorMessage(err, 'The zone was not saved. Try again.'), field: zoneErrorField(err) };
    }
    this.zones.update((zones) => zones.map((zone) => (zone.id === zoneId ? saved : zone)));
    return { message: '', field: null };
  }

  /** Gives a zone its display: a frame of the type, with the type's default settings (AD-17). */
  async setDisplay(zoneId: string, type: string): Promise<string> {
    try {
      await firstValueFrom(this.http.post<Frame>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/frame`, { type }));
    } catch (err) {
      return apiErrorMessage(err, 'The display was not saved. Choose a display type.');
    }
    // A display changes the zone's visibility and its groups' (epic UX rework R7).
    await this.refresh();
    return '';
  }

  /**
   * Changes a zone's display: a new type resets its settings to that type's defaults; settings are
   * validated against the type's schema by the API (AD-5). The display keeps its id.
   */
  async updateDisplay(zoneId: string, change: { type?: string; settings?: Record<string, unknown> }): Promise<string> {
    let saved: Frame;
    try {
      saved = await firstValueFrom(this.http.patch<Frame>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/frame`, change));
    } catch (err) {
      return apiErrorMessage(
        err,
        change.type ? 'The display type was not changed. Try again.' : 'Settings were not saved. Try again.',
      );
    }
    this.zones.update((zones) => zones.map((zone) => (zone.id === zoneId ? { ...zone, frame: saved } : zone)));
    return '';
  }

  /** Creates a tale group in a zone; returns the API's message, or '' and records the new group's id. */
  async createTaleGroup(zoneId: string, name: string): Promise<string> {
    let created: ZoneTaleGroup;
    try {
      created = await firstValueFrom(this.http.post<ZoneTaleGroup>(`${API_BASE}/zones/${zoneId}/tale-groups`, { name }));
    } catch (err) {
      return taleGroupCreateMessage(err, 'Tale group was not saved. Try again.');
    }
    this.createdTaleGroupId.set(created.id);
    await this.refresh();
    return '';
  }

  /** Creates a tale group in the project, placed in no zone yet (epic UX rework R14), as createTaleGroup does. */
  async createProjectTaleGroup(projectId: string, name: string): Promise<string> {
    let created: ProjectTaleGroup;
    try {
      created = await firstValueFrom(
        this.http.post<ProjectTaleGroup>(`${API_BASE}/projects/${encodeURIComponent(projectId)}/tale-groups`, { name }),
      );
    } catch (err) {
      return taleGroupCreateMessage(err, 'Tale group was not saved. Try again.');
    }
    this.createdTaleGroupId.set(created.id);
    await this.refresh();
    return '';
  }

  /** Renames a tale group; every zone it is placed in shows the new name (AD-14). */
  async renameTaleGroup(taleGroupId: string, name: string): Promise<string> {
    try {
      await firstValueFrom(
        this.http.patch<TaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}`, { name }),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The tale group was not renamed. Try again.');
    }
    await this.refresh();
    return '';
  }

  /** Places an existing tale group at the end of another zone of its project (AD-14). */
  async placeTaleGroup(zoneId: string, taleGroupId: string): Promise<string> {
    try {
      await firstValueFrom(
        this.http.put<ZoneTaleGroup>(
          `${API_BASE}/zones/${encodeURIComponent(zoneId)}/tale-groups/${encodeURIComponent(taleGroupId)}`,
          {},
        ),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The tale group was not added to the zone. Try again.');
    }
    await this.refresh();
    return '';
  }

  /**
   * Copies a tale group into a zone of its own or another accessible project,
   * as an independent group with the same tales, media and tags (AD-14).
   * Returns the copy as the target zone lists it, or the message to show.
   */
  async copyTaleGroup(taleGroupId: string, zoneId: string): Promise<{ copy: ZoneTaleGroup | null; message: string }> {
    let copy: ZoneTaleGroup;
    try {
      copy = await firstValueFrom(
        this.http.post<ZoneTaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}/copy`, { zoneId }),
      );
    } catch (err) {
      return { copy: null, message: taleGroupCreateMessage(err, 'The tale group was not copied. Try again.') };
    }
    await this.refresh();
    return { copy, message: '' };
  }

  /** Removes a tale group from one zone; the group stays in its project and its other zones. */
  async removeTaleGroup(zoneId: string, taleGroupId: string): Promise<string> {
    try {
      await firstValueFrom(
        this.http.delete<void>(
          `${API_BASE}/zones/${encodeURIComponent(zoneId)}/tale-groups/${encodeURIComponent(taleGroupId)}`,
        ),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The tale group was not removed from the zone. Try again.');
    }
    await this.refresh();
    return '';
  }

  /**
   * Publishes, pauses, archives or restores a tale group (AD-6); every zone it
   * is placed in shows the new status, and its tales' status as read follows.
   */
  async setTaleGroupStatus(taleGroupId: string, status: SettableStatus): Promise<string> {
    return (await this.changeTaleGroupStatus(taleGroupId, status)).message;
  }

  /** As setTaleGroupStatus, also returning the group as the API saved it (its visibility in any zone). */
  async changeTaleGroupStatus(
    taleGroupId: string,
    status: SettableStatus,
  ): Promise<{ message: string; group: TaleGroup | null }> {
    let group: TaleGroup;
    try {
      group = await firstValueFrom(
        this.http.put<TaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}/status`, { status }),
      );
      this.applyGroupStatus(group);
    } catch (err) {
      return { message: apiErrorMessage(err, 'The status was not changed. Try again.'), group: null };
    }
    await this.refresh();
    return { message: '', group };
  }

  // Shows a saved group status at once, from the API's answer, in every zone and project list and
  // in the confirmed order of a zone with a reorder pending, so the order settling (saved or
  // refused) does not bring the old status back. The refresh that follows confirms it; an older
  // refresh still loading writes nothing once that one starts (see `refreshes`).
  private applyGroupStatus(group: TaleGroup): void {
    this.patchZoneGroups(group.id, (g) => ({
      ...g,
      status: group.status,
      storedStatus: group.storedStatus,
      tales: group.tales,
    }));
    // A group read on its own takes the answer whole: it is read in any zone too.
    this.patchReadGroup(group.id, (g) => ({ ...g, ...group }));
    this.projectTaleGroups.update((lists) =>
      Object.fromEntries(
        Object.entries(lists).map(([id, list]) => [
          id,
          list.map((g) =>
            g.id === group.id
              ? {
                  ...g,
                  status: group.status,
                  storedStatus: group.storedStatus,
                  // The status route reads the group in any zone, as the project's list does.
                  visibility: group.visibility,
                  taleCount: group.tales.length,
                  shownTaleCount: shownTales(group.tales),
                }
              : g,
          ),
        ]),
      ),
    );
  }

  // Shows a saved tale status at once, from the API's answer, wherever its group is listed, as
  // applyGroupStatus does.
  private applyTaleStatus(tale: Tale): void {
    const before = this.tale(tale.id)?.storedStatus;
    this.patchZoneGroups(tale.taleGroupId, (g) => ({
      ...g,
      tales: g.tales.map((t) => (t.id === tale.id ? { ...t, status: tale.status, storedStatus: tale.storedStatus } : t)),
    }));
    // A group read on its own is read in any zone, as the status route answers: its visibility too.
    this.patchReadGroup(tale.taleGroupId, (g) => ({
      ...g,
      tales: g.tales.map((t) =>
        t.id === tale.id ? { ...t, status: tale.status, storedStatus: tale.storedStatus, visibility: tale.visibility ?? t.visibility } : t,
      ),
    }));
    const confirmed = this.confirmedTales.get(tale.taleGroupId);
    if (confirmed) {
      this.confirmedTales.set(
        tale.taleGroupId,
        confirmed.map((t) => (t.id === tale.id ? { ...t, status: tale.status, storedStatus: tale.storedStatus } : t)),
      );
    }
    // The project's list counts Shown tales: from the group's tales when a zone lists them, else by the change.
    const listed = this.taleGroup(tale.taleGroupId);
    const delta = before === undefined ? 0 : Number(tale.storedStatus === 'live') - Number(before === 'live');
    this.projectTaleGroups.update((lists) =>
      Object.fromEntries(
        Object.entries(lists).map(([id, list]) => [
          id,
          list.map((g) =>
            g.id === tale.taleGroupId
              ? { ...g, shownTaleCount: listed ? shownTales(listed.tales) : Math.max(0, g.shownTaleCount + delta) }
              : g,
          ),
        ]),
      ),
    );
  }

  // Patches one group in every zone's list and in every confirmed order kept for a pending reorder.
  private patchZoneGroups(taleGroupId: string, patch: (g: ZoneTaleGroup) => ZoneTaleGroup): void {
    const patched = (list: ZoneTaleGroup[]) => list.map((g) => (g.id === taleGroupId ? patch(g) : g));
    this.taleGroups.update((lists) =>
      Object.fromEntries(Object.entries(lists).map(([id, list]) => [id, patched(list)])),
    );
    for (const [zoneId, confirmed] of this.confirmedGroups) this.confirmedGroups.set(zoneId, patched(confirmed));
  }

  // Patches a group read on its own, when one is.
  private patchReadGroup(taleGroupId: string, patch: (g: TaleGroup) => TaleGroup): void {
    const group = this.readGroups()[taleGroupId];
    if (group) this.readGroups.update((groups) => ({ ...groups, [taleGroupId]: patch(group) }));
  }

  /** Publishes, pauses, archives or restores a tale (AD-6). Returns the saved tale, or the message to show. */
  async setTaleStatus(
    taleId: string,
    status: SettableStatus,
  ): Promise<{ tale: Tale | null; message: string; warning: string }> {
    let tale: TaleStatusResult;
    try {
      tale = await firstValueFrom(
        this.http.put<TaleStatusResult>(`${API_BASE}/tales/${encodeURIComponent(taleId)}/status`, { status }),
      );
      this.applyTaleStatus(tale);
    } catch (err) {
      return { tale: null, message: apiErrorMessage(err, 'The status was not changed. Try again.'), warning: '' };
    }
    await this.refresh();
    // Going live publishes the tale's studio draft when nothing is published yet, unless it no longer passes (AD-15).
    const warning = tale.draftNotPublished
      ? "Tale is shown; its studio draft has problems and wasn't put on the site. " +
        (tale.draftNotPublishedReason ? `${tale.draftNotPublishedReason} ` : '') +
        'Open Tale Studio to fix it, then press Update tale.'
      : '';
    return { tale, message: '', warning };
  }

  /**
   * Sets or clears the start and end time of a tale group or tale (AD-6), in
   * UTC; every zone shows the status that follows from it. Returns '' or the
   * message to show, such as the API's refusal of an end before the start.
   */
  async setSchedule(
    target: ScheduleTarget,
    id: string,
    schedule: SetScheduleRequest,
  ): Promise<string> {
    const path = target === 'taleGroup' ? 'tale-groups' : 'tales';
    try {
      await firstValueFrom(this.http.put(`${API_BASE}/${path}/${encodeURIComponent(id)}/schedule`, schedule));
    } catch (err) {
      return apiErrorMessage(err, 'The schedule was not saved. Try again.');
    }
    await this.refresh();
    return '';
  }

  /** Creates a tag in a project and adds it to the project's tags. */
  async createTag(projectId: string, name: string): Promise<{ tag: Tag | null; message: string }> {
    try {
      const tag = await firstValueFrom(
        this.http.post<Tag>(`${API_BASE}/projects/${encodeURIComponent(projectId)}/tags`, { name }),
      );
      this.tags.update((all) => ({ ...all, [projectId]: [...(all[projectId] ?? []), tag].sort(compareTags) }));
      return { tag, message: '' };
    } catch (err) {
      return { tag: null, message: apiErrorMessage(err, 'The tag was not created. Try again.') };
    }
  }

  /** Replaces a tale group's tags; the group shows the saved tags. */
  async setTaleGroupTags(taleGroupId: string, tagIds: string[]): Promise<string> {
    let saved: TaleGroup;
    try {
      saved = await firstValueFrom(
        this.http.put<TaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}/tags`, { tagIds }),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The tags were not saved. Try again.');
    }
    // Only the tags change, in every zone the group is placed in (AD-14): the
    // group's tales and positions may have moved meanwhile.
    const withSavedTags = (groups: ZoneTaleGroup[]) =>
      groups.map((g) => (g.id === taleGroupId ? { ...g, tags: saved.tags } : g));
    this.taleGroups.update((all) => {
      const next = { ...all };
      for (const zoneId of saved.zoneIds) if (next[zoneId]) next[zoneId] = withSavedTags(next[zoneId]);
      return next;
    });
    for (const zoneId of saved.zoneIds) {
      const confirmed = this.confirmedGroups.get(zoneId);
      if (confirmed) this.confirmedGroups.set(zoneId, withSavedTags(confirmed));
    }
    this.patchReadGroup(taleGroupId, (g) => ({ ...g, tags: saved.tags }));
    return '';
  }

  /**
   * Sets the order of a zone's tale groups. The new order shows at once; when
   * the API refuses it, the last confirmed order comes back and the API's
   * message is returned.
   */
  orderTaleGroups(zoneId: string, taleGroupIds: string[]): Promise<string> {
    const byId = new Map(this.taleGroupsOf(zoneId).map((g) => [g.id, g]));
    const next = taleGroupIds.flatMap((id, position) => {
      const group = byId.get(id);
      return group ? [{ ...group, position }] : [];
    });
    return this.enqueueOrder(
      zoneId,
      next,
      () =>
        firstValueFrom(this.http.put<ZoneTaleGroup[]>(`${API_BASE}/zones/${zoneId}/tale-groups/order`, { taleGroupIds })),
      // Only the order comes from the response; each group keeps its confirmed tales and tags,
      // which a tags change or tale order may have updated meanwhile.
      (confirmed, saved) =>
        saved.map((group) => {
          const current = confirmed.find((g) => g.id === group.id);
          return current ? { ...current, position: group.position } : group;
        }),
    );
  }

  /**
   * Sets the order of a tale group's tales, from whichever view shows it (a zone page, or the Tale
   * groups page for a group read on its own, story 8.19), through the group's own queue. The new
   * order shows at once wherever the group is shown; when the API refuses it, the last confirmed
   * order comes back and the API's message is returned.
   */
  orderTales(taleGroupId: string, taleIds: string[]): Promise<string> {
    const group = this.taleGroup(taleGroupId);
    if (!group) return Promise.resolve('This tale group no longer exists.');
    const byId = new Map(group.tales.map((t) => [t.id, t]));
    const tales = taleIds.flatMap((id, position) => {
      const tale = byId.get(id);
      return tale ? [{ ...tale, position }] : [];
    });
    const key = taleOrderKey(taleGroupId);
    const pending = this.pendingOrders.get(key) ?? 0;
    if (pending === 0) this.confirmedTales.set(taleGroupId, group.tales);
    this.pendingOrders.set(key, pending + 1);
    this.showTales(taleGroupId, tales);
    const epoch = this.orderEpochs.get(key) ?? 0;

    const run = async (): Promise<string> => {
      try {
        if ((this.orderEpochs.get(key) ?? 0) !== epoch) return '';
        try {
          const saved = await firstValueFrom(
            this.http.put<Tale[]>(`${API_BASE}/tale-groups/${taleGroupId}/tales/order`, { taleIds }),
          );
          this.confirmedTales.set(taleGroupId, saved);
          this.confirmTalesInPendingZones(taleGroupId, saved);
          if (this.pendingOrders.get(key) === 1) this.showTales(taleGroupId, saved);
          return '';
        } catch (err) {
          this.orderEpochs.set(key, epoch + 1);
          this.showTales(taleGroupId, this.confirmedTales.get(taleGroupId) ?? group.tales);
          return apiErrorMessage(err, 'The new order was not saved. Try again.');
        }
      } finally {
        const left = (this.pendingOrders.get(key) ?? 1) - 1;
        this.pendingOrders.set(key, left);
        if (left === 0) {
          // A refresh kept the shown order while this waited: read it now that it is settled.
          const stale = this.staleOrders.delete(key);
          this.forgetTaleOrder(taleGroupId);
          if (stale) void this.refresh();
        }
      }
    };
    const result = (this.orderQueues.get(key) ?? Promise.resolve()).then(run);
    this.orderQueues.set(key, result);
    return result;
  }

  // Shows a group's tales in that order wherever it is shown: every zone list and its own read.
  private showTales(taleGroupId: string, tales: Tale[]): void {
    this.taleGroups.update((lists) =>
      Object.fromEntries(
        Object.entries(lists).map(([id, list]) => [id, list.some((g) => g.id === taleGroupId) ? withTales(list, taleGroupId, tales) : list]),
      ),
    );
    this.patchReadGroup(taleGroupId, (g) => ({ ...g, tales }));
  }

  // A saved tale order goes into the confirmed group order of each zone with a group reorder
  // pending, and only there, so a refusal of that reorder does not bring the old tale order back.
  private confirmTalesInPendingZones(taleGroupId: string, tales: Tale[]): void {
    for (const [zoneId, confirmed] of this.confirmedGroups) {
      if ((this.pendingOrders.get(zoneId) ?? 0) > 0) this.confirmedGroups.set(zoneId, withTales(confirmed, taleGroupId, tales));
    }
  }

  // Drops a group's tale order bookkeeping once nothing is pending for it.
  private forgetTaleOrder(taleGroupId: string): void {
    const key = taleOrderKey(taleGroupId);
    if ((this.pendingOrders.get(key) ?? 0) > 0) return;
    this.pendingOrders.delete(key);
    this.orderEpochs.delete(key);
    this.orderQueues.delete(key);
    this.staleOrders.delete(key);
    this.confirmedTales.delete(taleGroupId);
  }

  /**
   * A refresh's zone lists, with the tales of a group whose tale order write is pending kept as
   * they are shown (the read may predate the write); the group is read again once it settles.
   */
  private keepPendingTales(lists: Record<string, ZoneTaleGroup[]>): Record<string, ZoneTaleGroup[]> {
    return Object.fromEntries(
      Object.entries(lists).map(([id, list]) => [id, list.map((g) => this.withPendingTales(g, this.taleGroup(g.id)?.tales))]),
    );
  }

  // A group as read, or with `shownTales` kept while its tale order write is pending.
  private withPendingTales<G extends TaleGroup>(group: G, shownTales: Tale[] | undefined): G {
    const key = taleOrderKey(group.id);
    if ((this.pendingOrders.get(key) ?? 0) === 0 || !shownTales) return group;
    this.staleOrders.add(key);
    return { ...group, tales: shownTales };
  }

  // Shows `optimistic` at once, then sends the request after the zone's earlier group order
  // requests settle. A success updates the confirmed order (shown when nothing else is pending); a
  // refusal shows the confirmed order again and drops the moves queued behind it, which were built
  // on the refused order.
  private enqueueOrder<T>(
    zoneId: string,
    optimistic: ZoneTaleGroup[],
    send: () => Promise<T>,
    confirm: (confirmed: ZoneTaleGroup[], saved: T) => ZoneTaleGroup[],
  ): Promise<string> {
    const pending = this.pendingOrders.get(zoneId) ?? 0;
    if (pending === 0) this.confirmedGroups.set(zoneId, this.taleGroupsOf(zoneId));
    this.pendingOrders.set(zoneId, pending + 1);
    this.setZoneGroups(zoneId, optimistic);
    const epoch = this.orderEpochs.get(zoneId) ?? 0;

    const run = async (): Promise<string> => {
      try {
        if ((this.orderEpochs.get(zoneId) ?? 0) !== epoch) return '';
        try {
          const saved = await send();
          const confirmed = confirm(this.confirmedGroups.get(zoneId) ?? [], saved);
          this.confirmedGroups.set(zoneId, confirmed);
          if (this.pendingOrders.get(zoneId) === 1) this.setZoneGroups(zoneId, confirmed);
          return '';
        } catch (err) {
          this.orderEpochs.set(zoneId, epoch + 1);
          this.setZoneGroups(zoneId, this.confirmedGroups.get(zoneId) ?? []);
          return apiErrorMessage(err, 'The new order was not saved. Try again.');
        }
      } finally {
        const left = (this.pendingOrders.get(zoneId) ?? 1) - 1;
        this.pendingOrders.set(zoneId, left);
        // A refresh skipped this zone while it waited: read it now that its order is settled.
        if (left === 0 && this.staleOrders.delete(zoneId)) void this.refresh();
      }
    };
    const result = (this.orderQueues.get(zoneId) ?? Promise.resolve()).then(run);
    this.orderQueues.set(zoneId, result);
    return result;
  }

  /**
   * A refresh's lists, except for a zone with order writes still pending: it keeps the order shown
   * (which the read may predate) and is read again once those writes settle.
   */
  private keepPendingOrders(groups: Record<string, ZoneTaleGroup[]>): Record<string, ZoneTaleGroup[]> {
    const shown = this.taleGroups();
    const kept = { ...groups };
    for (const zoneId of Object.keys(groups)) {
      if ((this.pendingOrders.get(zoneId) ?? 0) > 0 && shown[zoneId]) {
        kept[zoneId] = shown[zoneId];
        this.staleOrders.add(zoneId);
      }
    }
    return kept;
  }

  private setZoneGroups(zoneId: string, groups: ZoneTaleGroup[]): void {
    this.taleGroups.update((all) => ({ ...all, [zoneId]: groups }));
  }

  /**
   * Adds a tale, then uploads `file` as its media when one is given. When the
   * tale is saved but its media is not, the drawer switches to that tale so the
   * upload can be retried, and the API's message is returned.
   */
  async createTale(taleGroupId: string, title: string, file: File | null = null): Promise<string> {
    let tale: Tale;
    try {
      tale = await firstValueFrom(this.http.post<Tale>(`${API_BASE}/tale-groups/${taleGroupId}/tales`, { title }));
    } catch (err) {
      return apiErrorMessage(err, 'Tale was not saved. Try again.');
    }
    const message = (file && (await this.putMedia(tale.id, file))) || '';
    await this.refresh();
    if (message) {
      this.drawer.set({ kind: 'taleMedia', taleId: tale.id });
      return `The tale was added, but its media was not saved. ${message}`;
    }
    return '';
  }

  /**
   * Adds one tale per file to a tale group, in the files' order, each titled after its file name and
   * with the file as its media, sent with its checked `type` (epic UX rework R13: a new group gets
   * its tales in the same step). New tales start Shown (R6). Stops at the first refusal, or when
   * `signal` aborts; a tale whose media was not saved is hidden, so it never shows empty. Reads the
   * lists again once. `progress` is told the 1-based number of the file being added.
   */
  async addTalesFromFiles(
    taleGroupId: string,
    files: readonly { file: File; type: string }[],
    options: { progress?: (n: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ added: number; message: string }> {
    const { progress, signal } = options;
    let added = 0;
    let message = '';
    for (const [i, { file, type }] of files.entries()) {
      if (signal?.aborted) {
        message = 'Stopped.';
        break;
      }
      progress?.(i + 1);
      const title = taleTitleFromFile(file.name);
      let tale: Tale;
      try {
        tale = await firstValueFrom(this.http.post<Tale>(`${API_BASE}/tale-groups/${taleGroupId}/tales`, { title }));
      } catch (err) {
        message = apiErrorMessage(err, `The tale "${title}" was not saved.`);
        break;
      }
      const refused = await this.putMedia(tale.id, file, { type, signal });
      if (refused !== '') {
        // Hidden, so a tale without its media never shows; removing it is left to the user.
        try {
          await firstValueFrom(this.http.put<Tale>(`${API_BASE}/tales/${tale.id}/status`, { status: 'paused' }));
        } catch {
          // A tale without media is not delivered anyway (AD-15).
        }
        message =
          refused === null
            ? `Stopped. The tale "${title}" was added hidden, without its media.`
            : `The tale "${title}" was added hidden, without its media. ${refused}`;
        break;
      }
      added++;
    }
    await this.refresh();
    return { added, message };
  }

  /**
   * Uploads or replaces a tale's image, GIF or video, then reads the lists again. Resolves to ''
   * when saved, the API's message when refused, and null when `options.signal` aborted it first.
   */
  async uploadTaleMedia(taleId: string, file: File, options: MediaUploadOptions = {}): Promise<string | null> {
    const message = await this.putMedia(taleId, file, options);
    if (message === '') await this.refresh();
    return message;
  }

  // Sends the file's bytes with its type (`options.type`, else the file's); the API checks type and
  // size. Aborting `options.signal` unsubscribes, which aborts the request, and resolves to null.
  private putMedia(taleId: string, file: File, options: MediaUploadOptions = {}): Promise<string | null> {
    const { progress, signal } = options;
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve(null);
      // Called only after `subscription` is set: from the signal, listened to once it is.
      const abort = () => {
        subscription.unsubscribe();
        resolve(null);
      };
      const done = (message: string) => {
        signal?.removeEventListener('abort', abort);
        resolve(message);
      };
      const subscription: Subscription = this.http
        .put<Tale>(`${API_BASE}/tales/${taleId}/media`, file, {
          headers: { 'Content-Type': options.type || file.type || 'application/octet-stream' },
          observe: 'events',
          reportProgress: !!progress,
        })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress) progress?.(event.total ? event.loaded / event.total : null);
          },
          error: (err) => done(apiErrorMessage(err, 'Media was not saved. Try again.')),
          complete: () => {
            this.mediaVersions.update((versions) => ({ ...versions, [taleId]: (versions[taleId] ?? 0) + 1 }));
            done('');
          },
        });
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  /**
   * Sets or replaces a tale group's cover with a file made or picked in the
   * browser: an image, a video frame or a short clip (epic web zones R12). The
   * API checks its type and size (an animated cover is at most 300 KB).
   */
  async uploadCover(taleGroupId: string, file: Blob): Promise<string> {
    try {
      await firstValueFrom(
        this.http.put<TaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}/cover`, file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        }),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The cover was not saved. Try again.');
    }
    this.coverVersions.update((versions) => ({ ...versions, [taleGroupId]: (versions[taleGroupId] ?? 0) + 1 }));
    await this.refresh();
    return '';
  }

  /** Removes a tale group's cover: the bar shows its first tale's media again. */
  async removeCover(taleGroupId: string): Promise<string> {
    try {
      await firstValueFrom(this.http.delete<TaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}/cover`));
    } catch (err) {
      return apiErrorMessage(err, 'The cover was not removed. Try again.');
    }
    await this.refresh();
    return '';
  }

  private readStoredProjectId(): string {
    if (!this.isBrowser) return '';
    try {
      return localStorage.getItem(SELECTED_PROJECT_KEY) ?? '';
    } catch {
      return '';
    }
  }
}
