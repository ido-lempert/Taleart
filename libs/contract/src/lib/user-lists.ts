// User lists (epic targeting R3, R5): a project's lists of external user IDs, stored by the server
// only as keyed hashes. The limits, the name and ID rules, the one-row CSV reading the server and the
// dashboard share, and the email and phone heuristics of the dashboard's warning. No `import` of the
// generated values here, so a client bundles only what it uses.
import type { components } from '../generated/api';

type Schemas = components['schemas'];

/** A project's list of external user IDs: its name and how many IDs it holds, never which. */
export type UserList = Schemas['UserList'];
export type CreateUserListRequest = Schemas['CreateUserListRequest'];
export type RenameUserListRequest = Schemas['RenameUserListRequest'];
/** What an upload did, in counts and line numbers only; it never holds an uploaded value. */
export type UserListUploadReport = Schemas['UserListUploadReport'];
/** Why a row of a CSV was refused. */
export type UserListRefusal = Schemas['UserListRefusal'];
export type UserListRefusedRow = Schemas['UserListRefusedRow'];

/** The most user lists a project holds (owner decision, epic targeting R3). */
export const MAX_USER_LISTS_PER_PROJECT = 100;

/** The most characters a user list's name holds, after trimming (counted as code points). */
export const MAX_USER_LIST_NAME_LENGTH = 100;

/** The most rows (non-empty, the header row left out) one CSV upload holds. */
export const MAX_USER_LIST_CSV_ROWS = 1_000_000;

/** The largest CSV one upload takes: 50 MB. */
export const MAX_USER_LIST_CSV_BYTES = 50 * 1024 * 1024;

/** The most characters an external user ID holds, after trimming (counted as code points). */
export const MAX_EXTERNAL_USER_ID_LENGTH = 256;

/** How many refused rows an upload report names; the rest are only counted. */
export const MAX_REPORTED_REFUSED_ROWS = 10;

/** How much of a chosen file the dashboard reads to warn before it is sent. */
export const USER_LIST_CSV_SAMPLE_BYTES = 64 * 1024;

// C0 controls, DEL and C1 controls.
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function codePoints(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // A high surrogate followed by a low one is one code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/**
 * A user list's name as it is stored: trimmed. Null when it is blank, longer than
 * {@link MAX_USER_LIST_NAME_LENGTH} characters, or holds a control character.
 */
export function normalizeUserListName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || hasControl(name) || codePoints(name) > MAX_USER_LIST_NAME_LENGTH) return null;
  return name;
}

/** Why a trimmed, non-empty external user ID is refused, or null when it is accepted. */
export function externalUserIdRefusal(id: string): 'too-long' | 'control-character' | null {
  if (codePoints(id) > MAX_EXTERNAL_USER_ID_LENGTH) return 'too-long';
  if (hasControl(id)) return 'control-character';
  return null;
}

/**
 * An external user ID as it is hashed and matched: trimmed, exact otherwise (case included). Null
 * when it is not text, blank, or refused by {@link externalUserIdRefusal}.
 */
export function normalizeExternalUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && externalUserIdRefusal(id) === null ? id : null;
}

/** One row of a user list CSV, as read: an ID, a blank row, or a refusal with its reason. */
export type UserListCsvRow =
  | { kind: 'id'; id: string }
  | { kind: 'empty' }
  | { kind: 'refused'; reason: UserListRefusal };

const EMPTY: UserListCsvRow = { kind: 'empty' };
const NOT_ONE_COLUMN: UserListCsvRow = { kind: 'refused', reason: 'not-one-column' };

/**
 * Reads one line of a single-column CSV (its line break already removed). The line, trimmed, is one
 * field: plain, holding no comma or quote, or quoted, with `""` for a quote inside. The value is
 * trimmed again once unquoted, then checked as an external user ID.
 */
export function parseUserListCsvLine(line: string): UserListCsvRow {
  let value = line.trim();
  if (!value) return EMPTY;
  if (value.charCodeAt(0) === 0x22) {
    let unquoted = '';
    let at = 1;
    for (;;) {
      const quote = value.indexOf('"', at);
      if (quote < 0) return NOT_ONE_COLUMN;
      unquoted += value.slice(at, quote);
      if (value.charCodeAt(quote + 1) === 0x22) {
        unquoted += '"';
        at = quote + 2;
        continue;
      }
      // Anything after the closing quote is a second field.
      if (quote !== value.length - 1) return NOT_ONE_COLUMN;
      break;
    }
    value = unquoted.trim();
    if (!value) return EMPTY;
  } else if (value.includes(',') || value.includes('"')) {
    return NOT_ONE_COLUMN;
  }
  const reason = externalUserIdRefusal(value);
  return reason === null ? { kind: 'id', id: value } : { kind: 'refused', reason };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;

/** True when an ID looks like an email address. */
export function looksLikeEmail(id: string): boolean {
  return EMAIL.test(id);
}

/**
 * True when an ID looks like a phone number: 7 to 15 digits with a leading `+` or phone separators
 * (spaces, dots, dashes, brackets). A plain run of digits is not flagged: it is a common opaque ID.
 */
export function looksLikePhone(id: string): boolean {
  if (!/^\+?[\d\s().-]+$/.test(id)) return false;
  const digits = id.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15 && /^\+|[\s().-]/.test(id);
}

/** Counts of the accepted IDs of a file, for the warning. */
export interface ContactLikeCounts {
  /** IDs accepted (added or already present). */
  accepted: number;
  emailLike: number;
  phoneLike: number;
}

/**
 * What the dashboard warns about (owner decision: it warns, never refuses): `email` or `phone` when
 * more than half of the accepted IDs look like email addresses or phone numbers (together), named
 * by the more common of the two; null otherwise.
 */
export function contactLikeWarning(counts: ContactLikeCounts): 'email' | 'phone' | null {
  if (counts.accepted <= 0 || (counts.emailLike + counts.phoneLike) * 2 <= counts.accepted) return null;
  return counts.emailLike >= counts.phoneLike ? 'email' : 'phone';
}

/** The same counts as an upload report gives them, for a report. */
export function reportContactCounts(report: UserListUploadReport): ContactLikeCounts {
  return {
    accepted: report.added + report.alreadyPresent,
    emailLike: report.emailLike,
    phoneLike: report.phoneLike,
  };
}

/**
 * Reads the start of a CSV the dashboard holds (a sample of a file not yet sent) as the server will:
 * line by line, the header row left out when asked, the last line dropped when the sample was cut
 * short. Only counts come out, for {@link contactLikeWarning}.
 */
export function sampleUserListCsv(text: string, options: { header?: boolean; truncated?: boolean } = {}): ContactLikeCounts {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  if (options.truncated) lines.pop();
  const counts: ContactLikeCounts = { accepted: 0, emailLike: 0, phoneLike: 0 };
  let skipHeader = options.header === true;
  for (const line of lines) {
    const row = parseUserListCsvLine(line);
    if (row.kind === 'empty') continue;
    if (skipHeader) {
      skipHeader = false;
      continue;
    }
    if (row.kind !== 'id') continue;
    counts.accepted++;
    if (looksLikeEmail(row.id)) counts.emailLike++;
    else if (looksLikePhone(row.id)) counts.phoneLike++;
  }
  return counts;
}
