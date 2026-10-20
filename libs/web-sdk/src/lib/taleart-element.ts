import type { DeliveryZone } from '@taleart/contract';
import { BAR_FRAME_TYPE, BAR_STYLES, renderBar, setItemSeen } from './bar';
import { fetchZone } from './delivery-client';
import { markGroupSeen, seenGroupIds } from './seen';
import { TaleViewer, VIEWER_STYLES } from './viewer';

export const TALEART_ELEMENT_TAG = 'taleart-view';

const API_URL_ATTR = 'api-url';
const ZONE_KEY_ATTR = 'zone-key';

/**
 * `<taleart-view api-url="…" zone-key="…">`: reads its zone from the Delivery
 * API with the zone key and renders the zone's first bar frame in its Shadow
 * DOM. Frame types it does not know are skipped (AD-5). A refused key or a
 * network failure renders nothing and logs one console error. Activating a
 * bar item opens its tale group in the full-screen viewer; groups this
 * browser has viewed show the seen ring.
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
  // The group whose item takes focus after a reload that closed an open viewer.
  private pendingFocus: string | null = null;

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
    const { apiUrl, zoneKey } = this;
    // A reload while the viewer is open puts focus back on the new bar once it renders.
    const focusGroup = this.closeViewer() ?? this.pendingFocus;
    this.pendingFocus = focusGroup;
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

  private render(zone: DeliveryZone, focusGroup: string | null): void {
    this.pendingFocus = null;
    const frame = zone.frames.find((f) => f.type === BAR_FRAME_TYPE);
    if (!frame) return;
    const style = document.createElement('style');
    style.textContent = BAR_STYLES + VIEWER_STYLES;
    const bar = renderBar(zone.taleGroups, seenGroupIds());
    const items = new Map<string, HTMLButtonElement>();
    for (const button of bar.querySelectorAll<HTMLButtonElement>('button.item')) {
      items.set(button.dataset['taleGroupId'] ?? '', button);
    }
    const names = new Map(zone.taleGroups.map((group) => [group.id, group.name]));
    const viewer = new TaleViewer(this.root, zone.taleGroups, {
      onGroupShown: (groupId) => {
        markGroupSeen(groupId);
        const item = items.get(groupId);
        if (item) setItemSeen(item, names.get(groupId) ?? '', true);
      },
      // Focus goes back to the bar item of the group shown last.
      onClose: (groupId) => items.get(groupId)?.focus(),
    });
    bar.addEventListener('click', (e) => {
      const item = (e.target as Element | null)?.closest<HTMLButtonElement>('button.item');
      if (item && this.viewer === viewer) viewer.open(item.dataset['taleGroupId'] ?? '');
    });
    this.viewer = viewer;
    this.root.replaceChildren(style, bar);
    if (focusGroup !== null) (items.get(focusGroup) ?? bar.querySelector<HTMLButtonElement>('button.item'))?.focus();
  }
}

export function defineTaleartElement(tag = TALEART_ELEMENT_TAG): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, TaleartElement);
  }
}
