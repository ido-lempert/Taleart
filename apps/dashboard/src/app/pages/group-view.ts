import { CdkDrag, CdkDragHandle, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  ViewEncapsulation,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
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
  type Zone,
} from '@taleart/contract/core';
import { DashboardStore } from '../dashboard.store';
import { Drawer } from '../drawer';
import { Icon } from '../icon';
import { MenuButton, type MenuItem, type MenuPick } from '../menu-button';
import { gateMenu } from '../project-roles';
import { describeWindow, windowChip } from '../schedule';
import { needsBadge, ShowSwitch, StatusBadge, statusActions, statusLabel, type StatusKind } from '../status';
import { visibilityLine, VisibilityIndicator } from '../visibility';
import { DeleteTale, deletedMessage, type DeletedTale } from './delete-tale';
import { DuplicateTale, duplicatedMessage, type DuplicatedTale } from './duplicate-tale';

const TONES = 6;

/** Which way a move button moves its item. */
type Direction = 'earlier' | 'later';

/** "3 of 4 shown": the group's tales that are Shown, of all its tales; "No tales yet" for none. */
export function shownCount(group: TaleGroup): string {
  if (group.tales.length === 0) return 'No tales yet';
  const shown = group.tales.filter((tale) => taleShownStatus(tale.storedStatus) === 'shown').length;
  return `${shown} of ${group.tales.length} shown`;
}

/** "On" or "Off" for a group, "Shown" or "Hidden" for a tale, from its stored key (AD-6 amended). */
export function shownLabel(stored: ContentStatus, kind: StatusKind): string {
  return SHOWN_STATUS_LABELS[kind === 'group' ? groupShownStatus(stored) : taleShownStatus(stored)];
}

/**
 * A tale card's video: loads nothing (`preload="none"`) and plays only while on screen, paused
 * again when it leaves; without IntersectionObserver it stays still.
 */
@Directive({ selector: 'video[appPlayWhenVisible]' })
export class PlayWhenVisible implements OnDestroy {
  private readonly video = inject<ElementRef<HTMLVideoElement>>(ElementRef).nativeElement;
  private observer: IntersectionObserver | null = null;

