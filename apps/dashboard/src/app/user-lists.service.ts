import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { isErrorBody, type UserList, type UserListUploadReport } from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';

/** A call's result: its value, or the message to show with the error code (empty when unknown). */
export type UserListsResult<T> = { value: T; message: ''; code: '' } | { value: null; message: string; code: string };

function failure<T>(err: unknown, fallback: string): UserListsResult<T> {
  if (err instanceof HttpErrorResponse && isErrorBody(err.error)) {
    return { value: null, message: err.error.error.message, code: err.error.error.code };
  }
  return { value: null, message: fallback, code: '' };
}

const ok = <T>(value: T): UserListsResult<T> => ({ value, message: '', code: '' });

function listsUrl(projectId: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/user-lists`;
}

/**
 * The Management API's user list calls (epic targeting R3, R5). The dashboard sends a CSV as it is
 * and never reads IDs back: the API answers with counts only.
 */
@Injectable({ providedIn: 'root' })
export class UserListsService {
  private readonly http = inject(HttpClient);

  /** The project's user lists, by name. */
  async list(projectId: string): Promise<UserListsResult<UserList[]>> {
    try {
      return ok(await firstValueFrom(this.http.get<UserList[]>(listsUrl(projectId))));
    } catch (err) {
      return failure(err, 'Could not read the user lists. Reload the page to try again.');
    }
  }

  async create(projectId: string, name: string): Promise<UserListsResult<UserList>> {
    try {
      return ok(await firstValueFrom(this.http.post<UserList>(listsUrl(projectId), { name })));
    } catch (err) {
      return failure(err, 'The user list was not created. Try again.');
    }
  }

  async rename(projectId: string, userListId: string, name: string): Promise<UserListsResult<UserList>> {
    try {
      const url = `${listsUrl(projectId)}/${encodeURIComponent(userListId)}`;
      return ok(await firstValueFrom(this.http.patch<UserList>(url, { name })));
    } catch (err) {
      return failure(err, 'The user list was not renamed. Try again.');
    }
  }

  /** Deletes a list and every ID it holds, for good. */
  async remove(projectId: string, userListId: string): Promise<UserListsResult<true>> {
    try {
      await firstValueFrom(this.http.delete(`${listsUrl(projectId)}/${encodeURIComponent(userListId)}`));
      return ok(true as const);
    } catch (err) {
      return failure(err, 'The user list was not deleted. Try again.');
    }
  }

  /** Sends a CSV file to a list; the browser streams it, and the answer is the report. */
  async upload(
    projectId: string,
    userListId: string,
    file: Blob,
    header: boolean,
  ): Promise<UserListsResult<UserListUploadReport>> {
    try {
      const url = `${listsUrl(projectId)}/${encodeURIComponent(userListId)}/ids`;
      const report = await firstValueFrom(
        this.http.post<UserListUploadReport>(url, file, {
          params: header ? { header: 'true' } : {},
          headers: { 'Content-Type': 'text/csv' },
        }),
      );
      return ok(report);
    } catch (err) {
      return failure(err, 'The file was not uploaded. Check the connection and try again.');
    }
  }
}
