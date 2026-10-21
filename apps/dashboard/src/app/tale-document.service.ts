import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ErrorCodes,
  isErrorBody,
  type SaveTaleDocumentRequest,
  type TaleDocument,
  type TaleDocumentRevision,
} from '@taleart/contract';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';

/**
 * A call's result: the document and its revision, or why it failed: the API's message and code,
 * `stale` for a 409 (AD-15), and `pointer`, the refused field of a document ('' for none).
 */
export type TaleDocumentResult =
  | { value: TaleDocumentRevision; message: ''; stale: false; code: ''; pointer: '' }
  | { value: null; message: string; stale: boolean; code: string; pointer: string };

function failure(err: unknown, fallback: string): TaleDocumentResult {
  const body = err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error : null;
  return {
    value: null,
    message: body?.message ?? fallback,
    stale: body?.code === ErrorCodes.staleRevision,
    code: body?.code ?? '',
    pointer: body?.pointer ?? '',
  };
}

function documentUrl(taleId: string): string {
  return `${API_BASE}/tales/${encodeURIComponent(taleId)}/document`;
}

/** The Management API's tale document calls (AD-15). */
@Injectable({ providedIn: 'root' })
export class TaleDocumentService {
  private readonly http = inject(HttpClient);

  /** The tale's document and revision; `document` is null for a tale that shows its media only. */
  async load(taleId: string): Promise<TaleDocumentResult> {
    try {
      const value = await firstValueFrom(this.http.get<TaleDocumentRevision>(documentUrl(taleId)));
      return { value, message: '', stale: false, code: '', pointer: '' };
    } catch (err) {
      return failure(err, 'Could not read the tale. Reload the page to try again.');
    }
  }

  /** Saves the document over `revision`, the one it was based on; a newer save elsewhere makes it `stale`. */
  async save(taleId: string, document: TaleDocument, revision: number): Promise<TaleDocumentResult> {
    try {
      const body: SaveTaleDocumentRequest = { document, revision };
      const value = await firstValueFrom(this.http.put<TaleDocumentRevision>(documentUrl(taleId), body));
      return { value, message: '', stale: false, code: '', pointer: '' };
    } catch (err) {
      return failure(err, 'The tale was not saved. Try again.');
    }
  }
}
