import { tagRulePasses, viewerTagSet, type DeliveryZone } from '@taleart/contract';
import { BANNER_FRAME_TYPE, BANNER_STYLES, renderBanner } from './banner';
import {
  applyCoverMotion,
  BAR_FRAME_TYPE,
  BAR_STYLES,
  COVER_MOTION_MS,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  renderBar,
  setItemSeen,
} from './bar';
import { fetchZone, type ZoneRequest } from './delivery-client';
import { coversInView, FIRST_CONTENT_MARK, holdMedia, loadFirstContent, mark, ZONE_MARK } from './first-content';
import type { Theme } from './public-types';
import { markGroupSeen, seenGroupIds } from './seen';
import { applyTheme, readThemeOverride } from './theme';
import { TaleViewer, VIEWER_STYLES } from './viewer';

export const TALEART_ELEMENT_TAG = 'taleart-view';

const API_URL_ATTR = 'api-url';
const SITE_KEY_ATTR = 'site-key';
const ZONE_ATTR = 'zone';
// A site key a page may pass by mistake: a warning names it by its start only. A zone slug never
// holds `_`, so the two never meet.
const SITE_KEY_PREFIX = 'tas_';
// The attribute of the zone keys removed in UX rework story 8.7, named only to warn a page that still uses it.
const REMOVED_KEY_ATTR = 'zone' + '-key';
const THEME_ATTR = 'theme';

/** The SDK configuration of a zone, passed to {@link configureZone}. */
export interface ZoneOptions {
  /** Theme fields for every element of the zone; each one set wins over the project's theme (R9). */
  theme?: Partial<Theme> | null;
}

// The checked theme overrides set with configureZone, by zone slug, and the connected
// elements they restyle.
const zoneThemes = new Map<string, Readonly<Partial<Theme>>>();
const connected = new Set<TaleartElement>();

/**
 * Configures a zone for every `<taleart-view>` that shows it, now and later
 * (R9). `zone` is the zone's slug, as in `zone="home-top"` (epic UX rework
 * R3). `theme` holds theme fields that win over the project's theme for that
 * zone; an element's own `theme` wins over them. Calling again replaces the
 * zone's configuration; `configureZone(zone)` or `configureZone(zone, {})`
 * removes it. Rendered elements restyle at once, without a new request.
 * Invalid fields are ignored with one console warning each, naming the zone by
 * its slug, or a site key passed by mistake by its start (`tas_…`) only.
 */
export function configureZone(zone: string, options?: ZoneOptions | null): void {
  if (typeof zone !== 'string' || !zone) {
    console.warn('TaleArt: configureZone needs a zone slug; the configuration is ignored');
    return;
  }
  const name = zone.startsWith(SITE_KEY_PREFIX) ? `${zone.slice(0, 8)}…` : zone;
  const theme = readThemeOverride(options?.theme, `the theme of zone "${name}"`);
  if (Object.keys(theme).length) zoneThemes.set(zone, theme);
  else zoneThemes.delete(zone);
  for (const element of connected) element.retheme();
}

// The viewer's tags set with setTags, as the tag rule compares them; null until a page sets some.
let viewerTags: ReadonlySet<string> | null = null;

/**
 * Tells the SDK the viewer's tags, for every `<taleart-view>` on the page, now
 * and later (epic targeting R2). A tale group with targeting tags shows only
 * when its rule passes: with Any, one of its tags is among these; with All,
 * every one is. Case and surrounding spaces are ignored. A group without tags
 * always shows, and so does every group while no tags are set: before any
 * call, after `setTags(null)` or `setTags([])`. Calling again replaces the
 * tags; rendered elements show the matching groups at once, without a new
 * request. The tags stay in the browser: they are never sent to TaleArt
 * (AD-13). A value that is not an array is ignored with one console warning.
 */
