import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  switchStatus,
  type ContentStatus,
  type ProjectTaleGroup,
  type SettableStatus,
  type Zone,
} from '@taleart/contract/core';
import { DashboardStore, type TaleGroupSummary } from '../dashboard.store';
import { GroupRow, opensFromRowClick } from '../group-row';
import { GroupView } from './group-view';
import { Icon } from '../icon';
import type { MenuItem, MenuPick } from '../menu-button';
import { statusActions, statusLabel } from '../status';
import { visibilityLine } from '../visibility';

/** The filters of the Tale groups page (epic UX rework R14), as `?filter=` holds them; `all` is the default. */
export type TaleGroupFilter = 'all' | 'visible' | 'off' | 'scheduled' | 'unplaced' | 'archived';

/** The filters in the order the page offers them, with their labels. */
export const TALE_GROUP_FILTERS: readonly { id: TaleGroupFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'visible', label: 'Visible' },
  { id: 'off', label: 'Off' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'unplaced', label: 'Not in a zone' },
  { id: 'archived', label: 'Archived' },
];

/** The query parameter of the open group view, and the history state marking an entry this page pushed. */
const GROUP_PARAM = 'group';
const GROUP_STATE = 'taleartGroupView';

/** The filter a `?filter=` value names; anything else is All. */
export function taleGroupFilter(value: string | null | undefined): TaleGroupFilter {
  return TALE_GROUP_FILTERS.find((f) => f.id === value)?.id ?? 'all';
}

/**
 * Whether a group belongs under a filter (epic UX rework R14). An archived group shows only under
 * Archived. The others overlap where the states do:
 * - All: every group that is not archived.
 * - Visible: visible on site in at least one zone, by the Delivery rule (R7).
 * - Off: stored `draft` or `paused` (the switch says Off).
 * - Scheduled: has a start or an end time, whether or not it is open now.
 * - Not in a zone: placed in no zone.
 * So Scheduled overlaps Visible, Off and Not in a zone, and Not in a zone overlaps Off; Visible never
 * overlaps Off or Not in a zone. A group that is On but not visible (no shown tale, a zone not set
 * up, a window not open, a status a process set) shows under All, and under Scheduled when it has a window.
 */
export function inTaleGroupFilter(
  group: Pick<ProjectTaleGroup, 'storedStatus' | 'startsAt' | 'endsAt' | 'zoneIds' | 'visibility'>,
  filter: TaleGroupFilter,
): boolean {
  const archived = group.storedStatus === 'archived';
  if (filter === 'archived') return archived;
  if (archived) return false;
  switch (filter) {
    case 'visible':
      return group.visibility.visible;
    case 'off':
      return group.storedStatus === 'draft' || group.storedStatus === 'paused';
    case 'scheduled':
      return group.startsAt !== null || group.endsAt !== null;
    case 'unplaced':
      return group.zoneIds.length === 0;
    default:
      return true;
  }
}

/**
 * The one filter named when a group leaves the list: Archived, else Visible, else Off, else All
 * (the first that lists it, most specific first).
 */
export function homeFilter(group: Parameters<typeof inTaleGroupFilter>[0]): TaleGroupFilter {
  return (['archived', 'visible', 'off'] as const).find((filter) => inTaleGroupFilter(group, filter)) ?? 'all';
}

/**
 * The selected project's tale groups by name (epic UX rework R14), placed in zones or not: a group
 * belongs to the project, not to a zone (AD-14). Each is the zone page's row (`GroupRow`) with the
 * zones it is in, and a ⋯ menu without "Remove from this zone". A radio group filters them, with a
 * count per filter, kept in the URL (`?filter=visible`). "New tale group" opens the create drawer
 * with a zone picker that also offers "Not in a zone". A group's name (or a click on its row) opens
 * the group view here (`?group=<id>`, story 8.19), for every group, placed in a zone or not: Add tale,
 * Shown/Hidden, reorder and the tale ⋯ menu work on the group read with its tales, in any zone.
 */
