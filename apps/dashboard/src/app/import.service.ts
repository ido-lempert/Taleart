import { inject, Injectable, InjectionToken } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  isErrorBody,
  type ImportJob,
  type ImportJobSummary,
  type ImportPreview,
  type ImportSelection,
  type ImportStarted,
  type StorylyApp,
} from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';

/** How often the import page reads a job that is still queued or running, in ms. */
export const IMPORT_POLL_INTERVAL_MS = new InjectionToken<number>('IMPORT_POLL_INTERVAL_MS', {
  providedIn: 'root',
  factory: () => 2000,
});

/** A call's result: the value, or the message to show and the HTTP status (0 when no answer came). */
export type ImportResult<T> = { value: T; message: '' } | { value: null; message: string; status: number };

function failure<T>(err: unknown, fallback: string): ImportResult<T> {
  const message = err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error.message : fallback;
  return { value: null, message, status: err instanceof HttpErrorResponse ? err.status : 0 };
}

function importsUrl(projectId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/imports`;
}

/** The Management API's import calls (admins only). The token is sent, never kept. */
@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly http = inject(HttpClient);

  /** The apps a Storyly API token can read. */
  async findApps(projectId: string, token: string): Promise<ImportResult<StorylyApp[]>> {
    try {
      const apps = await firstValueFrom(this.http.post<StorylyApp[]>(`${importsUrl(projectId)}/storyly/apps`, { token }));
      return { value: apps, message: '' };
    } catch (err) {
      return failure(err, 'Could not read the apps for this token. Try again.');
    }
  }

  /** What an app holds: its zones with their counts, and the key a selection carries. */
  async preview(projectId: string, token: string, appId: string): Promise<ImportResult<ImportPreview>> {
    try {
      const preview = await firstValueFrom(
        this.http.post<ImportPreview>(`${importsUrl(projectId)}/storyly/preview`, { token, appId }),
      );
      return { value: preview, message: '' };
    } catch (err) {
      return failure(err, 'Could not read what this app holds. Try again.');
    }
  }

  /** Queues an import of one app into the project: what `selection` picks, or everything without it. */
  async start(
    projectId: string,
    token: string,
    appId: string,
    selection?: ImportSelection,
  ): Promise<ImportResult<ImportStarted>> {
    try {
      const body = selection ? { token, appId, selection } : { token, appId };
      const started = await firstValueFrom(this.http.post<ImportStarted>(importsUrl(projectId), body));
      return { value: started, message: '' };
    } catch (err) {
      return failure(err, 'The import did not start. Try again.');
    }
  }

  /** The project's imports, newest first, without their reports. */
  async list(projectId: string): Promise<ImportResult<ImportJobSummary[]>> {
    try {
      const jobs = await firstValueFrom(this.http.get<ImportJobSummary[]>(importsUrl(projectId)));
      return { value: jobs, message: '' };
    } catch (err) {
      return failure(err, 'Could not read the past imports. Reload the page to try again.');
    }
  }

  /** Reads an import job, its state, progress and report. */
  async job(projectId: string, importId: string): Promise<ImportResult<ImportJob>> {
    try {
      const job = await firstValueFrom(
        this.http.get<ImportJob>(`${importsUrl(projectId)}/${encodeURIComponent(importId)}`),
      );
      return { value: job, message: '' };
    } catch (err) {
      return failure(err, 'Could not read the import. Reload the page to try again.');
    }
  }
}
