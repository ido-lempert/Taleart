import { CdkDrag, CdkDragHandle, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
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
} from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  findTemplate,
  isSwitchable,
  MAX_TALES_PER_GROUP,
  switchStatus,
  taleShownStatus,
  type ContentStatus,
  type SettableStatus,
  type TaleGroup,
  type TaleGroupTag,
  type Zone,
} from '@taleart/contract/core';
import { AuthStore } from '../auth';
import { compareTags, DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { MenuButton, type MenuItem, type MenuPick } from '../menu-button';
import { describeWindow, windowChip } from '../schedule';
import { describeSettings, type Settings } from '../settings-form';
import { needsBadge, ShowSwitch, StatusBadge, statusActions, statusLabel } from '../status';
import { visibilityLine, visibilityReasons, VisibilityIndicator } from '../visibility';
import {
  showsSetup,
  ZONE_TAB_PARAM,
  ZONE_TABS,
  zoneInstalled,
  zoneSetupSteps,
  zoneTab,
  type ZoneSetupStep,
  type ZoneTab,
} from '../zone-setup';
import { AddExistingGroup, addableGroups } from './add-existing-group';
import { GroupView, shownCount, shownLabel } from './group-view';
import { SiteKeyCard } from './site-key-card';

/** The query parameter naming the group whose view is open (epic UX rework R11). */
const GROUP_PARAM = 'group';
/** The history state key marking an entry this page pushed to open a group's view. */
const GROUP_STATE = 'taleartGroupView';

/** Which way a move button moves its item. */
type Direction = 'earlier' | 'later';

/**
 * One zone (epic UX rework R9): a header with its name, slug, indicator (R7) and a summary (display
 * type, group count, installed or not, the template it came from); a setup checklist until the zone
 * is first visible; and three tabs, Tale groups (the default), Display and Install, following the
 * WAI-ARIA tabs pattern with automatic activation: arrow keys, Home and End move focus and select
 * the tab at once, since every panel is already rendered. The selected tab is in the URL
 * (`?tab=display`), so a reload keeps it and back and forward step through tabs.
 *
 * The Tale groups tab lists its tale groups, one row each (epic UX rework R10): reorder handle and
 * move buttons, cover, name, "3 of 4 shown", the On/Off switch (AD-6 amended, R6), the indicator
 * (R7), the schedule chip when a window exists (R8), and a ⋯ menu with every other action (Rename,
 * Cover, Tags, Schedule, Show in another zone, Copy to zone, Remove from this zone, Archive or
 * Restore); an item that cannot apply stays, disabled, with its reason. A status the switch does
 * not say (scheduled, blocked by group, archived) shows as a badge. Opening a group (its name, or
 * a click on the row outside its controls) opens its group view (R11, `GroupView`): a wide drawer,
 * a page on phones, whose group is in the URL (`?group=<id>`), so it deep-links and Back closes it.
 * Groups reorder by drag, or by their move earlier and later buttons (the single-pointer and
 * keyboard alternative, WCAG 2.2 SC 2.5.7), each move announced. Tag chips above the groups filter
 * them; groups do not reorder while a filter is on, since the order covers every group of the zone.
 * "New tale group" and "Add existing group" sit below the list.
 */
@Component({
  selector: 'app-zone-detail-page',
  imports: [
    RouterLink,
    Icon,
    StatusBadge,
    ShowSwitch,
    VisibilityIndicator,
    MenuButton,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    GroupView,
    AddExistingGroup,
    SiteKeyCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './zone-detail.html',
  styleUrls: ['./zone-groups.css'],
  styles: `
    .zone-section {
      min-width: 0;
    }
    .display-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
      margin: 0 0 var(--space-3);
    }
    .display-settings {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-4);
      margin: 0 0 var(--space-3);
      font-size: var(--text-sm);
    }
    .display-settings div {
      display: flex;
      gap: var(--space-1);
    }
    .display-settings dt {
      color: var(--text-muted);
    }
    .display-settings dt::after {
      content: ':';
    }
    .display-settings dd {
      margin: 0;
    }
    .display-type .field {
      margin: 0;
    }
    .display-type__controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .display-type__controls .select {
      width: auto;
      min-width: 10rem;
    }
    .zone-template {
      white-space: nowrap;
    }
    .zone-visibility {
      margin-top: var(--space-2);
    }
    .zone-edit {
      align-self: flex-start;
      margin-top: var(--space-2);
    }
    .zone-header__title {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--space-1) var(--space-4);
    }
    .zone-header__title h2 {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .zone-summary {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin: var(--space-1) 0 0;
      padding: 0;
      list-style: none;
    }
    .zone-setup__steps {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .zone-setup__step {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2) var(--space-3);
    }
    /* The step's state is also in words beside it; the mark only repeats it. */
    .zone-setup__mark {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 20px;
      height: 20px;
      border: 2px solid var(--border-strong);
      border-radius: 50%;
      color: #fff;
      font-size: 12px;
      line-height: 1;
    }
    .zone-setup__step--done .zone-setup__mark {
      border-color: var(--success);
      background: var(--success);
    }
    .zone-setup__step--done .zone-setup__mark::before {
      content: '\\2713';
      font-weight: 700;
    }
    .zone-setup__link {
      min-height: 24px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--ink);
      font: inherit;
      font-weight: 600;
      text-align: start;
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
    .zone-setup__step--done .zone-setup__link {
      font-weight: 400;
    }
    .zone-setup__state {
      color: var(--text-muted);
      font-size: var(--text-sm);
    }
    /* Under the step's link, past its mark. */
    .zone-setup__hint {
      flex-basis: 100%;
      padding-inline-start: calc(20px + var(--space-3));
      color: var(--text-secondary);
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
    .zone-setup__count {
      margin: 0;
    }
    /* The tab list scrolls on its own when it cannot fit, so the page never scrolls sideways. */
    .zone-tabs {
      display: flex;
      gap: var(--space-1);
      max-width: 100%;
      margin-bottom: calc(var(--space-6) * -1 + var(--space-4));
      overflow-x: auto;
      border-bottom: 1px solid var(--border-strong);
    }
    .zone-tab {
      flex: none;
      min-height: 44px;
      padding: 0 var(--space-4);
      border: 0;
      border-bottom: 3px solid transparent;
      background: none;
      color: var(--text-secondary);
      font: inherit;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .zone-tab:hover {
      color: var(--ink);
    }
    .zone-tab[aria-selected='true'] {
      border-bottom-color: var(--ember-strong);
      color: var(--ink);
    }
    .zone-tab:focus-visible {
      outline-offset: -3px;
    }
    .zone-panel {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      min-width: 0;
    }
    .zone-panel[hidden] {
      display: none;
    }
    .zone-theme-link {
      margin: var(--space-4) 0 0;
    }
  `,
})
export class ZoneDetailPage {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Bound from the `:zoneId` route parameter. */
  readonly zoneId = input.required<string>();
  /** Bound from the `?tab=` query parameter: the selected tab, the default when missing (epic UX rework R9). */
  readonly tab = input<string | undefined>();
  /** Bound from the `?group=` query parameter: the group whose view is open (epic UX rework R11). */
  readonly group = input<string | undefined>();

  protected readonly tabs = ZONE_TABS;
  /**
   * The selected tab: follows the URL (reload, back and forward), and changes at once on a click or
   * key, before the URL has caught up, so focus can move into the panel in the same turn.
   */
  protected readonly selectedTab = linkedSignal<ZoneTab>(() => zoneTab(this.tab()));
  /** The header's group count, such as "1 tale group". */
  protected readonly groupCount = computed(() => {
    const count = this.groups().length;
    return `${count} tale group${count === 1 ? '' : 's'}`;
  });
  /** Installed or not (an active site key, epic UX rework R3); null while unknown. */
  protected readonly installed = computed(() => {
    const zone = this.zone();
    return zone ? zoneInstalled(zone) : null;
  });
  /** The setup checklist's steps, each ticked from the zone's visibility (R7, R9). */
  protected readonly setupSteps = computed(() => {
    const zone = this.zone();
    return zone ? zoneSetupSteps(zone, this.auth.isAdmin()) : [];
  });
  /**
   * Why the group step is still open when the zone has groups: the first group's own first reason,
   * such as "Summer sale: starts 1 Dec 2026, 09:00" (the zone's reasons have their own steps).
   */
  protected readonly groupStepHint = computed(() => {
    if (this.setupSteps().find((step) => step.id === 'group')?.done !== false) return '';
    for (const group of this.groups()) {
      const reasons = (group.visibility?.reasons ?? []).filter((reason) => reason.subject !== 'zone');
      if (reasons.length > 0) {
        return `${group.name}: ${visibilityReasons({ visible: false, reasons }, 'group')[0]}`;
      }
    }
    return '';
  });
  protected readonly setupDoneCount = computed(() => this.setupSteps().filter((step) => step.done).length);
  /** The checklist shows only until the zone is first visible, as the API records it. */
  protected readonly setupShown = computed(() => {
    const zone = this.zone();
    return !!zone && showsSetup(zone);
  });

  constructor() {
    // A `?tab=` that names the default or no tab is dropped from the URL, without a history entry.
    effect(() => {
      const tab = this.tab();
      if (tab !== undefined && (tab === 'groups' || zoneTab(tab) !== tab)) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { [ZONE_TAB_PARAM]: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
    // A `?group=` naming no group of this zone (removed from it, a stale link), or on a zone that
    // does not exist, is dropped, in place.
    effect(() => {
      const id = this.group();
      if (id === undefined || !this.store.loaded() || this.store.apiDown()) return;
      if (!this.zone() || !this.groups().some((group) => group.id === id)) {
        this.openGroupId.set(null);
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { [GROUP_PARAM]: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
    // Says when a setup step gets done and when the zone becomes visible (R9, R18), and opens Tale
    // groups when a group is created from the top bar while another tab shows.
    let last: { zoneId: string; done: Set<string>; shown: boolean; groups: Set<string> } | null = null;
    effect(() => {
      const zoneId = this.zoneId();
      const zone = this.zone();
      if (!this.store.loaded() || !zone) return;
      const steps = this.setupSteps();
      const done = new Set(steps.filter((step) => step.done).map((step) => step.id));
      const shown = this.setupShown();
      const groups = new Set(this.groups().map((group) => group.id));
      const before = last?.zoneId === zoneId ? last : null;
      last = { zoneId, done, shown, groups };
      if (!before) return;
      if (before.shown && !shown && zone.visibility?.visible) {
        this.announce('This zone is now visible on your site');
      } else if (shown) {
        const newly = steps.filter((step) => step.done && !before.done.has(step.id));
        if (newly.length > 0) this.announce(newly.map((step) => `Step done: ${step.label}`).join('. '));
      }
      if (this.selectedTab() !== 'groups' && [...groups].some((id) => !before.groups.has(id))) {
        this.selectTab('groups');
      }
    });
  }

  protected readonly zone = computed(() => this.store.zone(this.zoneId()));
  /** The zone's display: its one frame, or null (AD-17). */
  protected readonly display = computed(() => this.store.displayOf(this.zoneId()));
  /** The display's settings as labels and values, the type's defaults filled in by the API on delivery. */
  protected readonly displaySettings = computed(() => {
    const display = this.display();
    return display
      ? describeSettings(this.store.frameType(display.type)?.schema, display.settings as unknown as Settings)
      : [];
  });
  /** The type picked in the Display card; follows the display's type until changed by hand. */
  protected readonly pickedType = linkedSignal(() => this.display()?.type ?? '');
  protected readonly changingType = signal(false);
  /** The API's message when it refused a display change; cleared when the zone changes. */
  protected readonly displayError = linkedSignal({ source: this.zoneId, computation: () => '' });
  /** The name of the template the zone was created from (epic UX rework R5): a note only, or ''. */
  protected readonly createdFromTemplate = computed(() => {
    const key = this.zone()?.createdFromTemplate;
    return key ? (findTemplate(key)?.label ?? key) : '';
  });
  protected readonly groups = computed(() => this.store.taleGroupsOf(this.zoneId()));

  /** The other zones the open group is placed in, for its "Also in: …" line (AD-14). */
  protected readonly openOtherZones = computed<Zone[]>(() =>
    (this.openedGroup()?.zoneIds ?? []).flatMap((id) => {
      const zone = id === this.zoneId() ? undefined : this.store.zone(id);
      return zone ? [zone] : [];
    }),
  );

  /**
   * Selects a tab and puts it in the URL: a history entry, so back and forward step through the tabs
   * a person clicked, or in place (`replaceUrl`) for arrow keys, which pass through tabs on the way.
   * `focus` then moves focus, once the panel shows, to the tab itself ('tab') or to the element it
   * finds in the page, else to the panel.
   */
  protected selectTab(
    tab: ZoneTab,
    focus: 'tab' | ((root: HTMLElement) => HTMLElement | null) | null = null,
    replaceUrl = false,
  ): void {
    const changed = this.selectedTab() !== tab;
    this.selectedTab.set(tab);
    if (changed) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { [ZONE_TAB_PARAM]: tab === 'groups' ? null : tab },
        queryParamsHandling: 'merge',
        replaceUrl,
      });
    }
    if (!focus) return;
    const move = () => {
      const root = this.host.nativeElement;
      const target =
        focus === 'tab'
          ? root.querySelector<HTMLElement>(`#zone-tab-${tab}`)
          : (focus(root) ?? root.querySelector<HTMLElement>(`#zone-panel-${tab}`));
      target?.focus();
    };
    if (changed) afterNextRender(move, { injector: this.injector });
    else move();
  }

  /** The tab list's keys (WAI-ARIA tabs, automatic activation): arrows wrap, Home and End go to the ends. */
  protected tabKey(event: KeyboardEvent): void {
    const ids = this.tabs.map((tab) => tab.id);
    const at = ids.indexOf(this.selectedTab());
    const next: Partial<Record<string, number>> = {
      ArrowRight: (at + 1) % ids.length,
      ArrowLeft: (at - 1 + ids.length) % ids.length,
      Home: 0,
      End: ids.length - 1,
    };
    const index = next[event.key];
    if (index === undefined || !(event.target as HTMLElement).matches('[role=tab]')) return;
    event.preventDefault();
    this.selectTab(ids[index], 'tab', true);
  }

  /** Opens the tab where a setup step is done and focuses its control (R9). */
  protected goToStep(step: ZoneSetupStep): void {
    const first = (root: HTMLElement, ...selectors: string[]): HTMLElement | null => {
      for (const selector of selectors) {
        const found = root.querySelector<HTMLElement>(selector);
        if (found) return found;
      }
      return null;
    };
    if (step.id === 'display') {
      this.selectTab(step.tab, (root) => first(root, '#display-choose', '#display-type-select'));
    } else if (step.id === 'install') {
      // A content manager has no key action: the card's heading, which says to ask an admin.
      this.selectTab(step.tab, (root) => first(root, '#site-key-issue', '#site-key-rotate', '#site-key-title'));
    } else {
      // An Off group's switch; with every group On, a group whose tales are all Hidden, opened at
      // its first Hidden tale's switch; else the first group's name, whose row says why it is not
      // visible; with no group, "New tale group".
      const offSwitch = '#zone-panel-groups .group-row [role=switch][aria-checked=false]';
      const allHidden = this.groups().find(
        (group) =>
          isSwitchable(group.storedStatus) &&
          group.storedStatus === 'live' &&
          group.tales.length > 0 &&
          group.tales.every((tale) => taleShownStatus(tale.storedStatus) !== 'shown'),
      );
      if (allHidden && !this.host.nativeElement.querySelector(offSwitch)) {
        // One navigation: the tab and the group together.
        this.selectedTab.set(step.tab);
        this.openGroup(allHidden, '.group-view__list [role=switch][aria-checked=false]', {
          [ZONE_TAB_PARAM]: step.tab === 'groups' ? null : step.tab,
        });
        return;
      }
      this.selectTab(step.tab, (root) =>
        first(root, offSwitch, '#zone-panel-groups .group-row__open', '#new-tale-group'),
      );
    }
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
  protected readonly needsBadge = needsBadge;
  protected readonly isSwitchable = isSwitchable;
  protected readonly describeWindow = describeWindow;
  protected readonly windowChip = windowChip;

  /**
   * Each group row's ⋯ menu, by group id (epic UX rework R8, R10). "Show in another zone" stays,
   * disabled with its reason, when the group is in every zone of its project; Archive is Restore
   * for an archived group.
   */
  protected readonly groupMenus = computed(() => {
    const menus = new Map<string, readonly MenuItem[]>();
    const saving = this.statusSaving();
    for (const group of this.groups()) {
      const status = statusActions(group.storedStatus)[0];
      const statusItem: MenuItem | null = status
        ? saving.has(group.id)
          ? { id: `status:${status.status}`, label: status.label, disabledReason: 'Saving…' }
          : { id: `status:${status.status}`, label: status.label }
        : null;
      menus.set(group.id, [
        { id: 'rename', label: 'Rename' },
        { id: 'cover', label: 'Cover' },
        { id: 'tags', label: 'Tags' },
        { id: 'schedule', label: 'Schedule' },
        this.store.zonesToPlace(group.id).length > 0
          ? { id: 'place', label: 'Show in another zone' }
          : { id: 'place', label: 'Show in another zone', disabledReason: 'Already in every zone' },
        { id: 'copy', label: 'Copy to zone' },
        { id: 'remove', label: 'Remove from this zone' },
        ...(statusItem ? [statusItem] : []),
      ]);
    }
    return menus;
  });

  /** Does what a group's ⋯ menu item says; a drawer it opens returns focus to the menu's button. */
  protected groupPicked(group: TaleGroup, pick: MenuPick): void {
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
      case 'remove':
        return this.store.openDrawer({ kind: 'removeTaleGroup', zoneId: this.zoneId(), taleGroupId }, pick.opener);
      default: {
        // Archive or Restore: the status it sets, as the menu offered it.
        const action = statusActions(group.storedStatus).find((a) => `status:${a.status}` === pick.id);
        if (action?.status === 'archived') void this.archive(group);
        else if (action) void this.changeStatus(group, action.status);
      }
    }
  }

  protected readonly maxTales = MAX_TALES_PER_GROUP;

  /**
   * The group whose view is open: follows the URL (`?group=`, reload, back and forward), and
   * changes at once on a click, before the URL has caught up.
   */
  protected readonly openGroupId = linkedSignal<string | null>(() => this.group() ?? null);
  /** The open group, while this zone lists it. */
  protected readonly openedGroup = computed(() => {
    const id = this.openGroupId();
    return id ? (this.groups().find((group) => group.id === id) ?? null) : null;
  });
  /**
   * The control the view focuses when it opens (a selector), for the group it was asked for; its
   * heading otherwise, so a later open (another group, back and forward) never reuses it.
   */
  private readonly focusRequest = signal<{ groupId: string; selector: string } | null>(null);
  protected readonly groupViewFocus = computed(() => {
    const request = this.focusRequest();
    return request && request.groupId === this.openedGroup()?.id ? request.selector : null;
  });

  protected isOpen(groupId: string): boolean {
    return this.openedGroup()?.id === groupId;
  }

  /**
   * Opens a group's view (its name's button, a row click): a history entry marked as ours, so
   * closing it goes back in history, as Back does. `params` go in the same navigation.
   */
  protected openGroup(group: TaleGroup, focus: string | null = null, params: Record<string, string | null> = {}): void {
    this.focusRequest.set(focus ? { groupId: group.id, selector: focus } : null);
    this.announcement.set('');
    this.openGroupId.set(group.id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...params, [GROUP_PARAM]: group.id },
      queryParamsHandling: 'merge',
      state: { [GROUP_STATE]: group.id },
    });
  }

  /**
   * Closes the group view, which then puts focus back on the group's name. When this page opened
   * it (a history entry of ours), it goes back, so Back does not lead to the same page again; a
   * deep link or a reload drops `?group=` in place.
   */
  protected closeGroup(): void {
    const id = this.openGroupId();
    this.openGroupId.set(null);
    this.focusRequest.set(null);
    this.announcement.set('');
    const state = this.location.getState() as Record<string, unknown> | null;
    if (id && state?.[GROUP_STATE] === id && this.group() === id) {
      this.location.back();
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [GROUP_PARAM]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Where the open group's row is, so focus can go to the row after it once it is gone. */
  private readonly openIndex = computed(() => {
    const id = this.openedGroup()?.id;
    return id ? this.groups().findIndex((group) => group.id === id) : -1;
  });

  /**
   * Where focus goes when the group view closes: the group's name in its row, found at that moment
   * (also after a deep link, which no button opened). Without the row (the group left the zone),
   * the name of the row now in its place or the one before, else the list's heading.
   */
  protected readonly groupViewReturn = computed(() => {
    const id = this.openedGroup()?.id;
    const index = this.openIndex();
    return (): HTMLElement | null => {
      const root = this.host.nativeElement;
      const own = id ? root.querySelector<HTMLElement>(`[id="group-name-${id}"]`) : null;
      if (own) return own;
      const names = [...root.querySelectorAll<HTMLElement>('#zone-panel-groups .group-row__open')];
      return names[index] ?? names[index - 1] ?? root.querySelector<HTMLElement>('#groups-title');
    };
  });

  /**
   * A click on the row opens the group, as its name does, unless it was on one of the row's own
   * controls (switch, ⋯ and its menu, move buttons, handle, indicator, links) or ended a text
   * selection.
   */
  protected rowClick(group: TaleGroup, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      !target ||
      target.closest(
        'button, a, input, select, label, [role=menu], .menu-button, .group-row__reorder, .status-badge, app-visibility',
      )
    ) {
      return;
    }
    if ((globalThis.getSelection?.()?.toString() ?? '') !== '') return;
    this.openGroup(group);
  }

  /** "3 of 4 shown": the group's tales that are Shown, of all its tales. */
  protected readonly shownCount = shownCount;

  /** The project's groups that "Add existing group" can place here. */
  protected readonly addableGroups = computed(() => addableGroups(this.store, this.zoneId()));
  /** The open "Add existing group" drawer, with the button that opened it. */
  protected readonly addingExisting = signal<{ zoneId: string; opener: HTMLElement | null } | null>(null);

  /** Why "Add existing group" cannot apply: every other group is archived, or there is none. */
  protected readonly addExistingReason = computed(() => {
    const zone = this.zone();
    const archivedElsewhere =
      !!zone &&
      this.store
        .projectTaleGroupsOf(zone.projectId)
        .some((group) => !group.zoneIds.includes(zone.id) && group.storedStatus === 'archived');
    return archivedElsewhere
      ? 'The other tale groups of this project are archived. Restore one to add it.'
      : 'No other tale group of this project to add';
  });

  /** The group archived last from its ⋯ menu, with its status before, for Undo; cleared when the zone changes. */
  protected readonly undo = linkedSignal<string, { id: string; name: string; before: ContentStatus } | null>({
    source: this.zoneId,
    computation: () => null,
  });
  protected readonly undoing = signal(false);

  /** Archives a group from its ⋯ menu and offers Undo, which restores its status before. */
  private async archive(group: TaleGroup): Promise<void> {
    const before = group.storedStatus;
    const message = await this.saving(group.id, group.id, () => this.store.setTaleGroupStatus(group.id, 'archived'));
    if (message) return;
    this.undo.set({ id: group.id, name: group.name, before });
    // Archived from its view: the view closes and focus goes to Undo, which is on the page.
    const fromView = this.openedGroup()?.id === group.id;
    if (fromView) this.closeGroup();
    this.announce(`${group.name} archived. Undo is above the list.`);
    if (fromView) {
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('#undo-archive')?.focus(), {
        injector: this.injector,
      });
    }
  }

  /** Restores the group archived last: back to Off, then On again when it was On. */
  protected async undoArchive(): Promise<void> {
    const last = this.undo();
    if (!last || this.undoing()) return;
    this.undoing.set(true);
    let message = await this.saving(last.id, last.id, () => this.store.setTaleGroupStatus(last.id, 'paused'));
    if (!message && last.before === 'live') {
      message = await this.saving(last.id, last.id, () => this.store.setTaleGroupStatus(last.id, 'live'));
    }
    this.undoing.set(false);
    if (message) return;
    this.undo.set(null);
    const saved = this.groups().find((g) => g.id === last.id);
    this.announce(
      `${last.name} restored, ${statusLabel(saved?.status ?? (last.before === 'live' ? 'live' : 'paused'), 'group').toLowerCase()}` +
        (saved?.visibility ? `. ${visibilityLine(saved.visibility, 'group')}` : ''),
    );
    // The Undo button is gone: focus goes to the group's ⋯ button.
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(`#group-name-${last.id}`)
          ?.closest('.group')
          ?.querySelector<HTMLElement>('.menu-button__trigger')
          ?.focus(),
      { injector: this.injector },
    );
  }

  protected addExisting(event: Event): void {
    if (this.addableGroups().length === 0) return;
    this.addingExisting.set({ zoneId: this.zoneId(), opener: event.currentTarget as HTMLElement | null });
  }

  protected addedExisting(name: string): void {
    this.addingExisting.set(null);
    this.announce(`${name} added to ${this.zone()?.name ?? 'this zone'}`);
  }

  /** "On" or "Off" for a group, "Shown" or "Hidden" for a tale, from its stored key (AD-6 amended). */
  protected readonly shownLabel = shownLabel;

  protected pickType(event: Event): void {
    this.pickedType.set((event.target as HTMLSelectElement).value);
    this.displayError.set('');
  }

  /** Changes the display's type; the API resets its settings to that type's defaults (AD-17), then announces it. */
  protected async changeDisplayType(event: Event): Promise<void> {
    event.preventDefault();
    const zoneId = this.zoneId();
    const type = this.pickedType();
    if (this.changingType() || !type || type === this.display()?.type) return;
    this.changingType.set(true);
    const message = await this.store.updateDisplay(zoneId, { type });
    this.changingType.set(false);
    this.displayError.set(message);
    if (!message) {
      this.announce(`The display is now a ${this.store.frameTypeLabel(type).toLowerCase()}, with its default settings.`);
    }
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

  protected stepGroup(index: number, direction: Direction): void {
    const group = this.groups()[index];
    if (!group) return;
    this.moveGroup(index, index + (direction === 'earlier' ? -1 : 1));
    this.refocus(`group:${group.id}`, direction);
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

  private async save(request: Promise<string>): Promise<void> {
    this.orderError.set('');
    const message = await request;
    if (message) this.orderError.set(message);
  }

  // A repeated message is changed by a trailing no-break space, so it is announced again.
  protected announce(message: string): void {
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
}
