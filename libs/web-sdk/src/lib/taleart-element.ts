import type { DeliveryFrame, DeliveryZone, Theme } from '@taleart/contract';
import { BANNER_FRAME_TYPE, BANNER_STYLES, renderBanner } from './banner';
import { applyCoverMotion, BAR_FRAME_TYPE, BAR_STYLES, renderBar, setItemSeen } from './bar';
import { fetchZone } from './delivery-client';
import { markGroupSeen, seenGroupIds } from './seen';
import { applyTheme, readThemeOverride } from './theme';
import { TaleViewer, VIEWER_STYLES } from './viewer';

export const TALEART_ELEMENT_TAG = 'taleart-view';

const API_URL_ATTR = 'api-url';
const ZONE_KEY_ATTR = 'zone-key';
const STAGE_ATTR = 'stage';
const THEME_ATTR = 'theme';

/** The SDK configuration of a zone, passed to {@link configureZone}. */
export interface ZoneOptions {
  /** Theme fields for every element of the zone; each one set wins over the project's theme (R9). */
  theme?: Partial<Theme> | null;
}

// The checked theme overrides set with configureZone, by zone key, and the connected elements they restyle.
const zoneThemes = new Map<string, Partial<Theme>>();
const connected = new Set<TaleartElement>();

/**
 * Configures a zone for every `<taleart-view>` with its zone key, now and
 * later (R9): `theme` holds theme fields that win over the project's theme
 * for that zone; an element's own `theme` wins over them. Calling again
 * replaces the zone's configuration; `configureZone(key, {})` removes it.
 * Rendered elements restyle at once, without a new request. Invalid fields
 * are ignored with one console warning each.
 */
export function configureZone(zoneKey: string, options?: ZoneOptions | null): void {
  if (typeof zoneKey !== 'string' || !zoneKey) {
    console.warn('TaleArt: configureZone needs a zone key; the configuration is ignored');
    return;
  }
  zoneThemes.set(zoneKey, readThemeOverride(options?.theme, 'the theme configured for the zone'));
  for (const element of connected) if (element.zoneKey === zoneKey) element.retheme();
}

interface FocusTarget {
  groupId: string;
  frameId: string | null;
}

// A rendered frame: its element, and how it takes focus back for a group (its first item for null).
interface FrameView {
  readonly frameId: string;
  readonly element: HTMLElement;
  focus(groupId: string | null): boolean;
  destroy?(): void;
}

/**
 * `<taleart-view api-url="…" zone-key="…" stage="…">`: reads its zone from the
 * Delivery API with the zone key and renders the zone in its Shadow DOM: its
 * bar and banner frames, in the zone's frame order, or with `stage` only the
 * frame of that stage (R7); an unknown stage renders nothing and logs one
 * console warning. Frame types it does not know are skipped (AD-5). A refused key or a network failure
 * renders nothing and logs one console error. Activating a bar item or a
 * banner slide opens its tale group in the full-screen viewer; groups this
 * browser has viewed show the seen ring in the bar. The zone's project theme
 * (R9) styles the frames and the viewer through CSS custom properties on a
 * wrapper inside the Shadow DOM; each theme field set in the SDK
 * configuration wins over it: the element's `theme` property (or `theme`
 * attribute, JSON), then the zone's {@link configureZone} option.
 */
