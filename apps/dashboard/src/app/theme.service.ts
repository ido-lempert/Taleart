import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isErrorBody, type ProjectTheme } from '@taleart/contract/core';
import type { ThemeSettings } from '@taleart/contract/theme';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';

/** A call's result: the project's theme, or the message to show. */
export type ThemeResult = { value: ProjectTheme; message: '' } | { value: null; message: string };

function failure(err: unknown, fallback: string): ThemeResult {
  const message = err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
  return { value: null, message };
}

function themeUrl(projectId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/theme`;
}

/** The Management API's project theme calls (epic web zones R9). */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly http = inject(HttpClient);

  /** The project's theme: the fields it sets and the complete theme. */
  async load(projectId: string): Promise<ThemeResult> {
    try {
      return { value: await firstValueFrom(this.http.get<ProjectTheme>(themeUrl(projectId))), message: '' };
    } catch (err) {
      return failure(err, 'Could not read the theme. Reload the page to try again.');
    }
  }

  /** Replaces the project's theme; `{}` resets it to TaleArt's default. */
  async save(projectId: string, theme: ThemeSettings): Promise<ThemeResult> {
    try {
      return { value: await firstValueFrom(this.http.put<ProjectTheme>(themeUrl(projectId), theme)), message: '' };
    } catch (err) {
      return failure(err, 'The theme was not saved. Try again.');
    }
  }
}
