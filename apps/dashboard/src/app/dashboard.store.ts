import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  isErrorBody,
  type AppliedPlaybook,
  type Frame,
  type FrameType,
  type Invitation,
  type IssuedZoneKey,
  type Project,
  type ProjectTaleGroup,
  type SetScheduleRequest,
  type SettableStatus,
  type Stage,
  type Tag,
  type Tale,
  type TaleGroup,
  type TaleGroupCover,
  type Zone,
  type ZoneKeyInfo,
  type ZoneTaleGroup,
} from '@taleart/contract/core';
import type { TaleStatusResult } from '@taleart/contract/tale-document';
import { firstValueFrom } from 'rxjs';

// The Management API, on the dashboard's own origin: the dev server proxies
// /api to the API (proxy.conf.json), so the session cookie is same-origin.
export const API_BASE = '/api/v1';

/** Media URLs from the API are paths on the API's origin, which is the dashboard's own. */
export const API_ORIGIN = '';

/** The localStorage key holding the project picked in the top bar. */
export const SELECTED_PROJECT_KEY = 'taleart.selectedProjectId';

/** Which create drawer is open, and for what. */
export type DrawerRequest =
  | { kind: 'project' }
  | { kind: 'invite'; projectId: string }
  | { kind: 'zone' }
  | { kind: 'frame'; zoneId: string }
  | { kind: 'frameSettings'; zoneId: string; frameId: string }
  | { kind: 'taleGroup'; zoneId: string }
  | { kind: 'tale'; taleGroupId: string }
  | { kind: 'tags'; taleGroupId: string }
  | { kind: 'renameTaleGroup'; taleGroupId: string }
  | { kind: 'placeTaleGroup'; taleGroupId: string }
  | { kind: 'removeTaleGroup'; zoneId: string; taleGroupId: string }
  | { kind: 'copyTaleGroup'; taleGroupId: string }
  | { kind: 'taleMedia'; taleId: string }
  | { kind: 'cover'; taleGroupId: string }
  | { kind: 'schedule'; target: ScheduleTarget; id: string }
  | { kind: 'zoneKey'; zoneId: string; action: ZoneKeyAction }
  | { kind: 'stage'; zoneId: string }
  | { kind: 'renameStage'; zoneId: string; stageId: string }
  | { kind: 'deleteStage'; zoneId: string; stageId: string }
  | { kind: 'applyPlaybook'; zoneId: string };

/** What a schedule drawer sets the start and end time of (AD-6). */
export type ScheduleTarget = 'taleGroup' | 'tale';

/** What a zone key drawer does: issue the first key, rotate the active one, or revoke it. */
export type ZoneKeyAction = 'issue' | 'rotate' | 'revoke';

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

/** All dashboard data and every Management API call. Create calls resolve to '' or the message to show. */
@Injectable({ providedIn: 'root' })
export class DashboardStore {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly projects = signal<Project[]>([]);
  readonly zones = signal<Zone[]>([]);
  readonly frameTypes = signal<FrameType[]>([]);
  /** Each zone's frames, keyed by zone id. */
  readonly frames = signal<Record<string, Frame[]>>({});
  /**
   * Each zone's tale groups, each with its tales and its position in that zone,
   * keyed by zone id. A group placed in several zones shows in each (AD-14).
   */
  readonly taleGroups = signal<Record<string, ZoneTaleGroup[]>>({});
  /** Each project's tale groups by name, placed in a zone or not, keyed by project id. */
  readonly projectTaleGroups = signal<Record<string, ProjectTaleGroup[]>>({});
  /** Each project's tags by name, keyed by project id. */
  readonly tags = signal<Record<string, Tag[]>>({});
  /** Each zone's active key (prefix and date, never the key), or null; keyed by zone id. */
  readonly zoneKeys = signal<Record<string, ZoneKeyInfo | null>>({});
  /** Each zone's stages, oldest first, keyed by zone id (epic web zones R7). */
  readonly stages = signal<Record<string, Stage[]>>({});
  /** True once the first refresh finished, successfully or not. */
  readonly loaded = signal(false);
  readonly apiDown = signal(false);

  readonly drawer = signal<DrawerRequest | null>(null);
  /**
   * Order requests run one at a time per zone, across groups and tales, so the
   * database applies them in the order they were made. Per zone: the tail of
   * that queue, the last order the API confirmed, how many requests are not
   * settled, and an epoch bumped by a refusal so moves queued behind it are dropped.
   */
  private readonly orderQueues = new Map<string, Promise<unknown>>();
  private readonly confirmedGroups = new Map<string, ZoneTaleGroup[]>();
  private readonly pendingOrders = new Map<string, number>();
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

