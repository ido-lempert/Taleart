import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ErrorCodes, isErrorBody, type Tale } from '@taleart/contract/core';
import type {
  CopyTaleDocumentRequest,
  SaveTaleDocumentRequest,
  TaleDocument,
  TaleDocumentRevision,
  TaleDocumentRevisionsRequest,
} from '@taleart/contract/tale-document';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';

/** Why a call failed: the API's message and code, its HTTP status (0 when the network failed). */
export interface TaleDocumentFailure {
  value: null;
  message: string;
  /** A 409 `stale_revision`: another save came first (AD-15). */
  stale: boolean;
  code: string;
  /** The refused field of a document ('' for none). */
  pointer: string;
  status: number;
}

/** A call's result: the document and its revision, or why it failed. */
export type TaleDocumentResult =
  | { value: TaleDocumentRevision; message: ''; stale: false; code: ''; pointer: ''; status: 200 }
  | TaleDocumentFailure;

/** The result of keeping a document as a new tale: the new tale, or why it failed. */
export type TaleCopyResult = { value: Tale; message: ''; code: ''; status: 201 } | Omit<TaleDocumentFailure, 'stale'>;

function failure(err: unknown, fallback: string): TaleDocumentFailure {
  const body = err instanceof HttpErrorResponse && isErrorBody(err.error) ? err.error.error : null;
  return {
    value: null,
    message: body?.message ?? fallback,
    stale: body?.code === ErrorCodes.staleRevision,
    code: body?.code ?? '',
    pointer: body?.pointer ?? '',
    status: err instanceof HttpErrorResponse ? err.status : 0,
  };
}

function documentUrl(taleId: string): string {
  return `${API_BASE}/tales/${encodeURIComponent(taleId)}/document`;
}

/** The Management API's tale document calls (AD-15). */
@Injectable({ providedIn: 'root' })
export class TaleDocumentService {
  private readonly http = inject(HttpClient);
  /** Per tale, whether the document this editor last loaded held the tale's own media (R16). */
  private readonly sawTaleMedia = new Map<string, boolean>();

  /** The tale's document and revision; `document` is null for a tale that shows its media only. */
  async load(taleId: string): Promise<TaleDocumentResult> {
    try {
      const value = await firstValueFrom(this.http.get<TaleDocumentRevision>(documentUrl(taleId)));
      // Whether this editor saw the tale's own media as an element (R16), which its saves then say.
      this.sawTaleMedia.set(
        taleId,
        !!value.document?.elements.some((e) => (e.props as { taleMedia?: unknown }).taleMedia === true),
      );
      return { value, message: '', stale: false, code: '', pointer: '', status: 200 };
    } catch (err) {
      return failure(err, 'Could not read the tale. Reload the page to try again.');
    }
  }

  /** Saves the document over `revision`, the one it was based on; a newer save elsewhere makes it `stale`. */
  async save(taleId: string, document: TaleDocument, revision: number): Promise<TaleDocumentResult> {
    try {
      const body: SaveTaleDocumentRequest = {
        document,
        revision,
        sawTaleMedia: this.sawTaleMedia.get(taleId) ?? false,
      };
      const value = await firstValueFrom(this.http.put<TaleDocumentRevision>(documentUrl(taleId), body));
      return { value, message: '', stale: false, code: '', pointer: '', status: 200 };
    } catch (err) {
      return failure(err, 'The tale was not saved. Try again.');
    }
  }

  /**
   * Publishes the draft, based on its `revision` and the `publishedRevision` (compare-and-set on
   * both; a newer change elsewhere makes it `stale`). Visitors then see it once the tale is live.
   */
  publish(taleId: string, revision: number, publishedRevision: number): Promise<TaleDocumentResult> {
    return this.act(taleId, 'publish', revision, publishedRevision, 'The changes were not published. Try again.');
  }

  /** Discards the draft back to the published document, compare-and-set as {@link publish}. */
  discard(taleId: string, revision: number, publishedRevision: number): Promise<TaleDocumentResult> {
    return this.act(taleId, 'discard', revision, publishedRevision, 'The draft was not discarded. Try again.');
  }

  private async act(
    taleId: string,
    action: 'publish' | 'discard',
    revision: number,
    publishedRevision: number,
    fallback: string,
  ): Promise<TaleDocumentResult> {
    try {
      const body: TaleDocumentRevisionsRequest = { revision, publishedRevision };
      const value = await firstValueFrom(
        this.http.post<TaleDocumentRevision>(`${documentUrl(taleId)}/${action}`, body),
      );
      return { value, message: '', stale: false, code: '', pointer: '', status: 200 };
    } catch (err) {
      return failure(err, fallback);
    }
  }

  /** Keeps `document` as a new draft tale in the tale's group, for a save refused as stale (epic Tale Studio R9). */
  async keepAsNewTale(taleId: string, document: TaleDocument): Promise<TaleCopyResult> {
    try {
      const body: CopyTaleDocumentRequest = { document, sawTaleMedia: this.sawTaleMedia.get(taleId) ?? false };
      const value = await firstValueFrom(this.http.post<Tale>(`${documentUrl(taleId)}/copy`, body));
      return { value, message: '', code: '', status: 201 };
    } catch (err) {
      const { message, code, pointer, status } = failure(err, 'Your version was not kept as a new tale. Try again.');
      return { value: null, message, code, pointer, status };
    }
  }
}