export function setTags(tags: readonly string[] | null): void {
  if (tags != null && !Array.isArray(tags)) {
    console.warn('TaleArt: setTags needs an array of tag names, or null; the tags are ignored');
    return;
  }
  viewerTags = viewerTagSet(tags);
  for (const element of connected) element.retarget();
}

// The zone with only the tale groups whose tag rule passes for the viewer's tags.
function targeted(zone: DeliveryZone): DeliveryZone {
  return { ...zone, taleGroups: zone.taleGroups.filter((group) => tagRulePasses(group, viewerTags)) };
}

// The ids of a zone's groups, as one string, to tell whether a render would change.
function groupKey(zone: DeliveryZone): string {
  return zone.taleGroups.map((group) => group.id).join('\n');
}

// What an element asks the Delivery API for, and the name its zone configuration is set under
// (the slug); null while the site key or the slug is missing.
function zoneRequest(element: TaleartElement): { request: ZoneRequest; configName: string } | null {
  const { siteKey, zone } = element;
  return siteKey && zone ? { request: { key: siteKey, zone }, configName: zone } : null;
}

// The rendered display: its element, and how it takes focus back for a group (its first item for null).
interface DisplayView {
  readonly element: HTMLElement;
  focus(groupId: string | null): boolean;
  destroy?(): void;
}

/**
 * `<taleart-view api-url="…" site-key="…" zone="home-top">`: reads the
 * zone with that slug from the Delivery API with the project's site key
 * (epic UX rework R3; several elements share one site key, and elements that
 * ask for the same zone at once share one request). It renders the
 * zone in its Shadow DOM: its
 * display, a bar or a banner (AD-17); a zone without a display renders
 * nothing. Frame types it does not know are skipped (AD-5). A refused key, an unknown slug or a
 * network failure renders nothing and logs one console error. Activating a bar item or a
 * banner slide opens its tale group in the full-screen viewer; groups this
 * browser has viewed show the seen ring in the bar. The zone's project theme
 * (R9) styles the display and the viewer through CSS custom properties on a
 * wrapper inside the Shadow DOM; each theme field set in the SDK
 * configuration wins over it: the element's `theme` property (or `theme`
 * attribute, JSON), then the zone's {@link configureZone} option.
 */
