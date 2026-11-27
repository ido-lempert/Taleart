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
  isTargeted,
  switchStatus,
  type ContentStatus,
  type ProjectTaleGroup,
  type SettableStatus,
  type Tale,
  type Zone,
} from '@taleart/contract/core';
import { BulkBar } from '../bulk-bar';
import { runLimited } from '../bulk-run';
import { DashboardStore, type TaleGroupSummary } from '../dashboard.store';
import { Drawer } from '../drawer';
import { GroupRow, opensFromRowClick } from '../group-row';
import { createSelection } from '../selection';
import { GroupView } from './group-view';
import { ZonePreview } from './zone-preview';
import { Icon } from '../icon';
import type { MenuItem, MenuPick } from '../menu-button';
import { gateMenu } from '../project-roles';
import { statusActions, statusLabel } from '../status';
import { TaleThumbnails } from '../tale-thumbnail';
import { visibilityLine } from '../visibility';

/** The filters of the Tale groups page (epic UX rework R14), as `?filter=` holds them; `all` is the default. */
export type TaleGroupFilter = 'all' | 'visible' | 'off' | 'scheduled' | 'targeted' | 'unplaced' | 'archived';

/** The filters in the order the page offers them, with their labels. */
export const TALE_GROUP_FILTERS: readonly { id: TaleGroupFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'visible', label: 'Visible' },
  { id: 'off', label: 'Off' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'targeted', label: 'Targeted' },
  { id: 'unplaced', label: 'Not in a zone' },
  { id: 'archived', label: 'Archived' },
];

/** The query parameter of the open group view, and the history state marking an entry this page pushed. */
const GROUP_PARAM = 'group';
const GROUP_STATE = 'taleartGroupView';

/** The bulk actions of the list: archive, and the two a row's ⋯ menu has as single actions. */
type BulkKind = 'archive' | 'place' | 'copy';

/** A group a bulk action names: its id and name, the zones it is in, and its stored status (for place). */
type BulkItem = Pick<TaleGroupSummary, 'id' | 'name' | 'zoneIds' | 'storedStatus'>;

/** What a bulk action that failed for some groups says they could not do; the failure names them. */
const BULK_FAILED_ACTION: Record<BulkKind, string> = {
  archive: 'archived',
  place: 'added to the zone',
  copy: 'copied',
};

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
 * - Targeted: has an audience (epic targeting R7): targeting tags or user lists, so only some viewers see it.
 * - Not in a zone: placed in no zone.
 * So Scheduled overlaps Visible, Off and Not in a zone, Not in a zone overlaps Off, and Targeted
 * overlaps every filter but Archived; Visible never overlaps Off or Not in a zone. A group that is
 * On but not visible (no shown tale, a zone not set up, a window not open, a status a process set)
 * shows under All, and under Scheduled when it has a window.
 */
export function inTaleGroupFilter(
  group: Pick<ProjectTaleGroup, 'storedStatus' | 'startsAt' | 'endsAt' | 'zoneIds' | 'visibility' | 'tags' | 'tagMatch' | 'audience'>,
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
    case 'targeted':
      return isTargeted(group);
    case 'unplaced':
      return group.zoneIds.length === 0;
    default:
      return true;
  }
}

/**
 * Whether a group is in the chosen zones (the zone filter, multi-select): with none chosen every group
 * is; otherwise one of its zones must be chosen. A zone the page does not know is never chosen.
 */
