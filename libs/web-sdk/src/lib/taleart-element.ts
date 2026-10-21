import type { DeliveryZone } from '@taleart/contract';
import { BANNER_FRAME_TYPE, BANNER_STYLES, renderBanner } from './banner';
import { BAR_FRAME_TYPE, BAR_STYLES, renderBar, setItemSeen } from './bar';
import { fetchZone } from './delivery-client';
import { markGroupSeen, seenGroupIds } from './seen';
import { TaleViewer, VIEWER_STYLES } from './viewer';

export const TALEART_ELEMENT_TAG = 'taleart-view';

const API_URL_ATTR = 'api-url';
const ZONE_KEY_ATTR = 'zone-key';

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
 * `<taleart-view api-url="…" zone-key="…">`: reads its zone from the Delivery
 * API with the zone key and renders the zone in its Shadow DOM: its bar and
 * banner frames, in the zone's frame order. Frame types it
 * does not know are skipped (AD-5). A refused key or a network failure
 * renders nothing and logs one console error. Activating a bar item or a
 * banner slide opens its tale group in the full-screen viewer; groups this
 * browser has viewed show the seen ring in the bar.
 */
export class TaleartElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [API_URL_ATTR, ZONE_KEY_ATTR];
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

  connectedCallback(): void {
    this.scheduleLoad();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue && this.isConnected) this.scheduleLoad();
  }

  disconnectedCallback(): void {
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

  // Renders every frame type the SDK knows, in the zone's frame order; unknown types are skipped (AD-5).
  private render(zone: DeliveryZone, focusTarget: FocusTarget | null): void {
    this.pendingFocus = null;
    const names = new Map(zone.taleGroups.map((group) => [group.id, group.name]));
    const seen = seenGroupIds();
    const views: FrameView[] = [];
    const barItems: Map<string, HTMLButtonElement>[] = [];
    // The frame whose bar item or slide opened the viewer takes focus back when it closes.
    let opener: FrameView | null = null;
    const viewer = new TaleViewer(this.root, zone.taleGroups, {
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

    for (const frame of zone.frames) {
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
    this.root.replaceChildren(style, ...views.map((view) => view.element));
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
