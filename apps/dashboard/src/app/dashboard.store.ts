import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  isErrorBody,
  type Frame,
  type FrameType,
  type Project,
  type Tale,
  type TaleGroup,
  type Zone,
} from '@taleart/contract';
import { firstValueFrom } from 'rxjs';

// The Management API base URL for local development.
export const API_BASE = 'http://localhost:3333/api/v1';

// Media URLs from the API are paths on the API's origin.
const API_ORIGIN = new URL(API_BASE).origin;

/** The localStorage key holding the project picked in the top bar. */
export const SELECTED_PROJECT_KEY = 'taleart.selectedProjectId';

/** Which create drawer is open, and for what. */
export type DrawerRequest =
  | { kind: 'project' }
  | { kind: 'zone' }
  | { kind: 'frame'; zoneId: string }
  | { kind: 'taleGroup'; zoneId: string }
  | { kind: 'tale'; taleGroupId: string }
  | { kind: 'taleMedia'; taleId: string };

// The groups with one group's tales replaced.
function withTales(groups: TaleGroup[], taleGroupId: string, tales: Tale[]): TaleGroup[] {
  return groups.map((g) => (g.id === taleGroupId ? { ...g, tales } : g));
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
  /** Each zone's tale groups, each with its tales, keyed by zone id. */
  readonly taleGroups = signal<Record<string, TaleGroup[]>>({});
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
  private readonly confirmedGroups = new Map<string, TaleGroup[]>();
  private readonly pendingOrders = new Map<string, number>();
  private readonly orderEpochs = new Map<string, number>();
  /** Bumped per tale on each upload, so a replaced file at the same URL is fetched again. */
  private readonly mediaVersions = signal<Record<string, number>>({});
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

  taleGroupsOf(zoneId: string): TaleGroup[] {
    return this.taleGroups()[zoneId] ?? [];
  }

  taleGroup(taleGroupId: string): TaleGroup | undefined {
    return Object.values(this.taleGroups())
      .flat()
      .find((g) => g.id === taleGroupId);
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

  async refresh(): Promise<void> {
    try {
      this.projects.set(await firstValueFrom(this.http.get<Project[]>(`${API_BASE}/projects`)));
      const zones = await firstValueFrom(this.http.get<Zone[]>(`${API_BASE}/zones`));
      this.zones.set(zones);
      this.frameTypes.set(await firstValueFrom(this.http.get<FrameType[]>(`${API_BASE}/frame-types`)));
      const lists = await Promise.all(
        zones.map((zone) => firstValueFrom(this.http.get<Frame[]>(`${API_BASE}/zones/${zone.id}/frames`))),
      );
      this.frames.set(Object.fromEntries(zones.map((zone, i) => [zone.id, lists[i]])));
      const groups = await Promise.all(
        zones.map((zone) =>
          firstValueFrom(this.http.get<TaleGroup[]>(`${API_BASE}/zones/${zone.id}/tale-groups`)),
        ),
      );
      this.taleGroups.set(Object.fromEntries(zones.map((zone, i) => [zone.id, groups[i]])));
      this.apiDown.set(false);
    } catch {
      this.apiDown.set(true);
    } finally {
      this.loaded.set(true);
    }
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

  async createTaleGroup(zoneId: string, name: string): Promise<string> {
    try {
      await firstValueFrom(this.http.post<TaleGroup>(`${API_BASE}/zones/${zoneId}/tale-groups`, { name }));
    } catch (err) {
      return apiErrorMessage(err, 'Tale group was not saved. Try again.');
    }
    await this.refresh();
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
      () => firstValueFrom(this.http.put<TaleGroup[]>(`${API_BASE}/zones/${zoneId}/tale-groups/order`, { taleGroupIds })),
      (_confirmed, saved) => saved,
    );
  }

  /**
   * Sets the order of a tale group's tales. The new order shows at once; when
   * the API refuses it, the last confirmed order comes back and the API's
   * message is returned.
   */
  orderTales(taleGroupId: string, taleIds: string[]): Promise<string> {
    const group = this.taleGroup(taleGroupId);
    if (!group) return Promise.resolve('This tale group no longer exists.');
    const { zoneId } = group;
    const byId = new Map(group.tales.map((t) => [t.id, t]));
    const tales = taleIds.flatMap((id, position) => {
      const tale = byId.get(id);
      return tale ? [{ ...tale, position }] : [];
    });
    return this.enqueueOrder(
      zoneId,
      withTales(this.taleGroupsOf(zoneId), taleGroupId, tales),
      () => firstValueFrom(this.http.put<Tale[]>(`${API_BASE}/tale-groups/${taleGroupId}/tales/order`, { taleIds })),
      (confirmed, saved) => withTales(confirmed, taleGroupId, saved),
    );
  }

  // Shows `optimistic` at once, then sends the request after the zone's earlier
  // order requests settle. A success updates the confirmed order (shown when
  // nothing else is pending); a refusal shows the confirmed order again and
  // drops the moves queued behind it, which were built on the refused order.
  private enqueueOrder<T>(
    zoneId: string,
    optimistic: TaleGroup[],
    send: () => Promise<T>,
    confirm: (confirmed: TaleGroup[], saved: T) => TaleGroup[],
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

  private setZoneGroups(zoneId: string, groups: TaleGroup[]): void {
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

  private readStoredProjectId(): string {
    if (!this.isBrowser) return '';
    try {
      return localStorage.getItem(SELECTED_PROJECT_KEY) ?? '';
    } catch {
      return '';
    }
  }
}