export function inChosenZones(group: Pick<ProjectTaleGroup, 'zoneIds'>, zoneIds: readonly string[]): boolean {
  return zoneIds.length === 0 || group.zoneIds.some((id) => zoneIds.includes(id));
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
  imports: [RouterLink, Icon, GroupRow, GroupView, ZonePreview, BulkBar, Drawer],
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
    .zone-filter {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-3);
    }
    .zone-filter__active {
      font-size: var(--text-sm);
      color: var(--text-secondary);
    }
    .zone-filter__list {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      margin: 0 0 var(--space-4);
      padding: var(--space-3);
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
    }
    .zone-filter__list[hidden] {
      display: none;
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
    .tale-groups-list__head {
      display: flex;
      margin: 0 0 var(--space-2);
    }
    /* The row's first cell: the checkbox takes the reorder cell of a row with a lead (group-row.css). */
    .group-row__select {
      grid-area: reorder;
      min-height: 0;
      padding: 0;
    }
    .bulk-names {
      margin: var(--space-2) 0 0;
      padding-inline-start: var(--space-5);
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
      @if (preview(); as p) {
        <app-zone-preview
          [zone]="p.zone"
          [groups]="store.taleGroupsOf(p.zone.id)"
          [groupId]="p.groupId"
          [label]="p.label"
          [returnFocus]="p.opener"
          (closed)="closePreview()"
        />
      }
      @if (store.loaded()) {
        @if (store.selectedProject(); as project) {
          <section class="card section" aria-labelledby="tale-groups-title">
            <div class="section__header tale-groups__header">
              <h2 class="section__title" id="tale-groups-title" tabindex="-1">Tale groups in {{ project.name }}</h2>
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
              @if (store.projectZones().length > 0) {
                <div class="zone-filter">
                  <button
                    type="button"
                    class="btn btn--secondary btn--sm"
                    id="zone-filter-toggle"
                    aria-controls="zone-filter-list"
                    [attr.aria-expanded]="zonesOpen()"
                    (click)="zonesOpen.set(!zonesOpen())"
                  >
                    {{ zoneFilterLabel() }}
                  </button>
                  @if (chosenZoneIds().length > 0) {
                    <span class="zone-filter__active">Showing {{ chosenZoneNames() }}</span>
                    <button type="button" class="btn btn--ghost btn--sm" id="zone-filter-clear" (click)="clearZones()">Clear</button>
                  }
                </div>
                <fieldset id="zone-filter-list" class="zone-filter__list" [hidden]="!zonesOpen()">
                  <legend class="visually-hidden">Zones</legend>
                  @for (zone of store.projectZones(); track zone.id) {
                    <label class="checkbox">
                      <input
                        #box
                        type="checkbox"
                        [checked]="chosenZoneIds().includes(zone.id)"
                        (change)="toggleZone(zone.id, box.checked)"
                      />
                      <span>{{ zone.name }}</span>
                    </label>
                  }
                </fieldset>
              }
              @if (groups().length > 0) {
                <!-- Escape clears the selection while focus is in the list (its checkboxes, its rows, the bar). -->
                <div class="tale-groups-list" (keydown.escape)="selection.clear()">
                  @if (canSelect()) {
                    <div class="tale-groups-list__head">
                      <label class="checkbox">
                        <input
                          type="checkbox"
                          aria-label="Select all tale groups"
                          [checked]="selection.allSelected()"
                          [indeterminate]="selection.someSelected()"
                          (change)="selection.toggleAll()"
                        />
                        <span>Select all</span>
                      </label>
                    </div>
                    <app-bulk-bar [count]="selection.count()" (cleared)="selection.clear()">
                      @if (canEdit()) {
                        <button type="button" class="btn btn--secondary btn--sm" id="bulk-place" (click)="askBulk('place')">
                          Show in another zone
                        </button>
                        <button type="button" class="btn btn--secondary btn--sm" id="bulk-copy" (click)="askBulk('copy')">
                          Copy to zone
                        </button>
                      }
                      @if (canArchive()) {
                        <button type="button" class="btn btn--danger btn--sm" id="bulk-archive" (click)="askBulk('archive')">
                          Archive
                        </button>
                      }
                    </app-bulk-bar>
                  }
                  @if (bulkFailed().length > 0) {
                    <div class="banner banner--inline" role="alert" id="bulk-failed">
                      <app-icon name="alert" />
                      <span>
                        {{ bulkFailed().length }} could not be {{ bulkFailedAction() }}: {{ bulkFailedNames() }}. They stay selected.
                      </span>
                    </div>
                  }
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
                        [plain]="!canSelect()"
                        [opens]="true"
                        [thumbnailTales]="listTales()[group.id] ?? null"
                        (toggled)="switchGroup(group, $event)"
                        (picked)="picked(group, $event)"
                        (click)="rowClick(group, $event)"
                      >
                        @if (canSelect()) {
                          <label groupRowLead class="checkbox group-row__select" (click)="$event.stopPropagation()">
                            <input
                              type="checkbox"
                              [attr.aria-label]="'Select ' + group.name"
                              [checked]="selection.isSelected(group.id)"
                              (change)="selection.toggle(group.id)"
                            />
                          </label>
                        }
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
                        <button
                          groupRowAction
                          type="button"
                          class="btn btn--secondary btn--sm"
                          [id]="'preview-group-' + group.id"
                          [attr.aria-label]="'Preview group ' + group.name"
                          [attr.aria-disabled]="previewZoneOf(group) ? null : 'true'"
                          [attr.title]="previewZoneOf(group) ? null : 'Put it in a zone with a display to preview it'"
                          (click)="previewGroup(group, $event)"
                        >
                          <app-icon name="eye" /> Preview
                        </button>
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
                </div>
              } @else {
                <div class="empty">
                  <p class="empty__title">No tale groups match this filter</p>
                  <p class="empty__text">{{ emptyText() }}</p>
                  <button type="button" class="btn btn--secondary btn--sm" (click)="showAll()">Show all tale groups</button>
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
            @if (bulk(); as run) {
              <app-drawer
                [heading]="bulkHeading()"
                dialogRole="alertdialog"
                describedBy="bulk-text"
                initialFocus="#bulk-cancel"
                [busy]="run.phase === 'running'"
                (closed)="closeBulk()"
              >
                <div class="drawer__body">
                  @if (run.kind === 'archive') {
                    <p id="bulk-text">They stop showing on your site. You can restore them from the Archived filter.</p>
                  } @else if (run.kind === 'place') {
                    @if (bulkPlaceZones().length > 0) {
                      <fieldset class="tag-options" aria-describedby="bulk-text">
                        <legend class="field__label">Zone</legend>
                        @for (zone of bulkPlaceZones(); track zone.id) {
                          <label class="checkbox">
                            <input
                              type="radio"
                              name="bulkPlaceZone"
                              [value]="zone.id"
                              [checked]="run.zoneId === zone.id"
                              (change)="setBulkZone(zone.id)"
                            />
                            <span>{{ zone.name }}</span>
                          </label>
                        }
                      </fieldset>
                      <p class="field__hint" id="bulk-text">
                        Each zone shows its groups last. Their tales and tags are shared: a change shows in every zone.
                        A group already in the zone is left as it is.
                      </p>
                    } @else {
                      <p class="muted" id="bulk-text">Every selected tale group is already in every zone of its project.</p>
                    }
                  } @else {
                    @if (bulkCopyProjects().length > 1) {
                      <div class="field">
                        <label class="field__label" for="bulk-copy-project">Project</label>
                        <select
                          #projectPick
                          id="bulk-copy-project"
                          class="select"
                          (change)="setBulkProject(projectPick.value)"
                        >
                          @for (project of bulkCopyProjects(); track project.id) {
                            <option [value]="project.id" [selected]="project.id === run.projectId">{{ project.name }}</option>
                          }
                        </select>
                      </div>
                    }
                    <div class="field">
                      <label class="field__label" for="bulk-copy-zone">Zone</label>
                      <select
                        #zonePick
                        id="bulk-copy-zone"
                        class="select"
                        aria-describedby="bulk-text"
                        (change)="setBulkZone(zonePick.value)"
                      >
                        <option value="" [selected]="run.zoneId === ''">
                          {{ bulkCopyZones().length > 0 ? 'Choose a zone' : 'This project has no zones' }}
                        </option>
                        @for (zone of bulkCopyZones(); track zone.id) {
                          <option [value]="zone.id" [selected]="zone.id === run.zoneId">{{ zone.name }}</option>
                        }
                      </select>
                      <p class="field__hint" id="bulk-text">
                        The zone shows a new tale group for each selected one, with the same tales, media and tags.
                        Changes to a copy do not change the original, and the other way round.
                      </p>
                    </div>
                  }
                  <ul class="bulk-names">
                    @for (item of run.items.slice(0, 5); track item.id) {
                      <li>{{ item.name }}</li>
                    }
                    @if (run.items.length > 5) {
                      <li class="muted">+{{ run.items.length - 5 }} more</li>
                    }
                  </ul>
                  @if (run.phase === 'running') {
                    <p class="muted" role="status">{{ bulkVerbing() }} {{ run.done }} of {{ run.items.length }}…</p>
                  }
                </div>
                <div class="drawer__footer">
                  <button
                    type="button"
                    class="btn btn--secondary"
                    id="bulk-cancel"
                    [disabled]="run.phase === 'running'"
                    (click)="closeBulk()"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    [class]="run.kind === 'archive' ? 'btn btn--danger' : 'btn btn--primary'"
                    id="bulk-submit"
                    [disabled]="run.phase === 'running' || !bulkCanSubmit()"
                    (click)="confirmBulk()"
                  >
                    {{ run.phase === 'running' ? bulkVerbing() + '…' : bulkSubmitLabel() }}
                  </button>
                </div>
              </app-drawer>
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
  private readonly thumbnails = inject(TaleThumbnails);

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

  /** The zones the list is narrowed to (multi-select); none chosen shows every group. Cleared when the project changes. */
  protected readonly chosenZoneIds = linkedSignal<string, readonly string[]>({
    source: () => this.store.selectedProjectId(),
    computation: () => [],
  });
  protected readonly zonesOpen = signal(false);
  protected readonly zoneFilterLabel = computed(() => {
    const count = this.chosenZoneIds().length;
    return count === 0 ? 'Zones: all' : `Zones: ${count}`;
  });
  protected readonly chosenZoneNames = computed(() =>
    this.store
      .projectZones()
      .filter((zone) => this.chosenZoneIds().includes(zone.id))
      .map((zone) => zone.name)
      .join(', '),
  );

  protected readonly allGroups = computed(() => this.store.projectTaleGroupsOf(this.store.selectedProjectId()));
  /**
   * The tales of each listed group, by group id, read once for the page's visit: the project's list
   * carries counts only, and a row with no cover shows its first tale's picture (story: the main picture).
   */
  protected readonly listTales = signal<Readonly<Record<string, readonly Tale[]>>>({});
  private readonly listTalesRequested = new Set<string>();
  private readonly readListTales = effect(() => {
    for (const group of this.allGroups()) {
      if (this.listTalesRequested.has(group.id)) continue;
      this.listTalesRequested.add(group.id);
      void this.thumbnails.groupTales(group.id).then((tales) => {
        this.listTales.update((shown) => ({ ...shown, [group.id]: tales }));
      });
    }
  });
  /** The project's groups in the chosen zones: what the radio filters count and narrow. */
  private readonly inZones = computed(() =>
    this.allGroups().filter((group) => inChosenZones(group, this.chosenZoneIds())),
  );
  protected readonly groups = computed(() => {
    const filter = this.selected();
    return this.inZones().filter((group) => inTaleGroupFilter(group, filter));
  });
  /** How many groups each filter lists. */
  protected readonly counts = computed(() => {
    const groups = this.inZones();
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
    if (this.chosenZoneIds().length > 0) {
      const label = TALE_GROUP_FILTERS.find((f) => f.id === this.selected())?.label;
      return this.selected() === 'all'
        ? 'No tale group is in the chosen zones.'
        : `No tale group in the chosen zones is listed under ${label}.`;
    }
    switch (this.selected()) {
      case 'visible':
        return 'No tale group is visible on your site. Turn one On in a zone that is set up.';
      case 'off':
        return 'Every tale group is On or archived.';
      case 'scheduled':
        return 'No tale group has a start or end time.';
      case 'targeted':
        return "No tale group is targeted. Add targeting tags or user lists in a group's Audience.";
      case 'unplaced':
        return 'Every tale group is shown in at least one zone.';
      case 'archived':
        return 'No tale group is archived.';
      default:
        return 'Every tale group of this project is archived.';
    }
  });

  /**
   * The rows picked for a bulk action (the reusable selection, `selection.ts`): the list's visible
   * groups. Checkboxes and the bar show only to a role that may archive (content.publish); Show in
   * another zone and Copy to zone also need content.edit, as their single actions do.
   */
  protected readonly selection = createSelection(
    () => this.groups(),
    (group: TaleGroupSummary) => group.id,
  );
  /** Checkboxes and the bar show to a role that may run one of the bulk actions. */
  protected readonly canSelect = computed(() => this.canArchive() || this.canEdit());
  protected readonly canArchive = computed(() => this.store.can('content.publish'));
  protected readonly canEdit = computed(() => this.store.can('content.edit', this.store.selectedProjectId()));
  /**
   * The bulk action being confirmed, then run: which one, the groups it names (with the zones each
   * is in, for the zone picker), the zone and project picked, and how many are done.
   */
  protected readonly bulk = signal<{
    kind: BulkKind;
    phase: 'confirm' | 'running';
    items: readonly BulkItem[];
    done: number;
    zoneId: string;
    projectId: string;
  } | null>(null);
  /** The groups the last bulk action could not do, kept selected until the next action. */
  protected readonly bulkFailed = signal<readonly { id: string; name: string; message: string }[]>([]);
  /** What the last bulk action failed to do, as the failure says it: "archived", "copied"... */
  protected readonly bulkFailedAction = signal('archived');
  protected readonly bulkFailedNames = computed(() => this.bulkFailed().map((f) => f.name).join(', '));
  /** The zones "Show in another zone" offers: those that lack at least one of the groups (as its single action does). */
  protected readonly bulkPlaceZones = computed(() => {
    const items = this.bulk()?.items ?? [];
    return this.store
      .projectZones()
      .filter((zone) => items.some((item) => item.storedStatus !== 'archived' && !item.zoneIds.includes(zone.id)));
  });
  /** The projects "Copy to zone" can go to: every project the user can access, the selected one first. */
  protected readonly bulkCopyProjects = computed(() => {
    const own = this.store.selectedProjectId();
    const projects = this.store.projects();
    return [...projects.filter((p) => p.id === own), ...projects.filter((p) => p.id !== own)];
  });
  /** The zones of the picked project, where a copy goes. */
  protected readonly bulkCopyZones = computed(() => {
    const projectId = this.bulk()?.projectId;
    return projectId ? this.store.zones().filter((z) => z.projectId === projectId) : [];
  });
  protected readonly bulkCanSubmit = computed(() => {
    const run = this.bulk();
    return !!run && (run.kind === 'archive' || run.zoneId !== '');
  });
  protected readonly bulkVerbing = computed(() => {
    switch (this.bulk()?.kind) {
      case 'place':
        return 'Adding';
      case 'copy':
        return 'Copying';
      default:
        return 'Archiving';
    }
  });
  protected readonly bulkHeading = computed(() => {
    const run = this.bulk();
    const count = run?.items.length ?? 0;
    const groups = `${count} tale ${count === 1 ? 'group' : 'groups'}`;
    switch (run?.kind) {
      case 'place':
        return `Show ${groups} in another zone?`;
      case 'copy':
        return `Copy ${groups} to a zone?`;
      default:
        return `Archive ${groups}?`;
    }
  });
  protected readonly bulkSubmitLabel = computed(() => {
    const run = this.bulk();
    const count = run?.items.length ?? 0;
    const groups = `${count} ${count === 1 ? 'group' : 'groups'}`;
    switch (run?.kind) {
      case 'place':
        return `Add ${groups}`;
      case 'copy':
        return `Copy ${groups}`;
      default:
        return `Archive ${groups}`;
    }
  });

  /** How many single-group requests a bulk action keeps in flight. */
  private static readonly BULK_CONCURRENCY = 3;

  /**
   * Opens the confirmation of a bulk action for the selected groups. Archive is the only way a group
   * leaves the list (the API has no delete).
   */
  protected askBulk(kind: BulkKind): void {
    if (this.selection.count() === 0) return;
    if (kind === 'archive' ? !this.canArchive() : !this.canEdit()) return;
    this.bulkFailed.set([]);
    this.bulk.set({
      kind,
      phase: 'confirm',
      items: this.selection.selectedItems().map((group) => ({
        id: group.id,
        name: group.name,
        zoneIds: group.zoneIds,
        storedStatus: group.storedStatus,
      })),
      done: 0,
      zoneId: '',
      projectId: this.store.selectedProjectId(),
    });
  }

  /** Picks the zone a bulk "Show in another zone" or "Copy to zone" goes to. */
  protected setBulkZone(zoneId: string): void {
    this.bulk.update((current) => (current ? { ...current, zoneId } : current));
  }

  /** Picks the project of a bulk copy; its zone has to be picked again. */
  protected setBulkProject(projectId: string): void {
    this.bulk.update((current) => (current ? { ...current, projectId, zoneId: '' } : current));
  }

  /** Closes the confirmation; not while the actions run. */
  protected closeBulk(): void {
    if (this.bulk()?.phase === 'running') return;
    this.bulk.set(null);
  }

  /**
   * Runs the confirmed bulk action through the single-group endpoints, a few at a time, then
   * refreshes once. The groups that were done leave the list (archive) or show the zone (place, copy);
   * the ones that failed stay selected and are named.
   */
  protected async confirmBulk(): Promise<void> {
    const run = this.bulk();
    if (!run || run.phase !== 'confirm' || !this.bulkCanSubmit()) return;
    if (run.kind === 'archive' ? !this.canArchive() : !this.canEdit()) return;
    this.bulk.set({ ...run, phase: 'running', done: 0 });
    const outcome = await runLimited(
      run.items,
      TaleGroupsPage.BULK_CONCURRENCY,
      (item) => this.bulkStep(run, item),
      (done) => this.bulk.update((current) => (current ? { ...current, done } : current)),
    );
    await this.store.refresh();
    const failed = outcome.failed.map(({ item, message }) => ({ id: item.id, name: item.name, message }));
    this.selection.replace(failed.map((f) => f.id));
    this.bulkFailed.set(failed);
    this.bulkFailedAction.set(BULK_FAILED_ACTION[run.kind]);
    this.bulk.set(null);
    this.announce(this.bulkAnnouncement(run, outcome.succeeded.length, failed.length));
  }

  /** One group's request for a bulk action: '' when it is done, else the message to show. */
  private async bulkStep(run: { kind: BulkKind; zoneId: string }, item: BulkItem): Promise<string> {
    switch (run.kind) {
      case 'archive':
        return (await this.store.putTaleGroupStatus(item.id, 'archived')).message;
      case 'place':
        // As the single action: an archived group is not shown in a zone, and a group already in it is.
        if (item.storedStatus === 'archived') return 'Archived. Restore it to show it in a zone';
        if (item.zoneIds.includes(run.zoneId)) return '';
        return this.store.placeTaleGroup(run.zoneId, item.id);
      case 'copy':
        return (await this.store.copyTaleGroup(item.id, run.zoneId)).message;
    }
  }

  /** What the polite live region says when a bulk action ends: what was done, and what was not. */
  private bulkAnnouncement(run: { kind: BulkKind; zoneId: string }, done: number, failed: number): string {
    const zone = this.store.zone(run.zoneId)?.name ?? 'the zone';
    const past = run.kind === 'archive' ? 'archived' : run.kind === 'place' ? `shown in ${zone}` : `copied to ${zone}`;
    if (failed === 0) return `${done} tale ${done === 1 ? 'group' : 'groups'} ${past}.`;
    return `${done} ${past}. ${failed} could not be ${BULK_FAILED_ACTION[run.kind]}: ${this.bulkFailedNames()}.`;
  }

  /** The group preview open, with the zone it shows the group in and the button that opened it; one at a time. */
  protected readonly preview = signal<{ zone: Zone; groupId: string; label: string; opener: HTMLElement } | null>(null);

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
      menus.set(
        group.id,
        gateMenu(
          [
        { id: 'rename', label: 'Rename' },
        { id: 'cover', label: 'Cover' },
        { id: 'tags', label: 'Audience' },
        { id: 'schedule', label: 'Schedule' },
        placeReason
          ? { id: 'place', label: 'Show in another zone', disabledReason: placeReason }
          : { id: 'place', label: 'Show in another zone' },
        { id: 'copy', label: 'Copy to zone' },
        ...(statusItem ? [statusItem] : []),
          ],
          (permission) => this.store.can(permission, group.projectId),
          (permission) => this.store.roleNeeded(permission),
        ),
      );
    }
    return menus;
  });

  /** The group whose Audience drawer is open, with its place in the list, to tell if it leaves the list. */
  private audienceOf: { id: string; name: string; index: number; listed: boolean } | null = null;

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
    // Once a group's Audience drawer closes: a group its new tags took out of the list (the Targeted
    // filter, its last tag removed) is announced with the filter that lists it, and focus goes where
    // it goes when a status change takes a row out (`changeStatus`).
    effect(() => {
      if (this.store.drawer() !== null) return;
      untracked(() => {
        const pending = this.audienceOf;
        this.audienceOf = null;
        if (!pending?.listed) return;
        const now = this.allGroups().find((group) => group.id === pending.id);
        if (!now || inTaleGroupFilter(now, this.selected())) return;
        this.announce(
          `${pending.name} is not targeted now. It is listed under ${TALE_GROUP_FILTERS.find((f) => f.id === homeFilter(now))?.label}.`,
        );
        if (this.openedGroup()?.id !== pending.id) this.focusAfterLeaving(pending.index);
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

  /** Chooses or drops a zone of the zone filter. */
  protected toggleZone(zoneId: string, checked: boolean): void {
    this.chosenZoneIds.update((ids) =>
      checked ? [...ids.filter((id) => id !== zoneId), zoneId] : ids.filter((id) => id !== zoneId),
    );
  }

  protected clearZones(): void {
    this.chosenZoneIds.set([]);
  }

  /** Shows every group: no zone chosen, and the All filter. */
  protected showAll(): void {
    this.clearZones();
    this.choose('all', true);
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

  /** The zone a group's Preview shows it in: the first with a display that lists it; null when none does. */
  protected previewZoneOf(group: ProjectTaleGroup): Zone | null {
    return (
      this.store
        .projectZones()
        .find(
          (zone) =>
            !!zone.frame &&
            group.zoneIds.includes(zone.id) &&
            this.store.taleGroupsOf(zone.id).some((listed) => listed.id === group.id),
        ) ?? null
    );
  }

  /** Opens the group's Preview, as a visitor's page shows it; a group no zone with a display shows is not previewed. */
  protected previewGroup(group: ProjectTaleGroup, event: Event): void {
    const zone = this.previewZoneOf(group);
    if (zone) {
      this.preview.set({ zone, groupId: group.id, label: `Preview of ${group.name}`, opener: event.currentTarget as HTMLElement });
    }
  }

  protected closePreview(): void {
    this.preview.set(null);
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
        this.audienceOf = {
          id: taleGroupId,
          name: group.name,
          index: this.groups().findIndex((g) => g.id === taleGroupId),
          listed: inTaleGroupFilter(group, this.selected()),
        };
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
