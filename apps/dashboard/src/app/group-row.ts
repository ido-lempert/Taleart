import { ChangeDetectionStrategy, Component, computed, inject, input, output, ViewEncapsulation } from '@angular/core';
import {
  groupShownStatus,
  isSwitchable,
  MAX_TALES_PER_GROUP,
  SHOWN_STATUS_LABELS,
  taleShownStatus,
  type TaleGroup,
} from '@taleart/contract/core';
import { DashboardStore } from './dashboard.store';
import { MenuButton, type MenuItem, type MenuPick } from './menu-button';
import { describeWindow, windowChip } from './schedule';
import { needsBadge, ShowSwitch, StatusBadge } from './status';
import { VisibilityIndicator } from './visibility';

/**
 * A group as the row shows it: a zone's list carries its tales, the project's list its counts
 * (epic UX rework R14).
 */
export type GroupRowData = Omit<TaleGroup, 'tales'> &
  (Pick<TaleGroup, 'tales'> | { taleCount: number; shownTaleCount: number });

/** "3 of 4 shown": the group's tales that are Shown, of all its tales; "No tales yet" when it has none. */
export function shownCount(group: GroupRowData): string {
  const [shown, total] =
    'tales' in group
      ? [group.tales.filter((tale) => taleShownStatus(tale.storedStatus) === 'shown').length, group.tales.length]
      : [group.shownTaleCount, group.taleCount];
  return total === 0 ? 'No tales yet' : `${shown} of ${total} shown`;
}

/**
 * Whether a click on a row opens its group, as its name does: not when it was on one of the row's
 * own controls (switch, ⋯ and its menu, move buttons, handle, indicator, links) or ended a text
 * selection. Shared by the zone page and the Tale groups page (story 8.19).
 */
export function opensFromRowClick(event: MouseEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (
    !target ||
    target.closest(
      'button, a, input, select, label, [role=menu], .menu-button, .group-row__reorder, .status-badge, app-visibility',
    )
  ) {
    return false;
  }
  return (globalThis.getSelection?.()?.toString() ?? '') === '';
}

/**
 * One tale group as a list row (epic UX rework R10, R14), shared by the zone page and the Tale
 * groups page: cover, name, "3 of 4 shown", tags, the schedule chip when a window exists, the
 * On/Off switch (AD-6 amended), a badge for a status the switch does not say, the indicator (R7)
 * and a ⋯ menu whose items the page gives. What differs per page is projected:
 * - `[groupRowLead]`: a first grid cell, such as the zone page's reorder handle and move buttons;
 * - `[groupRowName]`: the name's heading, at the page's level, with its own open control or none;
 * - `[groupRowExtra]`: a line under the meta, such as the zones a group is in.
 *
 * Its styles are not encapsulated, so they also style what pages project into the row; every
 * selector starts with `.group-row`.
 */
@Component({
  selector: 'app-group-row',
  imports: [MenuButton, ShowSwitch, StatusBadge, VisibilityIndicator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './group-row.css',
  template: `
    @let g = group();
    <div class="group-row" [class.group-row--opens]="opens()" [class.group-row--plain]="plain()">
      <ng-content select="[groupRowLead]" />
      <span class="ring group-row__cover" [class.ring--cover]="!!g.cover" aria-hidden="true">
        @if (g.cover; as cover) {
          @if (cover.kind === 'video') {
            <video class="ring__cover" [src]="store.coverSrc(g) + '#t=0.001'" [muted]="true" playsinline preload="metadata"></video>
          } @else {
            <img class="ring__cover" [src]="store.coverSrc(g)" alt="" />
          }
        } @else {
          {{ g.name.charAt(0) }}
        }
      </span>
      <div class="group-row__main">
        <ng-content select="[groupRowName]" />
        <div class="group-row__meta">
          <span class="group-row__count">{{ count() }}<span class="group-row__max"> · max {{ maxTales }}</span></span>
          @if (g.tags.length > 0) {
            <ul class="pill-list group-row__tags" [attr.aria-label]="'Tags of ' + g.name">
              @for (tag of g.tags; track tag.id) {
                <li class="pill pill--tag">{{ tag.name }}</li>
              }
            </ul>
          }
          @if (chip(); as text) {
            <span class="window-chip" [title]="windowText()">
              <span class="visually-hidden">Schedule: </span>{{ text }}
            </span>
          }
        </div>
        <ng-content select="[groupRowExtra]" />
      </div>
      <div class="group-row__status">
        @if (switchable()) {
          <app-show-switch
            [on]="g.storedStatus === 'live'"
            [label]="g.name + ' on site'"
            [stateText]="stateText()"
            [disabled]="saving()"
            [reason]="switchReason()"
            (toggled)="toggled.emit($event)"
          />
        }
        @if (badge()) {
          <app-status-badge [status]="g.status" kind="group" />
        }
        <app-visibility class="group-row__visibility" [visibility]="g.visibility" viewing="group" [anyZone]="anyZone()" [targeting]="g" />
      </div>
      <app-menu-button class="group-row__menu" [label]="'More for ' + g.name" [items]="items()" (picked)="picked.emit($event)" />
    </div>
  `,
})
export class GroupRow {
  protected readonly store = inject(DashboardStore);
  protected readonly maxTales = MAX_TALES_PER_GROUP;

  readonly group = input.required<GroupRowData>();
  /** The ⋯ menu's items; an item that cannot apply carries its reason (story 8.3). */
  readonly items = input.required<readonly MenuItem[]>();
  /** True while the group's status change saves: the switch waits for it. */
  readonly saving = input(false);
  /** A click on the row opens the group (the zone page); only sets the pointer here, the page handles the click. */
  readonly opens = input(false);
  /** The row has no lead cell (the Tale groups page), so no first column is kept for one. */
  readonly plain = input(false);
  /** The indicator speaks of any zone the group is in (the Tale groups page), not of this zone. */
  readonly anyZone = input(false);

  /** The switch asked for On (true) or Off (false). */
  readonly toggled = output<boolean>();
  /** A ⋯ menu item was chosen. */
  readonly picked = output<MenuPick>();

  /** Why the switch is off limits for this caller: turning content on or off needs the Publisher role. */
  protected readonly switchReason = computed(() =>
    this.store.can('content.publish', this.group().projectId) ? '' : this.store.roleNeeded('content.publish'),
  );
  protected readonly count = computed(() => shownCount(this.group()));
  protected readonly switchable = computed(() => isSwitchable(this.group().storedStatus));
  protected readonly badge = computed(() => needsBadge(this.group().status));
  protected readonly stateText = computed(() => SHOWN_STATUS_LABELS[groupShownStatus(this.group().storedStatus)]);
  protected readonly chip = computed(() => windowChip(this.group()));
  protected readonly windowText = computed(() => describeWindow(this.group()));
}
