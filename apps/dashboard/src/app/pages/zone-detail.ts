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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  findTemplate,
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
import { MenuButton, type MenuItem, type MenuPick } from '../menu-button';
import { describeWindow, windowChip } from '../schedule';
import { describeSettings, type Settings } from '../settings-form';
import { needsBadge, ShowSwitch, StatusBadge, statusActions, statusLabel, type StatusKind } from '../status';
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
import { DuplicateTale, duplicatedMessage, type DuplicatedTale } from './duplicate-tale';
import { SiteKeyCard } from './site-key-card';

const TONES = 6;

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
 * The Tale groups tab lists its tale groups, each a row of 9:16 tale cards with
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
    MenuButton,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    DuplicateTale,
    SiteKeyCard,
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
    .zone-edit {
      align-self: flex-start;
      margin-top: var(--space-2);
    }
    .key-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
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
    /* A tale's schedule chip on its card: above the title, on a dark plate so it reads over any media. */
    .window-chip--card {
      margin: 0 0 var(--space-1);
      border-color: transparent;
      background: rgb(0 0 0 / 62%);
      color: #fff;
      font-size: 11px;
    }
  `,
})
export class ZoneDetailPage {
  protected readonly store = inject(DashboardStore);
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** Bound from the `:zoneId` route parameter. */
  readonly zoneId = input.required<string>();
  /** Bound from the `?tab=` query parameter: the selected tab, the default when missing (epic UX rework R9). */
  readonly tab = input<string | undefined>();

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

  protected readonly maxTales = MAX_TALES_PER_GROUP;
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
  /** The zone's active key (prefix and date only), or null. */
  protected readonly zoneKey = computed(() => this.store.zoneKey(this.zoneId()));

  /** The other zones a group is placed in, for its "Also in: …" line (AD-14). */
  protected otherZones(group: TaleGroup): Zone[] {
    return group.zoneIds.flatMap((id) => {
      const zone = id === this.zoneId() ? undefined : this.store.zone(id);
      return zone ? [zone] : [];
    });
  }

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
      // An Off group's switch; with every group On, the first group's name, whose row says why it
      // is not visible; with no group, "New tale group".
      this.selectTab(step.tab, (root) =>
        first(
          root,
          '#zone-panel-groups .group [role=switch][aria-checked=false]',
          '#zone-panel-groups .group h4',
          '#zone-panel-groups .empty .btn--primary',
        ),
      );
    }
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
  protected readonly windowChip = windowChip;
  /** A tale card's chip: one bound, short; the tale drawer shows the whole window. */
  protected cardChip(tale: Tale): string {
    return windowChip(tale, new Date(), 'short');
  }

  /** The ⋯ menu of a group row; story 10 moves the row's other actions into it (epic UX rework R8, R10). */
  protected readonly groupMenu: readonly MenuItem[] = [{ id: 'schedule', label: 'Schedule' }];
  /** The ⋯ menu of a tale card (epic UX rework R8, R11). */
  protected readonly taleMenu: readonly MenuItem[] = [
    { id: 'schedule', label: 'Schedule' },
    { id: 'duplicate', label: 'Duplicate' },
  ];

  /** Does what a group's ⋯ menu item says; a drawer it opens returns focus to the menu's button. */
  protected groupPicked(group: TaleGroup, pick: MenuPick): void {
    if (pick.id === 'schedule') {
      this.store.openDrawer({ kind: 'schedule', target: 'taleGroup', id: group.id }, pick.opener);
    }
  }

  /** Does what a tale's ⋯ menu item says; a drawer it opens returns focus to the menu's button. */
  protected talePicked(tale: Tale, pick: MenuPick): void {
    if (pick.id === 'schedule') this.store.openDrawer({ kind: 'schedule', target: 'tale', id: tale.id }, pick.opener);
    if (pick.id === 'duplicate') this.duplicating.set({ tale, opener: pick.opener });
  }

  /** "On" or "Off" for a group, "Shown" or "Hidden" for a tale, from its stored key (AD-6 amended). */
  protected shownLabel(stored: ContentStatus, kind: StatusKind): string {
    return SHOWN_STATUS_LABELS[kind === 'group' ? groupShownStatus(stored) : taleShownStatus(stored)];
  }

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
