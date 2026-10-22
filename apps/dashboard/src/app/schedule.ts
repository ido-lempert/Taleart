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

/** A `datetime-local` value read as UTC: the ISO time (null for an empty field), or why it is refused. */
export type LocalInputResult = { iso: string | null } | { error: 'invalid' | 'nonexistent' };

/**
 * A `datetime-local` value, read in the browser's time zone, as ISO 8601 UTC.
 * A time the clocks skip at a daylight-saving change (the spring-forward gap)
 * is refused as `nonexistent` instead of shifting silently. A time that
 * happens twice (fall back) is read as its first occurrence, as the browser
 * does `[ASSUMPTION]`.
 */
export function parseLocalInput(value: string): LocalInputResult {
  const text = value.trim();
  if (!text) return { iso: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(text);
  if (!match) return { error: 'invalid' };
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  if (month < 1 || month > 12 || day < 1 || hours > 23 || minutes > 59 || seconds > 59) return { error: 'invalid' };
  // The calendar day must exist (no 30 February), whatever the time zone.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return { error: 'invalid' };
  const date = new Date(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(date.getTime())) return { error: 'invalid' };
  // A skipped local time comes back as another local time.
  const same =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hours &&
    date.getMinutes() === minutes &&
    date.getSeconds() === seconds;
  return same ? { iso: date.toISOString() } : { error: 'nonexistent' };
}

/**
 * A `datetime-local` value, read in the browser's time zone, as ISO 8601 UTC;
 * null for an empty field, undefined when it is not a time that exists there.
 */
export function fromLocalInput(value: string): string | null | undefined {
  const result = parseLocalInput(value);
  return 'iso' in result ? result.iso : undefined;
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

/**
 * A time in a few characters, in the browser's locale and time zone, for a schedule chip: the day
 * and month ("1 Dec"), the year only when it is not this year, and the time only when it is not
 * midnight ("1 Dec 09:00").
 */
export function formatShort(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  if (date.getHours() !== 0 || date.getMinutes() !== 0) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return date.toLocaleString(undefined, options);
}

/**
 * A window on a schedule chip, such as "Starts 1 Dec 09:00", "Ends 3 Nov" or
 * "1 Dec 09:00 – 3 Nov"; '' for no window, which shows no chip (epic UX rework R8).
 */
export function windowChip(
  window: { startsAt: string | null; endsAt: string | null },
  now: Date = new Date(),
): string {
  const { startsAt, endsAt } = window;
  if (startsAt && endsAt) return `${formatShort(startsAt, now)} – ${formatShort(endsAt, now)}`;
  if (startsAt) return `Starts ${formatShort(startsAt, now)}`;
  if (endsAt) return `Ends ${formatShort(endsAt, now)}`;
  return '';
}