  openDrawer(request: DrawerRequest, event?: Event): void {
    const target = event?.currentTarget;
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

  framesOf(zoneId: string): Frame[] {
    return this.frames()[zoneId] ?? [];
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

  /** A tale group as some zone lists it; its content is the same in every zone (AD-14). */
  taleGroup(taleGroupId: string): ZoneTaleGroup | undefined {
    return Object.values(this.taleGroups())
      .flat()
      .find((g) => g.id === taleGroupId);
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

  /** The zones of the group's project that do not hold the group yet: where "Add to zone…" can place it. */
  zonesToPlace(taleGroupId: string): Zone[] {
    const group = this.projectTaleGroup(taleGroupId) ?? this.taleGroup(taleGroupId);
    if (!group) return [];
    return this.zones().filter((z) => z.projectId === group.projectId && !group.zoneIds.includes(z.id));
  }

  stagesOf(zoneId: string): Stage[] {
    return this.stages()[zoneId] ?? [];
  }

  /** A stage of the zone, if it still exists. */
  stage(zoneId: string, stageId: string): Stage | undefined {
    return this.stagesOf(zoneId).find((s) => s.id === stageId);
  }

  /** How a stage form and the stage list name a frame of its zone: "Frame 2 · Banner". */
  frameName(zoneId: string, frameId: string): string {
    const frames = this.framesOf(zoneId);
    const index = frames.findIndex((f) => f.id === frameId);
    return index < 0 ? 'Unknown frame' : `Frame ${index + 1} · ${this.frameTypeLabel(frames[index].type)}`;
  }

  /** The zone's active key info, or null when it has none. */
  zoneKey(zoneId: string): ZoneKeyInfo | null {
    return this.zoneKeys()[zoneId] ?? null;
  }

  tagsOf(projectId: string): Tag[] {
    return this.tags()[projectId] ?? [];
  }

  tale(taleId: string): Tale | undefined {
    return Object.values(this.taleGroups())
      .flat()
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

  /** Bumped by reset(), so a refresh that started before it writes nothing. */
  private generation = 0;

  /** Forgets all loaded data, for example after sign-out. */
  reset(): void {
    this.generation++;
    this.projects.set([]);
    this.zones.set([]);
    this.frameTypes.set([]);
    this.frames.set({});
    this.taleGroups.set({});
    this.projectTaleGroups.set({});
    this.tags.set({});
    this.zoneKeys.set({});
    this.stages.set({});
    this.loaded.set(false);
    this.apiDown.set(false);
    this.drawer.set(null);
  }

  async refresh(): Promise<void> {
    const generation = this.generation;
    const current = () => generation === this.generation;
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
      const frames = await this.loadEach<Frame[]>(zones, (id) => `/zones/${id}/frames`);
      if (!current()) return;
      this.frames.set(frames);
      const groups = await this.loadEach<ZoneTaleGroup[]>(zones, (id) => `/zones/${id}/tale-groups`);
      if (!current()) return;
      this.taleGroups.set(groups);
      const tags = await this.loadEach<Tag[]>(projects, (id) => `/projects/${encodeURIComponent(id)}/tags`);
      if (!current()) return;
      this.tags.set(tags);
      const projectGroups = await this.loadEach<ProjectTaleGroup[]>(
        projects,
        (id) => `/projects/${encodeURIComponent(id)}/tale-groups`,
      );
      if (!current()) return;
      this.projectTaleGroups.set(projectGroups);
      const keys = await this.loadEach<ZoneKeyInfo | null>(zones, (id) => `/zones/${encodeURIComponent(id)}/key`);
      if (!current()) return;
      this.zoneKeys.set(Object.fromEntries(zones.map((zone) => [zone.id, keys[zone.id] ?? null])));
      const stages = await this.loadEach<Stage[]>(zones, (id) => `/zones/${encodeURIComponent(id)}/stages`);
      if (!current()) return;
      this.stages.set(stages);
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

  /**
   * Issues a key for a zone (admins only). When the zone has a key, this
   * rotates it: the old key stops working at once. The key is shown only now.
   */
  async issueZoneKey(zoneId: string): Promise<{ key: IssuedZoneKey | null; message: string }> {
    try {
      const key = await firstValueFrom(
        this.http.post<IssuedZoneKey>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/key`, {}),
      );
      this.zoneKeys.update((all) => ({ ...all, [zoneId]: { prefix: key.prefix, createdAt: key.createdAt } }));
      return { key, message: '' };
    } catch (err) {
      return { key: null, message: apiErrorMessage(err, 'The key was not issued. Try again.') };
    }
  }

  /** Revokes a zone's key (admins only); it stops working at once. */
  async revokeZoneKey(zoneId: string): Promise<string> {
    try {
      await firstValueFrom(this.http.delete<void>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/key`));
    } catch (err) {
      return apiErrorMessage(err, 'The key was not revoked. Try again.');
    }
    this.zoneKeys.update((all) => ({ ...all, [zoneId]: null }));
    return '';
  }

  async createZone(name: string, projectId: string): Promise<string> {
    try {
      await firstValueFrom(this.http.post<Zone>(`${API_BASE}/zones`, { name, projectId }));
    } catch (err) {
      return apiErrorMessage(err, 'Zone was not saved. Choose a project and enter a name.');
    }
    await this.refresh();
    return '';
  }

  async createFrame(zoneId: string, type: string): Promise<string> {
    try {
      await firstValueFrom(this.http.post<Frame>(`${API_BASE}/zones/${zoneId}/frames`, { type, settings: {} }));
    } catch (err) {
      return apiErrorMessage(err, 'Frame was not saved. Choose a frame type.');
    }
    await this.refresh();
    return '';
  }

  /** Replaces a frame's settings; the API validates them against the frame type's schema (AD-5). */
  async updateFrameSettings(zoneId: string, frameId: string, settings: Record<string, unknown>): Promise<string> {
    let saved: Frame;
    try {
      saved = await firstValueFrom(
        this.http.patch<Frame>(
          `${API_BASE}/zones/${encodeURIComponent(zoneId)}/frames/${encodeURIComponent(frameId)}`,
          { settings },
        ),
      );
    } catch (err) {
      return apiErrorMessage(err, 'Settings were not saved. Try again.');
    }
    this.frames.update((all) => ({
      ...all,
      [zoneId]: (all[zoneId] ?? []).map((frame) => (frame.id === saved.id ? saved : frame)),
    }));
    return '';
  }

  /**
   * Applies a playbook to a zone (R8): the API creates its frames and a stage
   * for each in one transaction and records the key on the zone. Applying the
   * zone's own playbook again creates nothing, so only what the API created is added here.
   */
  async applyPlaybook(zoneId: string, key: string): Promise<string> {
    let result: AppliedPlaybook;
    try {
      result = await firstValueFrom(
        this.http.put<AppliedPlaybook>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/playbook`, { key }),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The playbook was not applied. Try again.');
    }
    this.zones.update((zones) => zones.map((zone) => (zone.id === zoneId ? result.zone : zone)));
    this.frames.update((all) => ({ ...all, [zoneId]: [...(all[zoneId] ?? []), ...result.frames] }));
    this.stages.update((all) => ({ ...all, [zoneId]: [...(all[zoneId] ?? []), ...result.stages] }));
    return '';
  }

  /** Adds a stage that shows one of the zone's frames; a page names it by its key (R7). */
  async createStage(zoneId: string, input: { name: string; key: string; frameId: string }): Promise<string> {
    let saved: Stage;
    try {
      saved = await firstValueFrom(this.http.post<Stage>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/stages`, input));
    } catch (err) {
      return apiErrorMessage(err, 'The stage was not saved. Try again.');
    }
    this.stages.update((all) => ({ ...all, [zoneId]: [...(all[zoneId] ?? []), saved] }));
    return '';
  }

  /** Renames a stage; its key stays, so pages that name it keep working. */
  async renameStage(zoneId: string, stageId: string, name: string): Promise<string> {
    let saved: Stage;
    try {
      saved = await firstValueFrom(
        this.http.patch<Stage>(
          `${API_BASE}/zones/${encodeURIComponent(zoneId)}/stages/${encodeURIComponent(stageId)}`,
          { name },
        ),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The stage was not renamed. Try again.');
    }
    this.stages.update((all) => ({
      ...all,
      [zoneId]: (all[zoneId] ?? []).map((stage) => (stage.id === saved.id ? saved : stage)),
    }));
    return '';
  }

  /** Deletes a stage; pages that name its key render nothing for it. */
  async deleteStage(zoneId: string, stageId: string): Promise<string> {
    try {
      await firstValueFrom(
        this.http.delete<void>(`${API_BASE}/zones/${encodeURIComponent(zoneId)}/stages/${encodeURIComponent(stageId)}`),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The stage was not deleted. Try again.');
    }
    this.stages.update((all) => ({ ...all, [zoneId]: (all[zoneId] ?? []).filter((stage) => stage.id !== stageId) }));
    return '';
  }

  async createTaleGroup(zoneId: string, name: string): Promise<string> {
    try {
      await firstValueFrom(this.http.post<ZoneTaleGroup>(`${API_BASE}/zones/${zoneId}/tale-groups`, { name }));
    } catch (err) {
      return apiErrorMessage(err, 'Tale group was not saved. Try again.');
    }
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
      return { copy: null, message: apiErrorMessage(err, 'The tale group was not copied. Try again.') };
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
    try {
      await firstValueFrom(
        this.http.put<TaleGroup>(`${API_BASE}/tale-groups/${encodeURIComponent(taleGroupId)}/status`, { status }),
      );
    } catch (err) {
      return apiErrorMessage(err, 'The status was not changed. Try again.');
    }
    await this.refresh();
    return '';
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
    } catch (err) {
      return { tale: null, message: apiErrorMessage(err, 'The status was not changed. Try again.'), warning: '' };
    }
    await this.refresh();
    // Going live publishes the tale's studio draft when nothing is published yet, unless it no longer passes (AD-15).
    const warning = tale.draftNotPublished
      ? "Tale is live; its studio draft has problems and wasn't published. Open Tale Studio to fix and publish it."
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
   * Sets the order of a tale group's tales, from the zone page of `zoneId`.
   * The new order shows at once; when the API refuses it, the last confirmed
   * order comes back and the API's message is returned. The group's other
   * zones show the saved order once the API confirms it.
   */
  orderTales(zoneId: string, taleGroupId: string, taleIds: string[]): Promise<string> {
    const group = this.taleGroupsOf(zoneId).find((g) => g.id === taleGroupId);
    if (!group) return Promise.resolve('This tale group no longer exists.');
    const byId = new Map(group.tales.map((t) => [t.id, t]));
    const tales = taleIds.flatMap((id, position) => {
      const tale = byId.get(id);
      return tale ? [{ ...tale, position }] : [];
    });
    return this.enqueueOrder(
      zoneId,
      withTales(this.taleGroupsOf(zoneId), taleGroupId, tales),
      async () => {
        const saved = await firstValueFrom(
          this.http.put<Tale[]>(`${API_BASE}/tale-groups/${taleGroupId}/tales/order`, { taleIds }),
        );
        this.shareTales(zoneId, taleGroupId, saved);
        return saved;
      },
      (confirmed, saved) => withTales(confirmed, taleGroupId, saved),
    );
  }

  // Shows a group's saved tales in its other zones, which share them (AD-14).
  private shareTales(fromZoneId: string, taleGroupId: string, tales: Tale[]): void {
    const zoneIds = this.taleGroupsOf(fromZoneId).find((g) => g.id === taleGroupId)?.zoneIds ?? [];
    for (const zoneId of zoneIds) {
      if (zoneId === fromZoneId || !this.taleGroups()[zoneId]) continue;
      const confirmed = this.confirmedGroups.get(zoneId);
      if (confirmed) this.confirmedGroups.set(zoneId, withTales(confirmed, taleGroupId, tales));
      this.setZoneGroups(zoneId, withTales(this.taleGroupsOf(zoneId), taleGroupId, tales));
    }
  }

  // Shows `optimistic` at once, then sends the request after the zone's earlier
  // order requests settle. A success updates the confirmed order (shown when
  // nothing else is pending); a refusal shows the confirmed order again and
  // drops the moves queued behind it, which were built on the refused order.
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
        this.pendingOrders.set(zoneId, (this.pendingOrders.get(zoneId) ?? 1) - 1);
      }
    };
    const result = (this.orderQueues.get(zoneId) ?? Promise.resolve()).then(run);
    this.orderQueues.set(zoneId, result);
    return result;
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
    const message = file ? await this.putMedia(tale.id, file) : '';
    await this.refresh();
    if (message) {
      this.drawer.set({ kind: 'taleMedia', taleId: tale.id });
      return `The tale was added, but its media was not saved. ${message}`;
    }
    return '';
  }

  /** Uploads or replaces a tale's image, GIF or video. */
  async uploadTaleMedia(taleId: string, file: File): Promise<string> {
    const message = await this.putMedia(taleId, file);
    if (!message) await this.refresh();
    return message;
  }

  // Sends the file's bytes with its own type; the API checks type and size.
  private async putMedia(taleId: string, file: File): Promise<string> {
    try {
      await firstValueFrom(
        this.http.put<Tale>(`${API_BASE}/tales/${taleId}/media`, file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        }),
      );
    } catch (err) {
      return apiErrorMessage(err, 'Media was not saved. Try again.');
    }
    this.mediaVersions.update((versions) => ({ ...versions, [taleId]: (versions[taleId] ?? 0) + 1 }));
    return '';
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
