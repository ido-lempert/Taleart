import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isErrorBody, type Frame, type FrameType } from '@taleart/contract';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

export interface Project {
  id: string;
  name: string;
}

export interface Zone {
  id: string;
  name: string;
  projectId: string;
}

// The Management API base URL for local development.
export const API_BASE = 'http://localhost:3333/api/v1';

// The API's own message when it sent the standard error body, else the fallback.
function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
}

@Component({
  imports: [FormsModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly projects = signal<Project[]>([]);
  protected readonly zones = signal<Zone[]>([]);
  protected readonly frameTypes = signal<FrameType[]>([]);
  /** Each zone's frames, keyed by zone id. */
  protected readonly frames = signal<Record<string, Frame[]>>({});
  protected readonly error = signal('');

  protected projectName = '';
  protected zoneName = '';
  protected zoneProjectId = '';
  /** The frame type picked for each zone, keyed by zone id. */
  protected frameTypeChoice: Record<string, string> = {};

  ngOnInit(): void {
    void this.refresh();
  }

  protected projectNameOf(projectId: string): string {
    return this.projects().find((p) => p.id === projectId)?.name ?? 'Unknown project';
  }

  // A type missing from the registry is shown by its raw key; the dashboard does not fail on it (AD-5).
  protected frameTypeLabel(type: string): string {
    return this.frameTypes().find((t) => t.key === type)?.label ?? type;
  }

  protected framesOf(zoneId: string): Frame[] {
    return this.frames()[zoneId] ?? [];
  }

  protected async refresh(): Promise<void> {
    try {
      this.projects.set(await firstValueFrom(this.http.get<Project[]>(`${API_BASE}/projects`)));
      const zones = await firstValueFrom(this.http.get<Zone[]>(`${API_BASE}/zones`));
      this.zones.set(zones);
      this.frameTypes.set(await firstValueFrom(this.http.get<FrameType[]>(`${API_BASE}/frame-types`)));
      const lists = await Promise.all(
        zones.map((zone) => firstValueFrom(this.http.get<Frame[]>(`${API_BASE}/zones/${zone.id}/frames`))),
      );
      this.frames.set(Object.fromEntries(zones.map((zone, i) => [zone.id, lists[i]])));
      for (const zone of zones) this.frameTypeChoice[zone.id] ??= '';
      this.error.set('');
    } catch {
      this.error.set('Could not reach the API. Is it running on port 3333?');
    }
  }

  protected async addProject(): Promise<void> {
    try {
      await firstValueFrom(this.http.post<Project>(`${API_BASE}/projects`, { name: this.projectName }));
      this.projectName = '';
      await this.refresh();
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Project was not saved.'));
    }
  }

  protected async addZone(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post<Zone>(`${API_BASE}/zones`, { name: this.zoneName, projectId: this.zoneProjectId }),
      );
      this.zoneName = '';
      await this.refresh();
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Zone was not saved. Choose a project and enter a name.'));
    }
  }

  protected async addFrame(zoneId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post<Frame>(`${API_BASE}/zones/${zoneId}/frames`, {
          type: this.frameTypeChoice[zoneId] ?? '',
          settings: {},
        }),
      );
      this.frameTypeChoice[zoneId] = '';
      await this.refresh();
    } catch (err) {
      this.error.set(apiErrorMessage(err, 'Frame was not saved. Choose a frame type.'));
    }
  }
}
