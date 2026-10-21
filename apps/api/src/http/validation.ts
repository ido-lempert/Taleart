import {
  ErrorCodes,
  isSettableStatus,
  isValidWindow,
  SETTABLE_STATUSES,
  type SetScheduleRequest,
  type SettableStatus,
} from '@taleart/contract';
import { HttpError } from './errors';

/** Reads a required, non-blank string field from a JSON body. */
export function requiredString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new HttpError(400, ErrorCodes.validationFailed, `${field} is required`);
  }
  return text;
}

/** Reads the `status` of a status change: `live`, `paused` or `archived` (AD-6). */
export function requiredSettableStatus(body: unknown): SettableStatus {
  const value = (body as Record<string, unknown> | undefined)?.['status'];
  if (!isSettableStatus(value)) {
    throw new HttpError(400, ErrorCodes.validationFailed, `status must be one of ${SETTABLE_STATUSES.join(', ')}`);
  }
  return value;
}

// An ISO 8601 date-time with a time zone (`Z` or an offset), so the instant is never ambiguous.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/i;

// True when the date part names a real day: Date.parse rolls 2030-02-30 over to March.
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function scheduleBound(body: unknown, field: 'startsAt' | 'endsAt'): string | null {
  if (typeof body !== 'object' || body === null || !(field in body)) {
    throw new HttpError(400, ErrorCodes.validationFailed, `${field} is required (null for none)`);
  }
  const value = (body as Record<string, unknown>)[field];
  if (value === null) return null;
  const at = typeof value === 'string' && ISO_DATE_TIME.test(value) && isCalendarDate(value) ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(at)) {
    throw new HttpError(
      400,
      ErrorCodes.validationFailed,
      `${field} must be an ISO 8601 date-time with a time zone, or null`,
    );
  }
  return new Date(at).toISOString();
}

/**
 * Reads the start and end time of a schedule change (AD-6): each an ISO 8601
 * date-time with a time zone, returned in UTC, or null; the end must be
 * later than the start.
 */
export function requiredSchedule(body: unknown): SetScheduleRequest {
  const schedule = { startsAt: scheduleBound(body, 'startsAt'), endsAt: scheduleBound(body, 'endsAt') };
  if (!isValidWindow(schedule)) {
    throw new HttpError(400, ErrorCodes.validationFailed, 'The end time must be later than the start time');
  }
  return schedule;
}

/** Reads a required array of strings from a JSON body, such as the ids of an order request. */
export function requiredStringArray(body: unknown, field: string): string[] {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (!Array.isArray(value)) {
    throw new HttpError(400, ErrorCodes.validationFailed, `${field} must be an array of ids`);
  }
  if (!value.every((item): item is string => typeof item === 'string')) {
    throw new HttpError(400, ErrorCodes.validationFailed, `Every item of ${field} must be a string`);
  }
  return value;
}
