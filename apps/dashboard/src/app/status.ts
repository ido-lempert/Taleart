import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  groupShownStatus,
  nextStatuses,
  SHOWN_STATUS_LABELS,
  taleShownStatus,
  type ContentStatus,
  type SettableStatus,
} from '@taleart/contract/core';

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

/** What a status badge belongs to: a tale group says On or Off, a tale Shown or Hidden (AD-6 amended). */
export type StatusKind = 'group' | 'tale';

/**
 * The words for a status as read (AD-6 amended 2026-10-23, D3): `live`, `draft` and `paused` are
 * On or Off for a group and Shown or Hidden for a tale; the computed and process keys keep their
 * own words, such as "Scheduled" or "Blocked by group".
 */
export function statusLabel(status: ContentStatus, kind: StatusKind): string {
  if (status === 'live' || status === 'draft' || status === 'paused') {
    return SHOWN_STATUS_LABELS[kind === 'group' ? groupShownStatus(status) : taleShownStatus(status)];
  }
  return STATUS_LABELS[status] ?? status;
}

/**
 * True when a status as read says more than the On/Off or Shown/Hidden switch next to it: it is
 * not `live`, `draft` or `paused`, such as scheduled, expired, blocked by group or archived.
 */
export function needsBadge(status: ContentStatus): boolean {
  return status !== 'live' && status !== 'draft' && status !== 'paused';
}

/** One button that changes a stored status: its label and the status it sets. */
export interface StatusAction {
  label: string;
  status: SettableStatus;
}

/**
 * The buttons beside the switch for content stored as `stored`: Archive, or Restore (archived to
 * paused, so Off or Hidden). Turning on and off, showing and hiding are the switch's (AD-6 amended).
 */
export function statusActions(stored: ContentStatus): StatusAction[] {
  return nextStatuses(stored)
    .filter((status) => status === 'archived' || stored === 'archived')
    .map((status) => ({ status, label: status === 'archived' ? 'Archive' : 'Restore' }));
}

/** A status as a small badge, such as "Off" or "Blocked by group". */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'status-badge', '[attr.data-status]': 'status()' },
  template: `<span class="visually-hidden">Status: </span>{{ label() }}`,
})
export class StatusBadge {
  readonly status = input.required<ContentStatus>();
  readonly kind = input.required<StatusKind>();

  protected label(): string {
    return statusLabel(this.status(), this.kind());
  }
}

/**
 * The On/Off switch of a tale group or the Shown/Hidden switch of a tale (AD-6 amended, epic UX
 * rework R6, R18): a button with the switch role, named by `label`, exposing its state with
 * `aria-checked`; the visible state text beside it ("On", "Hidden") is not part of its name.
 */
@Component({
  selector: 'app-show-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'show-switch', '[class.show-switch--on]': 'on()' },
  template: `
    <button
      type="button"
      role="switch"
      class="show-switch__button"
      [attr.aria-checked]="on()"
      [attr.aria-label]="label()"
      [attr.aria-describedby]="describedBy() || null"
      [attr.aria-disabled]="disabled() || null"
      (click)="toggle()"
    >
      <span class="show-switch__thumb" aria-hidden="true"></span>
    </button>
    <span class="show-switch__state" aria-hidden="true">{{ stateText() }}</span>
  `,
})
export class ShowSwitch {
  readonly on = input.required<boolean>();
  /** The switch's accessible name, state-neutral, such as "Summer on site" or "Show A". */
  readonly label = input.required<string>();
  /** The visible state, such as "On" or "Hidden". */
  readonly stateText = input.required<string>();
  readonly disabled = input(false);
  readonly describedBy = input('');
  /** The state the person asked for. */
  readonly toggled = output<boolean>();

  // While a change is saved the switch stays focusable (aria-disabled, not disabled, so focus is
  // not lost) and ignores clicks.
  protected toggle(): void {
    if (!this.disabled()) this.toggled.emit(!this.on());
  }
}
