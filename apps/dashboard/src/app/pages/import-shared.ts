import type { ImportCount, ImportProgressCount, ImportStatus } from '@taleart/contract';

// What the Import from Storyly pages share: state labels and pills, counts and times.

const STATUS_LABELS: Record<ImportStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

/** A job state as people read it. */
export function importStatusLabel(status: ImportStatus): string {
  return STATUS_LABELS[status];
}

/** The pill classes of a job state: done, failed, or still active. */
export function importStatusClass(status: ImportStatus): string {
  return `pill ${status === 'done' ? 'pill--done' : status === 'failed' ? 'pill--failed' : 'pill--active'}`;
}

/** One report row's counts: "3 source / 3 imported", with the skipped ones when there are any. */
export function importCountText(count: ImportCount): string {
  const text = `${count.source} source / ${count.imported} imported`;
  return count.skipped > 0 ? `${text} / ${count.skipped} skipped` : text;
}

/** One progress row's counts: "6 read / 4 written". */
export function importProgressText(count: ImportProgressCount): string {
  return `${count.read} read / ${count.written} written`;
}

/** A job time in the viewer's locale, such as "21 Oct 2026, 10:05". */
export function importTimeText(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Pill colours of job states (story 14 tokens), for both import pages. */
export const IMPORT_PILL_STYLES = `
  .pill--done {
    background: #ecfdf3;
    color: #067647;
  }
  .pill--failed {
    background: var(--danger-tint);
    color: var(--danger-text);
  }
  .pill--active {
    background: var(--ember-tint);
    color: var(--ember-strong-hover);
  }
`;
