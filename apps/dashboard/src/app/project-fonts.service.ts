import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { isErrorBody, type ProjectFont } from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';

/** A call's result: its value, or the message to show with the error code (empty when unknown). */
export type FontsResult<T> = { value: T; message: ''; code: '' } | { value: null; message: string; code: string };

/** The face an upload describes (epic Tale Studio R18). */
export interface FontFaceInput {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  fallback: string;
}

function failure<T>(err: unknown, fallback: string): FontsResult<T> {
  if (err instanceof HttpErrorResponse && isErrorBody(err.error)) {
    return { value: null, message: err.error.error.message, code: err.error.error.code };
  }
  return { value: null, message: fallback, code: '' };
}

function fontsUrl(projectId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/fonts`;
}

/** Where Tale Studio and the font list load a font's file, with the session. */
export function projectFontFileUrl(projectId: string, fontId: string): string {
  return `${fontsUrl(projectId)}/${encodeURIComponent(fontId)}/file`;
}

/** The Management API's project font calls (epic Tale Studio R18). */
@Injectable({ providedIn: 'root' })
export class ProjectFontsService {
  private readonly http = inject(HttpClient);

  /** The project's fonts, by family, weight and style. */
  async list(projectId: string): Promise<FontsResult<ProjectFont[]>> {
    try {
      return { value: await firstValueFrom(this.http.get<ProjectFont[]>(fontsUrl(projectId))), message: '', code: '' };
    } catch (err) {
      return failure(err, 'Could not read the project fonts. Reload the page to try again.');
    }
  }

  /**
   * Uploads a font file as one face, with the uploader's confirmation that they may use and
   * distribute it. The server judges the file by its bytes; the name and type do not count.
   */
  async upload(projectId: string, file: Blob, face: FontFaceInput): Promise<FontsResult<ProjectFont>> {
    const params = {
      family: face.family,
      weight: String(face.weight),
      style: face.style,
      fallback: face.fallback,
      licence: 'confirmed',
    };
    try {
      const font = await firstValueFrom(
        this.http.post<ProjectFont>(fontsUrl(projectId), file, {
          params,
          headers: { 'Content-Type': 'font/woff2' },
        }),
      );
      return { value: font, message: '', code: '' };
    } catch (err) {
      return failure(err, 'The font was not uploaded. Try again.');
    }
  }

  /** Deletes a font face; a font a tale uses is refused with a message naming the tale. */
  async remove(projectId: string, fontId: string): Promise<FontsResult<true>> {
    try {
      await firstValueFrom(this.http.delete(`${fontsUrl(projectId)}/${encodeURIComponent(fontId)}`));
      return { value: true, message: '', code: '' };
    } catch (err) {
      return failure(err, 'The font was not deleted. Try again.');
    }
  }
}