@Component({
  selector: 'app-tale-groups-page',
  imports: [RouterLink, Icon, GroupRow, GroupView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .tale-groups__header {
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .group-filter {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .group-filter legend {
      float: left;
      width: 100%;
      margin-bottom: var(--space-1);
      padding: 0;
      font-size: var(--text-sm);
      color: var(--text-secondary);
    }
    .group-filter__option {
      position: relative;
      gap: var(--space-2);
    }
    .group-filter__option input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: pointer;
    }
    .group-filter__option:has(input:checked) {
      border-color: var(--ink);
      background: var(--ink);
      color: #fff;
    }
    .group-filter__option:has(input:focus-visible) {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .group-filter__count {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .group-items {
      container: group-list / inline-size;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .group-item {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      min-width: 0;
      padding: var(--space-3) 0;
      border-top: 1px solid var(--border);
    }
    .group-item:first-child {
      border-top: 0;
    }
    .undo-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      margin-bottom: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: var(--surface-sunken);
    }
    .group-opening {
      margin: 0 0 var(--space-3);
    }
  `,
  template: `
    <div class="page">
      <!-- While the group view is open, its own live region says it: one outside a modal dialog may go unread. -->
      <p class="visually-hidden" aria-live="polite" aria-atomic="true">{{ openedGroup() ? '' : announcement() }}</p>
      @if (openedGroup(); as open) {
        <app-group-view
          [group]="open"
          zoneId=""
          [panelId]="'group-view-' + open.id"
          [otherZones]="zonesOf(open)"
          [menuItems]="menus().get(open.id) ?? []"
          [groupSaving]="saving().has(open.id)"
          [groupError]="errors()[open.id] ?? ''"
          [announcement]="announcement()"
          [returnFocus]="groupViewReturn()"
          (switched)="switchGroup(open, $event)"
          (menuPicked)="picked(open, $event)"
          (announce)="announce($event)"
          (closed)="closeGroup()"
        />
      }
      @if (store.loaded()) {
        @if (store.selectedProject(); as project) {
          <section class="card section" aria-labelledby="tale-groups-title">
            <div class="section__header tale-groups__header">
              <h2 class="section__title" id="tale-groups-title" tabindex="-1">Tale groups in {{ project.name }}</h2>
              <button type="button" class="btn btn--primary btn--sm" id="new-project-tale-group" (click)="newGroup($event)">
                <app-icon name="plus" /> New tale group
              </button>
            </div>
            <!-- Opening a group reads it with its tales (story 8.19): while it is read, and when it cannot be. -->
            @if (opening(); as open) {
              @if (open.state === 'loading') {
                <p class="muted group-opening" role="status">Opening {{ open.name }}…</p>
              } @else {
                <div class="banner banner--inline group-opening" role="alert">
                  <app-icon name="alert" />
                  <span>{{ open.message }}</span>
                  @if (open.state === 'error') {
                    <button type="button" class="btn btn--secondary btn--sm" (click)="store.retryTaleGroup(open.id)">Try again</button>
                  }
                </div>
              }
            }
            @if (undo(); as last) {
              <div class="undo-bar">
                <span>{{ last.name }} archived.</span>
                <button type="button" class="btn btn--secondary btn--sm" id="undo-archive" [disabled]="undoing()" (click)="undoArchive()">
                  Undo
                </button>
              </div>
            }
            @if (allGroups().length > 0) {
              <fieldset class="group-filter">
                <legend>Show</legend>
                @for (option of filters; track option.id) {
                  <label class="chip group-filter__option" [attr.data-filter]="option.id">
                    <input
                      type="radio"
                      name="tale-group-filter"
                      [value]="option.id"
                      [checked]="selected() === option.id"
                      (change)="choose(option.id)"
                    />
                    {{ option.label }}
                    <span class="group-filter__count"><span class="visually-hidden">, </span>{{ counts()[option.id] }}</span>
                  </label>
                }
              </fieldset>
              @if (groups().length > 0) {
                <ul class="group-items" [attr.aria-label]="listLabel()">
                  @for (group of groups(); track group.id) {
                    <li class="group-item">
                      <!--
                        A click on the row outside its controls opens the group, as its name does (R10). It
                        is a pointer shortcut only: the name's button is the keyboard and screen reader way.
                      -->
                      <app-group-row
                        [group]="group"
                        [items]="menus().get(group.id) ?? []"
                        [saving]="saving().has(group.id)"
                        [anyZone]="true"
                        [plain]="true"
                        [opens]="true"
                        (toggled)="switchGroup(group, $event)"
                        (picked)="picked(group, $event)"
                        (click)="rowClick(group, $event)"
                      >
                        <!-- Opens the group view here, placed in a zone or not (story 8.19). -->
                        <h3 class="group-row__name" groupRowName [id]="'project-group-' + group.id">
                          <button
                            type="button"
                            class="group-row__open"
                            [id]="'group-name-' + group.id"
                            aria-haspopup="dialog"
                            [attr.aria-expanded]="openedGroup()?.id === group.id"
                            [attr.aria-busy]="opening()?.id === group.id && opening()?.state === 'loading' ? 'true' : null"
                            [attr.aria-controls]="openedGroup()?.id === group.id ? 'group-view-' + group.id : null"
                            (click)="openGroup(group)"
                          >
                            {{ group.name }}
                          </button>
                        </h3>
                        <p class="group-row__zones muted" groupRowExtra>
                          @if (zonesOf(group); as zones) {
                            @if (zones.length > 0) {
                              In:
                              @for (zone of zones; track zone.id; let last = $last) {
                                <a [routerLink]="['/zones', zone.id]">{{ zone.name }}</a>@if (!last) {<span>, </span>}
                              }
                            } @else {
                              Not in a zone
                            }
                          }
                        </p>
                      </app-group-row>
                      <!-- While its view is open, the view shows the message. -->
                      @if (openedGroup()?.id === group.id ? '' : errors()[group.id]; as message) {
                        <div class="banner banner--inline" role="alert">
                          <app-icon name="alert" />
                          <span>{{ message }}</span>
                        </div>
                      }
                    </li>
                  }
                </ul>
              } @else {
                <div class="empty">
                  <p class="empty__title">No tale groups match this filter</p>
                  <p class="empty__text">{{ emptyText() }}</p>
                  <button type="button" class="btn btn--secondary btn--sm" (click)="choose('all', true)">Show all tale groups</button>
                </div>
              }
            } @else {
              <div class="empty">
                <span class="empty__icon"><app-icon name="tales" /></span>
                <p class="empty__title">No tale groups yet</p>
                <p class="empty__text">
                  A tale group is a set of tales shown together. Create one here or in a zone; it then shows here, with every
                  zone it is in.
                </p>
              </div>
            }
          </section>
        } @else if (!store.apiDown()) {
          <section class="card empty" aria-labelledby="empty-projects">
            <span class="empty__icon"><app-icon name="projects" /></span>
            <h2 class="empty__title" id="empty-projects">No projects yet</h2>
            <p class="empty__text">Tale groups belong to a project. Create or join a project first.</p>
          </section>
        }
      }
    </div>
  `,
})
export class TaleGroupsPage {
  protected readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /**
   * `?filter=` (component input binding): a reload or a shared link opens on that filter. Choosing a
   * filter replaces the history entry, so back and forward do not step through filters.
   */
  readonly filter = input<string | undefined>();
  /**
   * `?group=` (component input binding): the group whose view is open (story 8.19), placed in a
   * zone or not; a reload or a shared link opens it, the browser's Back closes it.
   */
  readonly group = input<string | undefined>();

  /** The group whose view is open: follows the URL, and changes at once on a click, before the URL has caught up. */
  protected readonly openGroupId = linkedSignal<string | null>(() => this.group() ?? null);
  /**
   * The open group with its tales, as the store read it on its own (`GET /tale-groups/{id}`), so
   * the view is the same for a group in no zone and one placed in several; null until read.
   */
  protected readonly openedGroup = computed(() => {
    const id = this.openGroupId();
    return id ? (this.store.readGroups()[id] ?? null) : null;
  });
  /**
   * The group being opened while it has no answer to show: being read, or why it cannot be (a
   * failure, with Try again; gone, kept as a notice after `?group=` is dropped).
   */
  protected readonly opening = computed(() => {
    const id = this.openGroupId() ?? this.goneId();
    if (!id || this.openedGroup()) return null;
    const state = this.goneId() === id ? 'gone' : this.store.groupReads()[id];
    if (!state) return null;
    const name = this.allGroups().find((group) => group.id === id)?.name ?? 'The tale group';
    const message =
      state === 'gone'
        ? `${name} could not be opened: it no longer exists, or you no longer have access to it.`
        : state === 'error'
          ? `${name} could not be opened. Check the connection and try again.`
          : '';
    return { id, name, state, message };
  });
  /** The group whose read answered gone, kept for its notice once `?group=` is dropped. */
  private readonly goneId = signal<string | null>(null);

  /** The group archived last, with its status before, for Undo; cleared when the project changes. */
  protected readonly undo = linkedSignal<string, { id: string; name: string; before: ContentStatus } | null>({
    source: () => this.store.selectedProjectId(),
    computation: () => null,
  });
  protected readonly undoing = signal(false);

  protected readonly filters = TALE_GROUP_FILTERS;
  /** The chosen filter: follows the URL, and changes at once on a choice, before the URL catches up. */
  protected readonly selected = linkedSignal(() => taleGroupFilter(this.filter()));

  protected readonly allGroups = computed(() => this.store.projectTaleGroupsOf(this.store.selectedProjectId()));
  protected readonly groups = computed(() => {
    const filter = this.selected();
    return this.allGroups().filter((group) => inTaleGroupFilter(group, filter));
  });
  /** How many groups each filter lists. */
  protected readonly counts = computed(() => {
    const groups = this.allGroups();
    return Object.fromEntries(
      TALE_GROUP_FILTERS.map(({ id }) => [id, groups.filter((group) => inTaleGroupFilter(group, id)).length]),
    ) as Record<TaleGroupFilter, number>;
  });
  protected readonly listLabel = computed(() => {
    const project = this.store.selectedProject()?.name ?? '';
    const filter = this.selected();
    return filter === 'all'
      ? `Tale groups in ${project}`
      : `Tale groups in ${project}: ${TALE_GROUP_FILTERS.find((f) => f.id === filter)?.label}`;
  });
  protected readonly emptyText = computed(() => {
    switch (this.selected()) {
      case 'visible':
        return 'No tale group is visible on your site. Turn one On in a zone that is set up.';
      case 'off':
        return 'Every tale group is On or archived.';
      case 'scheduled':
        return 'No tale group has a start or end time.';
      case 'unplaced':
        return 'Every tale group is shown in at least one zone.';
      case 'archived':
        return 'No tale group is archived.';
      default:
        return 'Every tale group of this project is archived.';
    }
  });

  /** What the polite live region last announced. */
  protected readonly announcement = signal('');
  /** Per group id, the API's message when it refused a status change. */
  protected readonly errors = signal<Record<string, string>>({});
  /** The groups whose status change is being saved. */
  protected readonly saving = signal<ReadonlySet<string>>(new Set());

  /** Each group's ⋯ menu, by id: the zone page's items, without "Remove from this zone". */
  protected readonly menus = computed(() => {
    const menus = new Map<string, readonly MenuItem[]>();
    const saving = this.saving();
    const projectZoneIds = this.store.projectZones().map((zone) => zone.id);
    for (const group of this.allGroups()) {
      const status = statusActions(group.storedStatus)[0];
      const statusItem: MenuItem | null = status
        ? saving.has(group.id)
          ? { id: `status:${status.status}`, label: status.label, disabledReason: 'Saving…' }
          : { id: `status:${status.status}`, label: status.label }
        : null;
      const placeReason =
        group.storedStatus === 'archived'
          ? 'Archived. Restore it to show it in a zone'
          : projectZoneIds.length === 0
            ? 'This project has no zones yet'
            : projectZoneIds.every((id) => group.zoneIds.includes(id))
              ? 'Already in every zone'
              : '';
      menus.set(group.id, [
        { id: 'rename', label: 'Rename' },
        { id: 'cover', label: 'Cover' },
        { id: 'tags', label: 'Audience' },
        { id: 'schedule', label: 'Schedule' },
        placeReason
          ? { id: 'place', label: 'Show in another zone', disabledReason: placeReason }
          : { id: 'place', label: 'Show in another zone' },
        { id: 'copy', label: 'Copy to zone' },
        ...(statusItem ? [statusItem] : []),
      ]);
    }
    return menus;
  });

  /** True from "New tale group" until its drawer closes, to reveal the group it created. */
  private creating = false;

  constructor() {
    // This page lists the selected project's groups: read that list (only it, epic UX rework R14).
    effect(() => {
      const projectId = this.store.selectedProjectId();
      untracked(() => this.store.ensureProjectTaleGroups(projectId));
    });
    // The open group is read with its tales, once the store is loaded, and forgotten once its view
    // closes (story 8.19).
    effect((onCleanup) => {
      const id = this.openGroupId();
      if (!id || !this.store.loaded()) return;
      untracked(() => {
        this.goneId.set(null);
        this.store.ensureTaleGroup(id);
      });
      onCleanup(() => this.store.releaseTaleGroup(id));
    });
    // A group whose read answers gone (403 or 404): `?group=` is dropped in place, and the page says why.
    effect(() => {
      const id = this.openGroupId();
      if (!id || this.store.groupReads()[id] !== 'gone') return;
      untracked(() => {
        this.goneId.set(id);
        this.dropGroupParam();
      });
    });
    // A `?group=` naming no group of the selected project (a stale link, another project) is dropped, in place.
    effect(() => {
      const id = this.group();
      const projectId = this.store.selectedProjectId();
      if (id === undefined || !this.store.loaded() || this.store.apiDown()) return;
      if (!(projectId in this.store.projectTaleGroups())) return;
      if (!this.allGroups().some((group) => group.id === id)) untracked(() => this.dropGroupParam());
    });
    // A `?filter=` naming All or nothing known is dropped from the URL, in place.
    effect(() => {
      const raw = this.filter();
      if (raw !== undefined && taleGroupFilter(raw) === 'all') untracked(() => this.writeUrl('all'));
    });
    // Once the create drawer closes: a group the current filter hides brings All back, so it shows.
    effect(() => {
      if (this.store.drawer() !== null) return;
      untracked(() => {
        if (!this.creating) return;
        this.creating = false;
        const id = this.store.createdTaleGroupId();
        const created = id ? this.allGroups().find((group) => group.id === id) : undefined;
        if (!created) return;
        if (!inTaleGroupFilter(created, this.selected())) {
          this.selected.set('all');
          this.writeUrl('all');
          this.announce(`${created.name} created. Showing all tale groups.`);
        } else {
          this.announce(`${created.name} created`);
        }
      });
    });
  }

  /** The zones a group is placed in, in the order it was placed. */
  protected zonesOf(group: TaleGroupSummary): Zone[] {
    return group.zoneIds.flatMap((id) => {
      const zone = this.store.zone(id);
      return zone ? [zone] : [];
    });
  }

  /**
   * Shows the groups under `filter` and keeps it in the URL, replacing the entry. Nothing is
   * announced: the radio a person moved to reads its own count.
   */
  protected choose(filter: TaleGroupFilter, focus = false): void {
    this.selected.set(filter);
    this.writeUrl(filter);
    if (focus) this.focusFilter(filter);
  }

  protected newGroup(event: Event): void {
    const projectId = this.store.selectedProjectId();
    this.creating = true;
    this.store.createdTaleGroupId.set(null);
    this.store.openDrawer({ kind: 'taleGroup', zoneId: '', projectId }, event);
  }

  /**
   * Opens a group's view (its name's button, a row click): a history entry marked as ours, so
   * closing it goes back in history, as Back does (as on the zone page, epic UX rework R11).
   */
  protected openGroup(group: TaleGroupSummary): void {
    this.announcement.set('');
    this.goneId.set(null);
    this.openGroupId.set(group.id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [GROUP_PARAM]: group.id },
      queryParamsHandling: 'merge',
      state: { [GROUP_STATE]: group.id },
    });
  }

  /**
   * Closes the group view, which then puts focus back on the group's name. When this page opened
   * it, it goes back in history; a deep link or a reload drops `?group=` in place.
   */
  protected closeGroup(): void {
    const id = this.openGroupId();
    this.openGroupId.set(null);
    this.announcement.set('');
    const state = this.location.getState() as Record<string, unknown> | null;
    if (id && state?.[GROUP_STATE] === id && this.group() === id) {
      this.location.back();
      return;
    }
    this.dropGroupParam();
  }

  // Closes the view without a history step: `?group=` leaves the URL in place.
  private dropGroupParam(): void {
    this.openGroupId.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [GROUP_PARAM]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** A click on the row opens the group, as its name does, unless it was on one of the row's own controls. */
  protected rowClick(group: ProjectTaleGroup, event: MouseEvent): void {
    if (opensFromRowClick(event)) this.openGroup(group);
  }

  /**
   * Where focus goes when the group view closes: the group's name in its row, found at that moment
   * (also after a deep link); without the row (the filter no longer lists it), the list's heading.
   */
  protected readonly groupViewReturn = computed(() => {
    const id = this.openedGroup()?.id;
    return (): HTMLElement | null => {
      const root = this.host.nativeElement;
      return (
        (id ? root.querySelector<HTMLElement>(`[id="group-name-${id}"]`) : null) ??
        root.querySelector<HTMLElement>('#tale-groups-title')
      );
    };
  });

  /** Does what a ⋯ item says; a drawer it opens returns focus to the menu's button. */
  protected picked(group: TaleGroupSummary, pick: MenuPick): void {
    const taleGroupId = group.id;
    switch (pick.id) {
      case 'rename':
        return this.store.openDrawer({ kind: 'renameTaleGroup', taleGroupId }, pick.opener);
      case 'cover':
        return this.store.openDrawer({ kind: 'cover', taleGroupId }, pick.opener);
      case 'tags':
        return this.store.openDrawer({ kind: 'tags', taleGroupId }, pick.opener);
      case 'schedule':
        return this.store.openDrawer({ kind: 'schedule', target: 'taleGroup', id: taleGroupId }, pick.opener);
      case 'place':
        return this.store.openDrawer({ kind: 'placeTaleGroup', taleGroupId }, pick.opener);
      case 'copy':
        return this.store.openDrawer({ kind: 'copyTaleGroup', taleGroupId }, pick.opener);
      default: {
        const action = statusActions(group.storedStatus).find((a) => `status:${a.status}` === pick.id);
        if (action) void this.changeStatus(group, action.status);
      }
    }
  }

  /** Turns a group On (stores live) or Off (stores paused). */
  protected async switchGroup(group: TaleGroupSummary, on: boolean): Promise<void> {
    const status = switchStatus(group.storedStatus, on);
    if (status) await this.changeStatus(group, status);
  }

  /**
   * Sets a group's status and announces it from the API's answer, with what the indicator now says.
   * When the group leaves the list (archived, restored, or no longer under the filter), the
   * announcement says which filter lists it, and focus goes to the row that took its place (its
   * switch, else its ⋯), else the row before it, else the list's heading. Archive offers Undo above
   * the list, as the zone page does; archived from its view, the view closes and focus goes to Undo.
   */
  private async changeStatus(group: TaleGroupSummary, status: SettableStatus): Promise<void> {
    const before = group.storedStatus;
    const id = group.id;
    const index = this.groups().findIndex((g) => g.id === id);
    this.errors.update((errors) => {
      const next = { ...errors };
      delete next[id];
      return next;
    });
    this.saving.update((ids) => new Set(ids).add(id));
    const { message, group: saved } = await this.store.changeTaleGroupStatus(id, status);
    this.saving.update((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
    if (message || !saved) {
      this.errors.update((errors) => ({ ...errors, [id]: message }));
      return;
    }
    const read: ContentStatus = saved.status;
    let text =
      `${group.name} is now ${statusLabel(read, 'group').toLowerCase()}. ` + visibilityLine(saved.visibility, 'group');
    const now = { ...group, status: saved.status, storedStatus: saved.storedStatus, visibility: saved.visibility };
    const fromView = this.openedGroup()?.id === id;
    const archived = status === 'archived';
    if (archived) this.undo.set({ id, name: group.name, before });
    if (!inTaleGroupFilter(now, this.selected())) {
      text += `. It is listed under ${TALE_GROUP_FILTERS.find((f) => f.id === homeFilter(now))?.label}.`;
      // From its view, the view stays open and keeps focus (unless archived, below).
      if (!fromView) this.focusAfterLeaving(index);
    }
    if (archived) {
      text += `${text.endsWith('.') ? '' : '.'} Undo is above the list.`;
      if (fromView) {
        this.closeGroup();
        afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('#undo-archive')?.focus(), {
          injector: this.injector,
        });
      }
    }
    this.announce(text);
  }

  /** Restores the group archived last: back to Off, then On again when it was On (as on the zone page). */
  protected async undoArchive(): Promise<void> {
    const last = this.undo();
    if (!last || this.undoing()) return;
    this.undoing.set(true);
    let result = await this.store.changeTaleGroupStatus(last.id, 'paused');
    if (!result.message && last.before === 'live') result = await this.store.changeTaleGroupStatus(last.id, 'live');
    this.undoing.set(false);
    if (result.message || !result.group) {
      this.errors.update((errors) => ({ ...errors, [last.id]: result.message }));
      return;
    }
    this.undo.set(null);
    const saved = result.group;
    let text = `${last.name} restored, ${statusLabel(saved.status, 'group').toLowerCase()}. ${visibilityLine(saved.visibility, 'group')}`;
    const listed = this.allGroups().find((g) => g.id === last.id);
    if (listed && !inTaleGroupFilter({ ...listed, ...saved }, this.selected())) {
      text += `. It is listed under ${TALE_GROUP_FILTERS.find((f) => f.id === homeFilter({ ...listed, ...saved }))?.label}.`;
    }
    this.announce(text);
    // The Undo button is gone: focus goes to the group's ⋯ when the list shows it, else the heading.
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        const target =
          root.querySelector<HTMLElement>(`[id="group-name-${last.id}"]`)?.closest('li')?.querySelector<HTMLElement>('.menu-button__trigger') ??
          root.querySelector<HTMLElement>('#tale-groups-title');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  // Focus for a row that left the list: the row now at its place, else the one before, else the heading.
  private focusAfterLeaving(index: number): void {
    afterNextRender(
      () => {
        const root = this.host.nativeElement;
        const rows = [...root.querySelectorAll<HTMLElement>('.group-items > li')];
        const row = rows[index] ?? rows[index - 1];
        const target =
          row?.querySelector<HTMLElement>('[role=switch]') ??
          row?.querySelector<HTMLElement>('.menu-button__trigger') ??
          root.querySelector<HTMLElement>('#tale-groups-title');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  private focusFilter(filter: TaleGroupFilter): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLInputElement>(`[data-filter="${filter}"] input`)?.focus(),
      { injector: this.injector },
    );
  }

  private writeUrl(filter: TaleGroupFilter): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { filter: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // A repeated message is changed by a trailing no-break space, so it is announced again.
  protected announce(message: string): void {
    this.announcement.update((last) => (last === message ? `${message}\u00a0` : message));
  }
}
