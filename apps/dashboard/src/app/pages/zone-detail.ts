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
import { MAX_TALES_PER_GROUP, type SettableStatus, type TaleGroup, type TaleGroupTag, type Zone } from '@taleart/contract';
import { AuthStore } from '../auth';
import { compareTags, DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { STATUS_LABELS, StatusBadge, statusActions } from '../status';

const TONES = 6;

/** Which way a move button moves its item. */
type Direction = 'earlier' | 'later';

/**
 * One zone: its frames, its zone key and its tale groups, each a row of 9:16 tale cards with
 * the group's tags. A group can be placed in several zones (AD-14): its row says
 * where else it shows, and offers "Add to zone…", "Copy to zone…" and "Remove from this zone". Each group
 * shows its status (AD-6) with the Publish, Pause, Archive or Restore buttons it
 * allows, and each tale card that is not live shows its status. Groups and tales reorder by drag, or by their move earlier
 * and later buttons (the single-pointer and keyboard alternative, WCAG 2.2 SC
 * 2.5.7). Tag chips above the groups filter them; groups do not reorder while
 * a filter is on, since the order covers every group of the zone.
 */
@Component({
  selector: 'app-zone-detail-page',
  imports: [RouterLink, Icon, StatusBadge, CdkDropList, CdkDrag, CdkDragHandle],
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
      align-items: center;
      gap: var(--space-3);
    }
    .group__name {
      flex: 1;
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
    .key-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
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
  /** The ids of the groups whose status change is being saved, so their buttons wait for it. */
  protected readonly statusSaving = signal<ReadonlySet<string>>(new Set());
  protected readonly statusActions = statusActions;

  /** Publishes, pauses, archives or restores a group, then announces its new status. */
  protected async changeStatus(group: TaleGroup, status: SettableStatus): Promise<void> {
    const id = group.id;
    this.statusErrors.update((errors) => {
      const next = { ...errors };
      delete next[id];
      return next;
    });
    this.statusSaving.update((ids) => new Set(ids).add(id));
    const message = await this.store.setTaleGroupStatus(id, status);
    this.statusSaving.update((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
    if (message) {
      this.statusErrors.update((errors) => ({ ...errors, [id]: message }));
      return;
    }
    this.announce(`${group.name} is now ${STATUS_LABELS[status].toLowerCase()}`);
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
