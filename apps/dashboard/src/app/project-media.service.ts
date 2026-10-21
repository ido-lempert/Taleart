import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isErrorBody, isMediaContentType, projectMediaFileUrl, type ProjectMedia } from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE, API_ORIGIN } from './dashboard.store';

/** A call's result: its value, or the message to show with the error code (empty when unknown). */
export type MediaResult<T> = { value: T; message: ''; code: '' } | { value: null; message: string; code: string };

function failure<T>(err: unknown, fallback: string): MediaResult<T> {
  if (err instanceof HttpErrorResponse && isErrorBody(err.error)) {
    return { value: null, message: err.error.error.message, code: err.error.error.code };
  }
  return { value: null, message: fallback, code: '' };
}

function mediaUrl(projectId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/media`;
}

/** Where Tale Studio loads a file of the project's media, with the session. */
export function projectMediaSrc(projectId: string, key: string): string {
  return `${API_ORIGIN}${projectMediaFileUrl(projectId, key)}`;
}

/** The Management API's project media calls (epic Tale Studio R5). */
@Injectable({ providedIn: 'root' })
export class ProjectMediaService {
  private readonly http = inject(HttpClient);

  /** The project's media: its uploads, newest first, then its tales' media and what documents use. */
  async list(projectId: string): Promise<MediaResult<ProjectMedia[]>> {
    try {
      const value = await firstValueFrom(this.http.get<ProjectMedia[]>(mediaUrl(projectId)));
      return { value, message: '', code: '' };
    } catch (err) {
      return failure(err, "Could not read the project's media. Try again.");
    }
  }

  /**
   * Uploads an image or a video to the project's media. The file's type is sent as declared; the
   * server checks its bytes against it, and refuses other types.
   */
  async upload(projectId: string, file: File): Promise<MediaResult<ProjectMedia>> {
    if (!isMediaContentType(file.type)) {
      return {
        value: null,
        message: 'Choose a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video.',
        code: 'unsupported_media_type',
      };
    }
    try {
      const media = await firstValueFrom(
        this.http.post<ProjectMedia>(mediaUrl(projectId), file, { headers: { 'Content-Type': file.type } }),
      );
      return { value: media, message: '', code: '' };
    } catch (err) {
      return failure(err, 'The file was not uploaded. Try again.');
    }
  }
}