  constructor() {
    afterNextRender(() => {
      const Observer = this.video.ownerDocument.defaultView?.IntersectionObserver;
      if (!Observer) return;
      this.observer = new Observer((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void this.video.play().catch(() => undefined);
          else this.video.pause();
        }
      });
      this.observer.observe(this.video);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}

/**
 * The group view (epic UX rework R11): one tale group of a zone, opened from its row. A wide modal
 * drawer on desktop and a whole page on phones (narrower than 640 px, the dashboard's phone breakpoint), labelled by the group's name. Its head
 * has the group's On/Off switch, indicator (R7), ⋯ menu (the row's), counts, schedule chip, tags and
 * the other zones it is in; its body the tale cards and "Add tale". Each card has a Shown/Hidden
 * switch that saves at once (one action, announced), the indicator dot, and a ⋯ menu: Edit in Tale
 * Studio, Replace media, Schedule, Duplicate, Archive (Restore when archived), Delete (asked first,
 * story 8.20). Tales reorder by
 * drag, or by their move earlier and later buttons (WCAG 2.2 SC 2.5.7), each move announced.
 *
 * The zone page owns the group's own status and menu (as on the row) and the live region's text;
 * this view announces through `announce`, rendered in its own live region, since a screen reader
 * may not read one outside a modal dialog. Loaded with the zone page only.
 *
 * While open it is modal for real: its element moves out of the page, beside the shell (as a
 * portal would), the shell becomes `inert`, and the page stops scrolling under it. The shell's own
 * drawers (tale, schedule, rename…) render beside the shell too, so they open above the view and
 * stay usable. On close it lifts that, then puts focus back (`returnFocus`).
 */
@Component({
  selector: 'app-group-view',
  imports: [
    RouterLink,
    Drawer,
    Icon,
    StatusBadge,
    ShowSwitch,
    VisibilityIndicator,
    MenuButton,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CdkScrollable,
    DuplicateTale,
    DeleteTale,
    PlayWhenVisible,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './group-view.html',
  styleUrl: './group-view.css',
  // It sizes the drawer it is in; its rules all start at app-group-view.
  encapsulation: ViewEncapsulation.None,
})
export class GroupView implements OnDestroy {
  protected readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly group = input.required<TaleGroup>();
  /**
   * The zone page it was opened from; '' on the Tale groups page (story 8.19), where the group is
   * read on its own, placed in a zone or not, and its tales are ordered through the group.
   */
  readonly zoneId = input.required<string>();
  /** The dialog's id, which the row's name button controls. */
  readonly panelId = input<string | null>(null);
  /** The other zones the group is in, for "Also in" (AD-14); on the Tale groups page, every zone it is in. */
  readonly otherZones = input<readonly Zone[]>([]);
  /** The group's ⋯ menu items, the same as on its row. */
  readonly menuItems = input<readonly MenuItem[]>([]);
  /** While the group's own status saves. */
  readonly groupSaving = input(false);
  /** The API's message when it refused the group's status change. */
  readonly groupError = input('');
  /** What the page's live region says; read out in this view's own live region. */
  readonly announcement = input('');
  /** A selector of the control to focus on open; the heading by default. */
  readonly initialFocus = input<string | null>(null);
  /** Where focus goes when the view closes: the row's name. */
  readonly returnFocus = input<HTMLElement | null | (() => HTMLElement | null)>(null);

  readonly closed = output<void>();
  /** The group's switch: true for On. */
  readonly switched = output<boolean>();
  /** An item of the group's ⋯ menu. */
  readonly menuPicked = output<MenuPick>();
  /** A message for the live region. */
  readonly announce = output<string>();

  /** What it made inert, and the root's overflow before, to restore on close. */
  private inerted: HTMLElement[] = [];
  private rootOverflow: string | null = null;

  constructor() {
    afterNextRender(() => {
      const host = this.host.nativeElement;
      const document = host.ownerDocument;
      const shell = document.querySelector<HTMLElement>('.shell');
      if (!shell) return;
      // Moving a node drops the focus inside it (the drawer may have focused its heading first).
      const active = document.activeElement as HTMLElement | null;
      shell.after(host);
      if (active && host.contains(active)) active.focus();
      this.inerted = [shell, document.querySelector<HTMLElement>('.skip-link')].filter(
        (el): el is HTMLElement => !!el && !el.hasAttribute('inert'),
      );
      for (const el of this.inerted) el.setAttribute('inert', '');
      this.rootOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    });
  }

  ngOnDestroy(): void {
    const host = this.host.nativeElement;
    const document = host.ownerDocument;
    // Moved out of the page, it is not removed with it (leaving the page with the view open, such
    // as for Tale Studio): remove it here. Angular's own removal of it is then a no-op.
    if (this.inerted.length > 0 || this.rootOverflow !== null) host.remove();
    for (const el of this.inerted) el.removeAttribute('inert');
    if (this.rootOverflow !== null) document.documentElement.style.overflow = this.rootOverflow;
    // After the page has updated (the row may be gone or moved), and only when focus was lost
    // with the view: a drawer still open above, or Undo after an archive, keeps it.
    const returnFocus = this.returnFocus();
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const target = typeof returnFocus === 'function' ? returnFocus() : returnFocus;
      if (target?.isConnected) target.focus();
      else document.getElementById('main')?.focus();
    });
  }

  protected readonly maxTales = MAX_TALES_PER_GROUP;
  protected readonly needsBadge = needsBadge;
  protected readonly isSwitchable = isSwitchable;
  protected readonly describeWindow = describeWindow;
  protected readonly windowChip = windowChip;
  protected readonly shownLabel = shownLabel;
  protected readonly shownCount = computed(() => shownCount(this.group()));

  /** The API's message for the last tale change that it refused, or a warning it gave. */
  protected readonly error = signal('');
  /** The ids of the tales whose status change is being saved, so their controls wait for it. */
  protected readonly saving = signal<ReadonlySet<string>>(new Set());
  /** The tale whose Duplicate drawer is open, with the button that opened it. */
  protected readonly duplicating = signal<{ tale: Tale; opener: HTMLElement | null } | null>(null);
  /**
   * The tale whose Delete confirmation is open, with the button that opened it and the tale whose
   * card takes focus once it is deleted (the next one, else the one before; none: Add tale).
   */
  protected readonly deleting = signal<{ tale: Tale; opener: HTMLElement | null; neighbor: string | null } | null>(null);
  /** Set once a delete is done: focus goes to the neighbouring card's ⋯ instead of the opener. */
  private deletedNeighbor: string | null | undefined = undefined;
  /** The control that opened the Delete confirmation, kept for when it closes. */
  private deleteOpener: HTMLElement | null = null;

  /** Where the Delete confirmation returns focus: its opener, or after a delete the neighbouring card. */
  protected readonly deleteFocus = (): HTMLElement | null => {
    const host = this.host.nativeElement;
    if (this.deletedNeighbor === undefined) return this.deleteOpener;
    const neighbor = this.deletedNeighbor;
    this.deletedNeighbor = undefined;
    return (
      (neighbor && host.querySelector<HTMLElement>(`[data-tale-id="${neighbor}"] .menu-button__trigger`)) ||
      host.querySelector<HTMLElement>('#group-view-add-tale')
    );
  };

  // Says to the store which group this view shows, so a deletion request for it is answered here.
  private readonly registers = effect((onCleanup) => {
    const groupId = this.group().id;
    untracked(() => this.store.groupViewOpened(groupId));
    onCleanup(() => this.store.groupViewClosed(groupId));
  });

  // "Delete tale…" in the tale drawer asks here, where the confirmation and the focus after it live.
  // A request for a tale this group no longer holds (deleted or gone meanwhile) is dropped.
  private readonly deletionRequests = effect(() => {
    const request = this.store.taleDeletionRequest();
    if (request === null || request.taleGroupId !== this.group().id) return;
    const tale = this.group().tales.find((t) => t.id === request.taleId);
    untracked(() => {
      this.store.taleDeletionRequest.set(null);
      if (!tale) return;
      const card = this.host.nativeElement.querySelector<HTMLElement>(`[data-tale-id="${tale.id}"] .tale-card__open`);
      this.askDelete(tale, card);
    });
  });

  /**
   * Each tale card's ⋯ menu, by tale id (epic UX rework R8, R11): one computed map, so an open
   * menu keeps its items across change detection. Archive is Restore for an archived tale.
   */
  /** True when the caller's role may change content (viewers see the group but not its controls). */
  protected readonly canEdit = computed(() => this.store.can('content.edit', this.group().projectId));
  /** Why the On/Off and Shown/Hidden switches are off limits for this caller; '' when they may use them. */
  protected readonly publishReason = computed(() =>
    this.store.can('content.publish', this.group().projectId) ? '' : this.store.roleNeeded('content.publish'),
  );

  protected readonly taleMenus = computed(() => {
    const menus = new Map<string, readonly MenuItem[]>();
    const saving = this.saving();
    for (const tale of this.group().tales) {
      const status = statusActions(tale.storedStatus)[0];
      const statusItem: MenuItem | null = status
        ? saving.has(tale.id)
          ? { id: `status:${status.status}`, label: status.label, disabledReason: 'Saving…' }
          : { id: `status:${status.status}`, label: status.label }
        : null;
      menus.set(
        tale.id,
        gateMenu(
          [
            { id: 'studio', label: this.canEdit() ? 'Edit in Tale Studio' : 'Open in Tale Studio' },
            { id: 'media', label: 'Replace media' },
            { id: 'schedule', label: 'Schedule' },
            { id: 'duplicate', label: 'Duplicate' },
            ...(statusItem ? [statusItem] : []),
            { id: 'delete', label: 'Delete' },
          ],
          (permission) => this.store.can(permission, this.group().projectId),
          (permission) => this.store.roleNeeded(permission),
        ),
      );
    }
    return menus;
  });

  /** A tale card's chip: one bound, short; the tale drawer shows the whole window. */
  protected cardChip(tale: Tale): string {
    return windowChip(tale, new Date(), 'short');
  }

  /** Does what a tale's ⋯ menu item says; a drawer it opens returns focus to the menu's button. */
  protected talePicked(tale: Tale, pick: MenuPick): void {
    switch (pick.id) {
      case 'studio':
        // The studio's back link returns here: the zone page, or the Tale groups page (story 8.19).
        void this.router.navigate(['/tales', tale.id, 'studio'], {
          queryParams: this.zoneId() ? { zone: this.zoneId() } : { from: 'tale-groups' },
        });
        return;
      case 'media':
        return this.store.openDrawer({ kind: 'taleMedia', taleId: tale.id, focus: 'media' }, pick.opener);
      case 'schedule':
        return this.store.openDrawer({ kind: 'schedule', target: 'tale', id: tale.id }, pick.opener);
      case 'duplicate':
        this.duplicating.set({ tale, opener: pick.opener });
        return;
      case 'delete':
        this.askDelete(tale, pick.opener);
        return;
      default: {
        const action = statusActions(tale.storedStatus).find((a) => `status:${a.status}` === pick.id);
        if (action) void this.setStatus(tale, action.status);
      }
    }
  }

  /** Shows (stores live) or hides (stores paused) a tale from its card, at once (R6, R11). */
  protected async switchTale(tale: Tale, on: boolean): Promise<void> {
    const status = switchStatus(tale.storedStatus, on);
    if (status) await this.setStatus(tale, status);
  }

  /** Saves a tale's status, then announces it with what its indicator now says. */
  private async setStatus(tale: Tale, status: SettableStatus): Promise<void> {
    if (this.saving().has(tale.id)) return;
    this.error.set('');
    this.saving.update((ids) => new Set(ids).add(tale.id));
    const result = await this.store.setTaleStatus(tale.id, status);
    this.saving.update((ids) => {
      const next = new Set(ids);
      next.delete(tale.id);
      return next;
    });
    // Each message names its tale, as the view shows many.
    if (result.message) {
      this.error.set(`${tale.title}: ${result.message}`);
      return;
    }
    // The warning is announced once, by the view's alert.
    if (result.warning) this.error.set(`${tale.title}: ${result.warning}`);
    const read = result.tale?.status ?? status;
    const saved = this.group().tales.find((t) => t.id === tale.id);
    this.announce.emit(
      `${tale.title} is now ${statusLabel(read, 'tale').toLowerCase()}` +
        (saved?.visibility ? `. ${visibilityLine(saved.visibility, 'tale')}` : ''),
    );
  }

  protected dropTale(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.moveTale(event.previousIndex, event.currentIndex);
  }

  protected stepTale(index: number, direction: Direction): void {
    const tale = this.group().tales[index];
    if (!tale) return;
    this.moveTale(index, index + (direction === 'earlier' ? -1 : 1));
    this.refocus(`tale:${tale.id}`, direction);
  }

  private moveTale(from: number, to: number): void {
    const group = this.group();
    if (to < 0 || to >= group.tales.length) return;
    const ids = group.tales.map((t) => t.id);
    moveItemInArray(ids, from, to);
    this.announce.emit(`${group.tales[from].title} moved to position ${to + 1} of ${ids.length}`);
    this.error.set('');
    void this.store.orderTales(group.id, ids).then((message) => {
      if (message) this.error.set(message);
    });
  }

  /** Opens the Delete confirmation for a tale. */
  private askDelete(tale: Tale, opener: HTMLElement | null): void {
    const tales = this.group().tales;
    const at = tales.findIndex((t) => t.id === tale.id);
    const neighbor = tales[at + 1]?.id ?? tales[at - 1]?.id ?? null;
    this.deletedNeighbor = undefined;
    this.deleteOpener = opener;
    this.deleting.set({ tale, opener, neighbor });
  }

  /** Closes the Delete confirmation, says what was deleted and what the group now holds, and moves focus on. */
  protected deletedTale(result: DeletedTale): void {
    this.deletedNeighbor = this.deleting()?.neighbor ?? null;
    this.deleting.set(null);
    this.announce.emit(`${deletedMessage(result)} ${shownCount(this.group())}.`);
  }

  /** Closes the Duplicate drawer and says where the copy went; the new card shows Hidden. */
  protected duplicated(result: DuplicatedTale): void {
    this.duplicating.set(null);
    this.announce.emit(duplicatedMessage(result));
  }

  // Moving an item re-inserts its element, which drops focus; put focus back on
  // the same button, or on the other one when the item reached an end.
  private refocus(item: string, direction: Direction): void {
    afterNextRender(
      () => {
        const other: Direction = direction === 'earlier' ? 'later' : 'earlier';
        for (const dir of [direction, other]) {
          const button = this.host.nativeElement.querySelector<HTMLButtonElement>(`[data-move="${item}:${dir}"]`);
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
