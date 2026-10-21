// Start and end times (AD-6) as the dashboard shows and edits them: in the
// browser's time zone, while the API stores and returns UTC.

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** An ISO 8601 UTC time as a `datetime-local` value in the browser's time zone, such as `2026-10-21T14:30`; '' for none. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * A `datetime-local` value, read in the browser's time zone, as ISO 8601 UTC;
 * null for an empty field, undefined when the value is not a time.
 */
export function fromLocalInput(value: string): string | null | undefined {
  const text = value.trim();
  if (!text) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return undefined;
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  return date.toISOString();
}

/** A time in the browser's time zone, such as "21 Oct 2026, 14:30". */
export function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A window in words, in the browser's time zone, such as "From 21 Oct 2026, 14:30 until …"; '' for no window. */
export function describeWindow(window: { startsAt: string | null; endsAt: string | null }): string {
  const { startsAt, endsAt } = window;
  if (startsAt && endsAt) return `From ${formatLocal(startsAt)} until ${formatLocal(endsAt)}`;
  if (startsAt) return `From ${formatLocal(startsAt)}`;
  if (endsAt) return `Until ${formatLocal(endsAt)}`;
  return '';
}

/** The browser's time zone, such as "Europe/Berlin", for the schedule form's hint. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
  } catch {
    return 'your time zone';
  }
}
