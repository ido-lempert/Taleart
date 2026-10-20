import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

// The API base URL for local development.
export const API_BASE = 'http://localhost:3333/api';

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
  protected readonly error = signal('');

  protected projectName = '';
  protected zoneName = '';
  protected zoneProjectId = '';

  ngOnInit(): void {
    void this.refresh();
  }

  protected projectNameOf(projectId: string): string {
    return this.projects().find((p) => p.id === projectId)?.name ?? 'Unknown project';
  }

  protected async refresh(): Promise<void> {
    try {
      this.projects.set(await firstValueFrom(this.http.get<Project[]>(`${API_BASE}/projects`)));
      this.zones.set(await firstValueFrom(this.http.get<Zone[]>(`${API_BASE}/zones`)));
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
    } catch {
      this.error.set('Project was not saved.');
    }
  }

  protected async addZone(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post<Zone>(`${API_BASE}/zones`, { name: this.zoneName, projectId: this.zoneProjectId }),
      );
      this.zoneName = '';
      await this.refresh();
    } catch {
      this.error.set('Zone was not saved. Choose a project and enter a name.');
    }
  }
}
