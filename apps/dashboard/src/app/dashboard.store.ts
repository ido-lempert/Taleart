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

/** The localStorage key holding the project picked in the top bar. */
export const SELECTED_PROJECT_KEY = 'taleart.selectedProjectId';

/** Which create drawer is open, and for what. */
export type DrawerRequest =
  | { kind: 'project' }
  | { kind: 'zone' }
  | { kind: 'frame'; zoneId: string }
  | { kind: 'taleGroup'; zoneId: string }
  | { kind: 'tale'; taleGroupId: string };

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

  async createTale(taleGroupId: string, title: string): Promise<string> {
    try {
      await firstValueFrom(this.http.post<Tale>(`${API_BASE}/tale-groups/${taleGroupId}/tales`, { title }));
    } catch (err) {
      return apiErrorMessage(err, 'Tale was not saved. Try again.');
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
