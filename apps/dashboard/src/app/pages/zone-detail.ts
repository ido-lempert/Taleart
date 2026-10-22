import { CdkDrag, CdkDragHandle, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  findPlaybook,
  groupShownStatus,
  isSwitchable,
  MAX_TALES_PER_GROUP,
  SHOWN_STATUS_LABELS,
  switchStatus,
  taleShownStatus,
  type ContentStatus,
  type SettableStatus,
  type Tale,
  type TaleGroup,
  type TaleGroupTag,
  type Zone,
} from '@taleart/contract/core';
import { AuthStore } from '../auth';
import { compareTags, DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { describeWindow } from '../schedule';
import { needsBadge, ShowSwitch, StatusBadge, statusActions, statusLabel, type StatusKind } from '../status';
import { visibilityLine, VisibilityIndicator } from '../visibility';
import { DuplicateTale, duplicatedMessage, type DuplicatedTale } from './duplicate-tale';

const TONES = 6;

/** Which way a move button moves its item. */
type Direction = 'earlier' | 'later';

/**
 * One zone: its playbook, its frames, its stages, its zone key and its tale groups, each a row of 9:16 tale cards with
 * the group's tags. A group can be placed in several zones (AD-14): its row says
 * where else it shows, and offers "Add to zone…", "Copy to zone…" and "Remove from this zone". Each group
 * has its On/Off switch and each tale card its Shown/Hidden switch (AD-6 amended, epic UX rework R6),
 * with Archive or Restore beside the group's; a status the switch does not say (scheduled, blocked
 * by group, archived) shows as a badge. Groups and tales reorder by drag, or by their move earlier
 * and later buttons (the single-pointer and keyboard alternative, WCAG 2.2 SC
 * 2.5.7). Tag chips above the groups filter them; groups do not reorder while
 * a filter is on, since the order covers every group of the zone.
 */
@Component({
  selector: 'app-zone-detail-page',
  imports: [
    RouterLink,
    Icon,
    StatusBadge,
    ShowSwitch,
    VisibilityIndicator,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    DuplicateTale,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './zone-detail.html',
  styles: `
    .group {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      min-width: 0;
      padding: var(--space-4) 0;
      border-top: 1px solid var(--border);
    }
    .group:first-child {
      padding-top: 0;
      border-top: 0;
    }
    .group__header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
    }
    /* The name keeps room to read; the actions move to their own line when they do not fit beside it. */
    .group__name {
      flex: 1 1 10rem;
      min-width: 0;
    }
    .group__name h4 {
      font-size: var(--text-md);
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .group__zones {
      margin: 0;
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
    .group__actions {
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      gap: var(--space-2);
      justify-content: flex-end;
    }
    .group__title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .groups {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .zone-section {
      min-width: 0;
    }
    .frame-list {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .frame-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .stage-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin: 0 0 var(--space-3);
      padding: 0;
      list-style: none;
    }
    .stage-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2) var(--space-4);
    }
    .stage-row__info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      min-width: 0;
    }
    .stage-row__name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .playbook-applied {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-1) var(--space-3);
      margin: 0 0 var(--space-2);
      overflow-wrap: anywhere;
    }
    .key-info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-4);
      margin: 0;
    }
    .key-info dt {
      font-weight: 600;
    }
    .key-info dd {
      margin: 0;
    }
    .zone-visibility {
      margin-top: var(--space-2);
    }
    .key-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    /* In the card's top row, left of the drag handle, above the card's open button, on a dark
       plate (story 8.11 moves it into a menu). */
    .tale-card__duplicate {
      position: absolute;
      z-index: 1;
      top: var(--space-2);
      right: calc(var(--space-2) + 26px);
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: var(--radius-pill);
      background: rgb(0 0 0 / 62%);
      color: #fff;
      cursor: pointer;
    }
    .tale-card__duplicate svg {
      width: 14px;
      height: 14px;
    }
    .tale-card__duplicate:hover {
      border-color: #fff;
    }
    .tale-card__duplicate:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 1px;
    }
  `,
})
export class ZoneDetailPage {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Bound from the `:zoneId` route parameter. */
  readonly zoneId = input.required<string>();

  protected readonly maxTales = MAX_TALES_PER_GROUP;
  protected readonly zone = computed(() => this.store.zone(this.zoneId()));
  protected readonly frames = computed(() => this.store.framesOf(this.zoneId()));
  /** The playbook applied to the zone (R8), when the registry still has it. */
  protected readonly appliedPlaybook = computed(() => findPlaybook(this.zone()?.playbookKey));
  /** The zone's stages, each showing one of its frames on a page (R7). */
  protected readonly stages = computed(() => this.store.stagesOf(this.zoneId()));
  protected readonly groups = computed(() => this.store.taleGroupsOf(this.zoneId()));
  /** The zone's active key (prefix and date only), or null. */
  protected readonly zoneKey = computed(() => this.store.zoneKey(this.zoneId()));

  /** The other zones a group is placed in, for its "Also in: …" line (AD-14). */
  protected otherZones(group: TaleGroup): Zone[] {
    return group.zoneIds.flatMap((id) => {
      const zone = id === this.zoneId() ? undefined : this.store.zone(id);
      return zone ? [zone] : [];
    });
  }

  /** A key's issue date, such as "20 Oct 2026". */
  protected issuedDate(createdAt: string): string {
    return new Date(createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Every tag on the zone's groups, once each, by name: the filter chips. */
  protected readonly zoneTags = computed(() => {
    const byId = new Map<string, TaleGroupTag>();
    for (const group of this.groups()) for (const tag of group.tags) byId.set(tag.id, tag);
    return [...byId.values()].sort(compareTags);
  });
  /**
   * The tag the groups are filtered by, '' for "All". Reset when the zone
   * changes or no group carries the tag any more, so it never comes back on its own.
   */
  protected readonly activeTag = linkedSignal<{ zoneId: string; tags: TaleGroupTag[] }, string>({
    source: () => ({ zoneId: this.zoneId(), tags: this.zoneTags() }),
    computation: (source, previous) =>
      previous && previous.source.zoneId === source.zoneId && source.tags.some((t) => t.id === previous.value)
        ? previous.value
        : '',
  });
  protected readonly filtering = computed(() => this.activeTag() !== '');
  /** The groups shown: all of them, or those carrying the active tag. */
  protected readonly visibleGroups = computed(() => {
    const tag = this.activeTag();
    return tag ? this.groups().filter((g) => g.tags.some((t) => t.id === tag)) : this.groups();
  });

  /** What the polite live region last announced; cleared when the zone changes. */
  protected readonly announcement = linkedSignal({ source: this.zoneId, computation: () => '' });
  /** The API's message when it refused an order; shown in a banner, cleared when the zone changes. */
  protected readonly orderError = linkedSignal({ source: this.zoneId, computation: () => '' });

  /** Per group id, the API's message when it refused a status change; cleared when the zone changes. */
  protected readonly statusErrors = linkedSignal<string, Record<string, string>>({
    source: this.zoneId,
    computation: () => ({}),
  });
  /** The ids of the groups and tales whose status change is being saved, so their controls wait for it. */
  protected readonly statusSaving = signal<ReadonlySet<string>>(new Set());
  protected readonly statusActions = statusActions;
  protected readonly needsBadge = needsBadge;
  protected readonly isSwitchable = isSwitchable;
  protected readonly describeWindow = describeWindow;

  /** "On" or "Off" for a group, "Shown" or "Hidden" for a tale, from its stored key (AD-6 amended). */
  protected shownLabel(stored: ContentStatus, kind: StatusKind): string {
    return SHOWN_STATUS_LABELS[kind === 'group' ? groupShownStatus(stored) : taleShownStatus(stored)];
  }

  /** Turns a group On (stores live) or Off (stores paused), then announces it. */
  protected async switchGroup(group: TaleGroup, on: boolean): Promise<void> {
    const status = switchStatus(group.storedStatus, on);
    if (status) await this.changeStatus(group, status);
  }

  /** Archives or restores a group, or sets what its switch asked for, then announces its new status. */
  protected async changeStatus(group: TaleGroup, status: SettableStatus): Promise<void> {
    const id = group.id;
    const message = await this.saving(group.id, id, () => this.store.setTaleGroupStatus(id, status));
    if (message) return;
    // The status as read after the refresh: turning on a group whose start is ahead makes it scheduled (AD-6).
    const saved = this.groups().find((g) => g.id === id);
    const read = saved?.status ?? status;
    // With what the indicator now says in this zone (R7), such as "Visible on site".
    this.announce(
      `${group.name} is now ${statusLabel(read, 'group').toLowerCase()}` +
        (saved?.visibility ? `. ${visibilityLine(saved.visibility, 'group')}` : ''),
    );
  }

  /** Shows (stores live) or hides (stores paused) a tale from its card, at once, then announces it. */
  protected async switchTale(group: TaleGroup, tale: Tale, on: boolean): Promise<void> {
    const status = switchStatus(tale.storedStatus, on);
    if (!status) return;
    let read: ContentStatus = status;
    let warning = '';
    const message = await this.saving(group.id, tale.id, async () => {
      const result = await this.store.setTaleStatus(tale.id, status);
      if (result.tale) read = result.tale.status;
      warning = result.warning;
      return result.message;
    });
    if (message) return;
    if (warning) this.statusErrors.update((errors) => ({ ...errors, [group.id]: warning }));
    // The warning is announced once, by the group's alert.
    const saved = this.groups()
      .find((g) => g.id === group.id)
      ?.tales.find((t) => t.id === tale.id);
    this.announce(
      `${tale.title} is now ${statusLabel(read, 'tale').toLowerCase()}` +
        (saved?.visibility ? `. ${visibilityLine(saved.visibility, 'tale')}` : ''),
    );
  }

  // Runs one status change for `savingId`, showing the API's message under the group `groupId`.
  private async saving(groupId: string, savingId: string, change: () => Promise<string>): Promise<string> {
    this.statusErrors.update((errors) => {
      const next = { ...errors };
      delete next[groupId];
      return next;
    });
    this.statusSaving.update((ids) => new Set(ids).add(savingId));
    const message = await change();
    this.statusSaving.update((ids) => {
      const next = new Set(ids);
      next.delete(savingId);
      return next;
    });
    if (message) this.statusErrors.update((errors) => ({ ...errors, [groupId]: message }));
    return message;
  }

  /** Shows only the groups carrying `tagId`, or every group for ''. */
  protected filterBy(tagId: string): void {
    this.activeTag.set(tagId);
    const total = this.groups().length;
    const tag = this.zoneTags().find((t) => t.id === tagId);
    this.announce(
      tag
        ? `Showing ${this.visibleGroups().length} of ${total} tale groups, tagged ${tag.name}`
        : `Showing all ${total} tale groups`,
    );
  }

  protected dropGroup(event: CdkDragDrop<unknown>): void {
    if (this.filtering() || event.previousIndex === event.currentIndex) return;
    this.moveGroup(event.previousIndex, event.currentIndex);
  }

  protected dropTale(group: TaleGroup, event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.moveTale(group, event.previousIndex, event.currentIndex);
  }

  protected stepGroup(index: number, direction: Direction): void {
    const group = this.groups()[index];
    if (!group) return;
    this.moveGroup(index, index + (direction === 'earlier' ? -1 : 1));
    this.refocus(`group:${group.id}`, direction);
  }

  protected stepTale(group: TaleGroup, index: number, direction: Direction): void {
    const tale = group.tales[index];
    if (!tale) return;
    this.moveTale(group, index, index + (direction === 'earlier' ? -1 : 1));
    this.refocus(`tale:${tale.id}`, direction);
  }

  private moveGroup(from: number, to: number): void {
    if (this.filtering()) return;
    const groups = this.groups();
    if (to < 0 || to >= groups.length) return;
    const ids = groups.map((g) => g.id);
    moveItemInArray(ids, from, to);
    this.announce(`${groups[from].name} moved to position ${to + 1} of ${ids.length}`);
    void this.save(this.store.orderTaleGroups(this.zoneId(), ids));
  }

  private moveTale(group: TaleGroup, from: number, to: number): void {
    if (to < 0 || to >= group.tales.length) return;
    const ids = group.tales.map((t) => t.id);
    moveItemInArray(ids, from, to);
    this.announce(`${group.tales[from].title} moved to position ${to + 1} of ${ids.length}`);
    void this.save(this.store.orderTales(this.zoneId(), group.id, ids));
  }

  private async save(request: Promise<string>): Promise<void> {
    this.orderError.set('');
    const message = await request;
    if (message) this.orderError.set(message);
  }

  /** The tale whose Duplicate drawer is open, with the button that opened it. */
  protected readonly duplicating = signal<{ tale: Tale; opener: HTMLElement | null } | null>(null);

  /** Opens the Duplicate drawer for a tale (epic Tale Studio R11). */
  protected openDuplicate(tale: Tale, event: Event): void {
    const opener = event.currentTarget;
    this.duplicating.set({ tale, opener: opener instanceof HTMLElement ? opener : null });
  }

  /** Closes the drawer and says where the copy went; the new card shows Hidden. */
  protected duplicated(result: DuplicatedTale): void {
    this.duplicating.set(null);
    this.announce(duplicatedMessage(result));
  }

  // A repeated message is changed by a trailing no-break space, so it is announced again.
  private announce(message: string): void {
    this.announcement.update((last) => (last === message ? `${message}\u00a0` : message));
  }

  // Moving an item re-inserts its element, which drops focus; put focus back on
  // the same button, or on the other one when the item reached an end.
  private refocus(item: string, direction: Direction): void {
    afterNextRender(
      () => {
        const other: Direction = direction === 'earlier' ? 'later' : 'earlier';
        for (const dir of [direction, other]) {
          const button = this.host.nativeElement.querySelector<HTMLButtonElement>(
            `[data-move="${item}:${dir}"]`,
          );
          if (button && !button.disabled) {
            button.focus();
            return;
          }
        }
      },
      { injector: this.injector },
    );
  }

  /** A stable placeholder tone for a tale, derived from its id. */
  protected tone(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % TONES;
  }
}
