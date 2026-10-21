import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { nextStatuses, type ContentStatus, type SettableStatus } from '@taleart/contract/core';

/** What the dashboard calls each status key (AD-6). */
export const STATUS_LABELS: Readonly<Record<ContentStatus, string>> = {
  draft: 'Draft',
  live: 'Live',
  scheduled: 'Scheduled',
  processing: 'Processing',
  'invalid-media': 'Invalid media',
  paused: 'Paused',
  'blocked-by-group': 'Blocked by group',
  expired: 'Expired',
  'quota-reached': 'Quota reached',
  archived: 'Archived',
};

/** One button that changes a stored status: its label and the status it sets. */
export interface StatusAction {
  label: string;
  status: SettableStatus;
}

/**
 * The buttons content stored as `stored` offers, in a fixed order: Publish
 * (to live), Pause (live to paused), Restore (archived to paused), Archive.
 */
export function statusActions(stored: ContentStatus): StatusAction[] {
  return nextStatuses(stored).map((status) => ({
    status,
    label: status === 'live' ? 'Publish' : status === 'archived' ? 'Archive' : stored === 'archived' ? 'Restore' : 'Pause',
  }));
}

/** A status key as a small badge, such as "Draft" or "Blocked by group". */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'status-badge', '[attr.data-status]': 'status()' },
  template: `<span class="visually-hidden">Status: </span>{{ label() }}`,
})
export class StatusBadge {
  readonly status = input.required<ContentStatus>();

  protected label(): string {
    return STATUS_LABELS[this.status()] ?? this.status();
  }
}