export class TaleartElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [API_URL_ATTR, SITE_KEY_ATTR, ZONE_ATTR, THEME_ATTR];
  }

  private readonly root = this.attachShadow({ mode: 'open' });
  // Bumped on every load, so only the latest response renders.
  private loadId = 0;
  private scheduled = false;
  private viewer: TaleViewer | null = null;
  private view: DisplayView | null = null;
  // The group that takes focus after a reload that closed an open viewer.
  private pendingFocus: string | null = null;
  // The visitor's reduced-motion setting, watched while connected so animated covers follow it (R11, R12).
  private motionQuery: MediaQueryList | null = null;
  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    applyCoverMotion(this.root, event.matches);
    this.limitCoverMotion();
  };
  // Stops animated covers COVER_MOTION_MS after they start moving (WCAG 2.2.2).
  private coverTimer: ReturnType<typeof setTimeout> | undefined;
  // This element's checked, frozen theme override, and the rendered wrapper with the name its
  // zone configuration is set under (its slug) and the theme the Delivery API sent.
  private themeOverride: Readonly<Partial<Theme>> = Object.freeze({});
  private themed: { element: HTMLElement; configName: string; theme: unknown } | null = null;
  // True while the `theme` attribute present at upgrade is to be skipped, because a script set the property first.
  private skipThemeAttribute = false;
  // True once this element has set its zone mark, and its first-content mark (for a render still on the page).
  private zoneMarked = false;
  // True once this element has warned about the removed zone key attribute (once per element).
  private warnedRemovedKey = false;
  private marked = false;
  // Aborts the current render's first-content work (loadFirstContent).
  private renderAbort: AbortController | null = null;
  // The last zone the Delivery API sent, with its configuration name, so new viewer tags render
  // without a new request; and the groups rendered from it.
  private loaded: { zone: DeliveryZone; configName: string } | null = null;
  private renderedKey: string | null = null;
  // True while new viewer tags wait for the open viewer to close: its group still matches them.
  private retargetOnClose = false;

  constructor() {
    super();
    // A theme set on the element before the SDK defined it shadows the accessor: take it out and
    // pass it through the setter. Set by script, it wins over a `theme` attribute present at
    // upgrade, which is then left unread (and logs nothing).
    if (Object.prototype.hasOwnProperty.call(this, 'theme')) {
      const value: unknown = (this as { theme?: unknown }).theme;
      delete (this as { theme?: unknown }).theme;
      this.skipThemeAttribute = this.hasAttribute(THEME_ATTR);
      this.theme = value as Partial<Theme> | null;
    }
  }

  /**
   * Theme fields for this element only, winning over the zone's
   * {@link configureZone} theme and the project's theme (R9). Set an object of
   * theme fields, or `null` to remove it. The value is copied, checked and
   * kept when set: invalid fields are ignored with one console warning each.
   * Reading it returns a copy of this element's own override fields that
   * passed (not the zone's or the project's).
   */
  get theme(): Partial<Theme> {
    const own = { ...this.themeOverride };
    if (own.ringColors) own.ringColors = [...own.ringColors];
    return own;
  }
  set theme(value: Partial<Theme> | null) {
    this.themeOverride = readThemeOverride(value, "the element's theme");
    this.retheme();
  }

  /** Shows the groups that match the viewer's tags again (setTags), without a new request. */
  retarget(): void {
    const loaded = this.loaded;
    if (!loaded || !this.isConnected) return;
    const zone = targeted(loaded.zone);
    // The same groups: the display, and an open viewer, stay as they are.
    if (groupKey(zone) === this.renderedKey) {
      this.retargetOnClose = false;
      return;
    }
    // An open viewer whose group still matches stays open; the display follows when it closes.
    // One whose group no longer matches closes, and focus goes to the display.
    const open = this.viewer?.groupId ?? null;
    if (open !== null && zone.taleGroups.some((group) => group.id === open)) {
      this.retargetOnClose = true;
      return;
    }
    this.render(zone, this.clear(), loaded.configName);
  }

  /** Applies the theme again with the current SDK configuration, without a new request. */
  retheme(): void {
    const themed = this.themed;
    if (themed) applyTheme(themed.element, themed.theme, zoneThemes.get(themed.configName) ?? {}, this.themeOverride);
  }

  /** The TaleArt API origin, such as `https://api.example.com`. */
  get apiUrl(): string {
    return this.getAttribute(API_URL_ATTR) ?? '';
  }
  set apiUrl(value: string) {
    this.setAttribute(API_URL_ATTR, value);
  }

  /** The project's site key (`tas_…`) issued in the dashboard; one for every zone of the project. */
  get siteKey(): string {
    return this.getAttribute(SITE_KEY_ATTR) ?? '';
  }
  set siteKey(value: string) {
    this.setAttribute(SITE_KEY_ATTR, value);
  }

  /** The zone's slug, such as `home-top`, read with {@link siteKey}. */
  get zone(): string {
    return this.getAttribute(ZONE_ATTR) ?? '';
  }
  set zone(value: string) {
    this.setAttribute(ZONE_ATTR, value);
  }

  connectedCallback(): void {
    connected.add(this);
    if (!this.warnedRemovedKey && this.hasAttribute(REMOVED_KEY_ATTR)) {
      this.warnedRemovedKey = true;
      console.warn(
        `TaleArt: the ${REMOVED_KEY_ATTR} attribute is no longer supported; place the zone with site-key and zone`,
      );
    }
    if (typeof matchMedia === 'function') {
      const query = matchMedia(REDUCED_MOTION_QUERY);
      this.motionQuery = query;
      // Safari before 14 has only the older addListener.
      if (typeof query.addEventListener === 'function') query.addEventListener('change', this.onMotionChange);
      else query.addListener?.(this.onMotionChange);
    }
    this.scheduleLoad();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === THEME_ATTR) {
      if (this.skipThemeAttribute) this.skipThemeAttribute = false;
      else this.theme = this.parseThemeAttribute(newValue) as Partial<Theme> | null;
    } else if (this.isConnected) this.scheduleLoad();
  }

  // The `theme` attribute's JSON. A missing or empty attribute is no override; text that is not
  // JSON, or JSON `null`, is none either, with one warning (other non-objects warn in the setter).
  private parseThemeAttribute(value: string | null): unknown {
    if (value === null || value.trim() === '') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      console.warn("TaleArt: the element's theme attribute is not valid JSON; it is ignored");
      return null;
    }
    if (parsed === null) console.warn("TaleArt: the element's theme attribute must be a JSON object; it is ignored");
    return parsed;
  }

  disconnectedCallback(): void {
    connected.delete(this);
    const query = this.motionQuery;
    if (query && typeof query.removeEventListener === 'function') query.removeEventListener('change', this.onMotionChange);
    else query?.removeListener?.(this.onMotionChange);
    this.motionQuery = null;
    this.loadId++;
    // Held pictures of the render stay held: a removed element starts no downloads.
    this.stopFirstContent();
    this.closeViewer();
    this.destroyView();
  }

  // Animated covers that move (no reduced motion) stop on their first frame after COVER_MOTION_MS.
  private limitCoverMotion(): void {
    clearTimeout(this.coverTimer);
    this.coverTimer = undefined;
    if (prefersReducedMotion() || !this.root.querySelector('.cover[data-animated]')) return;
    this.coverTimer = setTimeout(() => {
      this.coverTimer = undefined;
      applyCoverMotion(this.root, true);
    }, COVER_MOTION_MS);
  }

  // Stops the current render's first-content work: its timer, listeners, releases and mark.
  private stopFirstContent(): void {
    clearTimeout(this.coverTimer);
    this.coverTimer = undefined;
    this.renderAbort?.abort();
    this.renderAbort = null;
  }

  // Closes the viewer; returns the group it showed, or null when it was not open.
  private closeViewer(): string | null {
    const viewer = this.viewer;
    this.viewer = null;
    const groupId = viewer?.groupId ?? null;
    viewer?.close();
    return groupId;
  }

  // Setting both attributes in one task loads once.
  private scheduleLoad(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.load();
    });
  }

  private async load(): Promise<void> {
    const id = ++this.loadId;
    const { apiUrl } = this;
    const named = zoneRequest(this);
    this.loaded = null;
    const focusGroup = this.clear();
    if (!apiUrl || !named || !this.isConnected) return;
    // Nothing escapes as an unhandled rejection: any failure renders nothing and logs once.
    try {
      const zone = await fetchZone(apiUrl, named.request);
      if (id !== this.loadId) return;
      if (!this.zoneMarked) {
        this.zoneMarked = true;
        mark(ZONE_MARK);
      }
      this.loaded = { zone, configName: named.configName };
      this.render(targeted(zone), focusGroup, named.configName);
    } catch (err) {
      if (id !== this.loadId) return;
      this.root.replaceChildren();
      console.error(`TaleArt: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Takes the rendered display and viewer off; returns the group that takes focus once the next
  // render is on the page (a reload or new tags while the viewer is open put focus back on the display).
  private clear(): string | null {
    const focusGroup = this.closeViewer() ?? this.pendingFocus;
    this.pendingFocus = focusGroup;
    this.stopFirstContent();
    this.destroyView();
    this.root.replaceChildren();
    this.themed = null;
    this.renderedKey = null;
    this.retargetOnClose = false;
    return focusGroup;
  }

  // Renders the zone's display (AD-17) when the SDK knows its type; unknown types are skipped (AD-5).
  private render(zone: DeliveryZone, focusGroup: string | null, configName: string): void {
    this.pendingFocus = null;
    this.renderedKey = groupKey(zone);
    // The response is untrusted: anything but an object reads as no display.
    const frame = typeof zone.frame === 'object' && zone.frame !== null ? zone.frame : null;
    const names = new Map(zone.taleGroups.map((group) => [group.id, group.name]));
    const seen = seenGroupIds();
    // Holds the display and the viewer, so both inherit the theme's custom properties.
    const themed = document.createElement('div');
    themed.className = 'taleart';
    this.themed = { element: themed, configName, theme: zone.theme };
    this.retheme();
    let barItems: Map<string, HTMLButtonElement> | null = null;
    // The display's item or slide of the group shown last takes focus back when the viewer closes.
    let view: DisplayView | null = null;
    const viewer = new TaleViewer(themed, zone.taleGroups, {
      onGroupShown: (groupId) => {
        markGroupSeen(groupId);
        const item = barItems?.get(groupId);
        if (item) setItemSeen(item, names.get(groupId) ?? '', true);
      },
      onClose: (groupId) => {
        // New viewer tags arrived while it was open: show the matching groups now, focus on this one.
        if (this.retargetOnClose && this.viewer === viewer) {
          this.retargetOnClose = false;
          this.viewer = null;
          this.pendingFocus = groupId;
          this.retarget();
          return;
        }
        view?.focus(groupId);
      },
    });
    const open = (groupId: string) => {
      if (this.viewer === viewer) viewer.open(groupId);
    };

    if (frame?.type === BAR_FRAME_TYPE) {
      // Cover pictures are held until the first content is laid out (loadFirstContent).
      const bar = holdMedia(() => renderBar(zone.taleGroups, seen, frame.settings));
      const items = new Map<string, HTMLButtonElement>();
      for (const button of bar.querySelectorAll<HTMLButtonElement>('button.item')) {
        items.set(button.dataset['taleGroupId'] ?? '', button);
      }
      barItems = items;
      view = {
        element: bar,
        focus: (groupId) => {
          const item = groupId === null ? bar.querySelector<HTMLButtonElement>('button.item') : items.get(groupId);
          item?.focus();
          return !!item;
        },
      };
      bar.addEventListener('click', (e) => {
        const item = (e.target as Element | null)?.closest<HTMLButtonElement>('button.item');
        if (item) open(item.dataset['taleGroupId'] ?? '');
      });
    } else if (frame?.type === BANNER_FRAME_TYPE) {
      const banner = holdMedia(() =>
        renderBanner(zone.taleGroups, frame.settings, (groupId) => {
          if (view) open(groupId);
        }),
      );
      if (banner) {
        view = {
          element: banner.element,
          focus: (groupId) => banner.focus(groupId),
          destroy: () => banner.destroy(),
        };
      }
    }
    this.view = view;
    if (!view) return;
    const style = document.createElement('style');
    style.textContent = BAR_STYLES + BANNER_STYLES + VIEWER_STYLES;
    this.viewer = viewer;
    themed.replaceChildren(view.element);
    this.root.replaceChildren(style, themed);
    this.limitCoverMotion();
    // The display's covers in view load first, then the rest of this render's pictures; the
    // first zone content this element shows is marked once, when it is on the page (NFR-006).
    const abort = new AbortController();
    this.renderAbort = abort;
    void loadFirstContent(themed, coversInView(view.element), abort.signal, () => {
      if (this.marked) return;
      this.marked = true;
      mark(FIRST_CONTENT_MARK);
    });
    // The group's item or slide, or else the display's first one.
    if (focusGroup !== null && !view.focus(focusGroup)) view.focus(null);
  }

  // Stops the timers of the rendered display.
  private destroyView(): void {
    this.view?.destroy?.();
    this.view = null;
  }
}

export function defineTaleartElement(tag = TALEART_ELEMENT_TAG): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, TaleartElement);
  }
}