export class TaleartElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [API_URL_ATTR, ZONE_KEY_ATTR, STAGE_ATTR, THEME_ATTR];
  }

  private readonly root = this.attachShadow({ mode: 'open' });
  // Bumped on every load, so only the latest response renders.
  private loadId = 0;
  private scheduled = false;
  private viewer: TaleViewer | null = null;
  private views: FrameView[] = [];
  // The group, and the frame that opened the viewer, that take focus after a reload that closed an open viewer.
  private pendingFocus: FocusTarget | null = null;
  // The frame whose item or slide opened the viewer, kept across reloads.
  private openerFrameId: string | null = null;
  // The visitor's reduced-motion setting, watched while connected so animated covers follow it (R11, R12).
  private motionQuery: MediaQueryList | null = null;
  private readonly onMotionChange = (event: MediaQueryListEvent): void => applyCoverMotion(this.root, event.matches);
  // This element's checked theme override, and the rendered wrapper with the theme the Delivery API sent.
  private themeOverride: Partial<Theme> = {};
  private themed: { element: HTMLElement; theme: unknown } | null = null;

  /**
   * Theme fields for this element only, winning over the zone's
   * {@link configureZone} theme and the project's theme (R9). Set an object of
   * theme fields, or `null` to remove it; reading it returns the fields in
   * effect. The value is checked and copied when set: invalid fields are
   * ignored with one console warning each.
   */
  get theme(): Partial<Theme> {
    return { ...this.themeOverride };
  }
  set theme(value: Partial<Theme> | null) {
    this.themeOverride = readThemeOverride(value, "the element's theme");
    this.retheme();
  }

  /** Applies the theme again with the current SDK configuration, without a new request. */
  retheme(): void {
    const themed = this.themed;
    if (themed) applyTheme(themed.element, themed.theme, zoneThemes.get(this.zoneKey) ?? {}, this.themeOverride);
  }

  /** The TaleArt API origin, such as `https://api.example.com`. */
  get apiUrl(): string {
    return this.getAttribute(API_URL_ATTR) ?? '';
  }
  set apiUrl(value: string) {
    this.setAttribute(API_URL_ATTR, value);
  }

  /** The zone key (`tak_…`) issued in the dashboard. */
  get zoneKey(): string {
    return this.getAttribute(ZONE_KEY_ATTR) ?? '';
  }
  set zoneKey(value: string) {
    this.setAttribute(ZONE_KEY_ATTR, value);
  }

  /** The key of the zone's stage to render, such as `home-top`; empty renders every frame of the zone. */
  get stage(): string {
    return this.getAttribute(STAGE_ATTR) ?? '';
  }
  set stage(value: string) {
    this.setAttribute(STAGE_ATTR, value);
  }

  connectedCallback(): void {
    connected.add(this);
    // A theme set on the element before the SDK defined it shadows the accessor: pass it through.
    if (Object.prototype.hasOwnProperty.call(this, 'theme')) {
      const value = (this as { theme?: Partial<Theme> | null }).theme ?? null;
      delete (this as { theme?: unknown }).theme;
      this.theme = value;
    }
    if (typeof matchMedia === 'function') {
      const query = matchMedia('(prefers-reduced-motion: reduce)');
      this.motionQuery = query;
      // Safari before 14 has only the older addListener.
      if (typeof query.addEventListener === 'function') query.addEventListener('change', this.onMotionChange);
      else query.addListener?.(this.onMotionChange);
    }
    this.scheduleLoad();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === THEME_ATTR) this.theme = this.parseThemeAttribute(newValue);
    else if (this.isConnected) this.scheduleLoad();
  }

  // The `theme` attribute's JSON; null, with one warning, when it does not parse.
  private parseThemeAttribute(value: string | null): Partial<Theme> | null {
    if (value === null) return null;
    try {
      return JSON.parse(value) as Partial<Theme> | null;
    } catch {
      console.warn("TaleArt: the element's theme attribute is not valid JSON; it is ignored");
      return null;
    }
  }

  disconnectedCallback(): void {
    connected.delete(this);
    const query = this.motionQuery;
    if (query && typeof query.removeEventListener === 'function') query.removeEventListener('change', this.onMotionChange);
    else query?.removeListener?.(this.onMotionChange);
    this.motionQuery = null;
    this.loadId++;
    this.closeViewer();
    this.destroyViews();
  }

  // Closes the viewer; returns the group it showed and the frame that opened it, or null when it was not open.
  private closeViewer(): FocusTarget | null {
    const viewer = this.viewer;
    this.viewer = null;
    const groupId = viewer?.groupId ?? null;
    viewer?.close();
    return groupId === null ? null : { groupId, frameId: this.openerFrameId };
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
    const { apiUrl, zoneKey } = this;
    // A reload while the viewer is open puts focus back on the opening frame once it renders.
    const focusGroup = this.closeViewer() ?? this.pendingFocus;
    this.pendingFocus = focusGroup;
    this.destroyViews();
    this.root.replaceChildren();
    this.themed = null;
    if (!apiUrl || !zoneKey || !this.isConnected) return;
    // Nothing escapes as an unhandled rejection: any failure renders nothing and logs once.
    try {
      const zone = await fetchZone(apiUrl, zoneKey);
      if (id === this.loadId) this.render(zone, focusGroup);
    } catch (err) {
      if (id !== this.loadId) return;
      this.root.replaceChildren();
      console.error(`TaleArt: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The frames this element shows: the zone's, or only the named stage's (R7). Null, with one
  // warning, when the zone has no such stage or the stage points to a frame the zone does not
  // have. The response is untrusted: a `stages` that is not an array, and entries that are not
  // objects with a matching string key, are ignored.
  private framesToRender(zone: DeliveryZone): DeliveryFrame[] | null {
    const stageKey = this.stage.trim();
    if (!stageKey) return zone.frames;
    const stages: unknown = (zone as Partial<DeliveryZone>).stages;
    const stage: unknown = Array.isArray(stages)
      ? stages.find((s: unknown) => typeof s === 'object' && s !== null && (s as { key?: unknown }).key === stageKey)
      : undefined;
    if (!stage) {
      console.warn(`TaleArt: the zone has no stage "${stageKey}"; nothing is rendered for it`);
      return null;
    }
    const frameId = (stage as { frameId?: unknown }).frameId;
    const frame = typeof frameId === 'string' ? zone.frames.find((f) => f?.id === frameId) : undefined;
    if (!frame) {
      console.warn(`TaleArt: stage "${stageKey}" points to a frame the zone does not have; nothing is rendered for it`);
      return null;
    }
    return [frame];
  }

  // Renders every frame type the SDK knows, in the zone's frame order, or the named stage's
  // frame; unknown types are skipped (AD-5).
  private render(zone: DeliveryZone, focusTarget: FocusTarget | null): void {
    this.pendingFocus = null;
    const frames = this.framesToRender(zone);
    if (!frames) return;
    const names = new Map(zone.taleGroups.map((group) => [group.id, group.name]));
    const seen = seenGroupIds();
    const views: FrameView[] = [];
    // Holds the frames and the viewer, so both inherit the theme's custom properties.
    const themed = document.createElement('div');
    themed.className = 'taleart';
    this.themed = { element: themed, theme: zone.theme };
    this.retheme();
    const barItems: Map<string, HTMLButtonElement>[] = [];
    // The frame whose bar item or slide opened the viewer takes focus back when it closes.
    let opener: FrameView | null = null;
    const viewer = new TaleViewer(themed, zone.taleGroups, {
      onGroupShown: (groupId) => {
        markGroupSeen(groupId);
        for (const items of barItems) {
          const item = items.get(groupId);
          if (item) setItemSeen(item, names.get(groupId) ?? '', true);
        }
      },
      // Focus goes back to the opening frame's item or slide of the group shown last.
      onClose: (groupId) => opener?.focus(groupId),
    });
    const openFrom = (view: FrameView, groupId: string) => {
      if (this.viewer === viewer && viewer.open(groupId)) {
        opener = view;
        this.openerFrameId = view.frameId;
      }
    };

    for (const frame of frames) {
      if (frame.type === BAR_FRAME_TYPE) {
        const bar = renderBar(zone.taleGroups, seen, frame.settings);
        const items = new Map<string, HTMLButtonElement>();
        for (const button of bar.querySelectorAll<HTMLButtonElement>('button.item')) {
          items.set(button.dataset['taleGroupId'] ?? '', button);
        }
        const view: FrameView = {
          frameId: frame.id,
          element: bar,
          focus: (groupId) => {
            const item = groupId === null ? bar.querySelector<HTMLButtonElement>('button.item') : items.get(groupId);
            item?.focus();
            return !!item;
          },
        };
        bar.addEventListener('click', (e) => {
          const item = (e.target as Element | null)?.closest<HTMLButtonElement>('button.item');
          if (item) openFrom(view, item.dataset['taleGroupId'] ?? '');
        });
        barItems.push(items);
        views.push(view);
      } else if (frame.type === BANNER_FRAME_TYPE) {
        let view: FrameView | null = null;
        const banner = renderBanner(zone.taleGroups, frame.settings, (groupId) => {
          if (view) openFrom(view, groupId);
        });
        if (banner) {
          view = {
            frameId: frame.id,
            element: banner.element,
            focus: (groupId) => banner.focus(groupId),
            destroy: () => banner.destroy(),
          };
          views.push(view);
        }
      }
    }
    this.views = views;
    if (views.length === 0) return;
    const style = document.createElement('style');
    style.textContent = BAR_STYLES + BANNER_STYLES + VIEWER_STYLES;
    this.viewer = viewer;
    themed.replaceChildren(...views.map((view) => view.element));
    this.root.replaceChildren(style, themed);
    if (focusTarget) {
      // The frame that opened the viewer first, then any frame with the group, then the opener's (or the first) frame as it is.
      const { groupId, frameId } = focusTarget;
      const preferred = views.find((view) => view.frameId === frameId);
      if (!preferred?.focus(groupId) && !views.some((view) => view !== preferred && view.focus(groupId))) {
        (preferred ?? views[0]).focus(null);
      }
    }
  }

  // Stops the timers of the rendered frames.
  private destroyViews(): void {
    for (const view of this.views) view.destroy?.();
    this.views = [];
  }
}

export function defineTaleartElement(tag = TALEART_ELEMENT_TAG): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, TaleartElement);
  }
}
