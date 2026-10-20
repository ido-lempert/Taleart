import type { DeliveryZone } from '@taleart/contract';
import { BAR_FRAME_TYPE, BAR_STYLES, renderBar } from './bar';
import { fetchZone } from './delivery-client';

export const TALEART_ELEMENT_TAG = 'taleart-view';

const API_URL_ATTR = 'api-url';
const ZONE_KEY_ATTR = 'zone-key';

/**
 * `<taleart-view api-url="…" zone-key="…">`: reads its zone from the Delivery
 * API with the zone key and renders the zone's first bar frame in its Shadow
 * DOM. Frame types it does not know are skipped (AD-5). A refused key or a
 * network failure renders nothing and logs one console error.
 */
export class TaleartElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return [API_URL_ATTR, ZONE_KEY_ATTR];
  }

  private readonly root = this.attachShadow({ mode: 'open' });
  // Bumped on every load, so only the latest response renders.
  private loadId = 0;
  private scheduled = false;

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
    this.root.replaceChildren();
    if (!apiUrl || !zoneKey || !this.isConnected) return;
    // Nothing escapes as an unhandled rejection: any failure renders nothing and logs once.
    try {
      const zone = await fetchZone(apiUrl, zoneKey);
      if (id === this.loadId) this.render(zone);
    } catch (err) {
      if (id !== this.loadId) return;
      this.root.replaceChildren();
      console.error(`TaleArt: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private render(zone: DeliveryZone): void {
    const frame = zone.frames.find((f) => f.type === BAR_FRAME_TYPE);
    if (!frame) return;
    const style = document.createElement('style');
    style.textContent = BAR_STYLES;
    this.root.replaceChildren(style, renderBar(zone.taleGroups));
  }
}

export function defineTaleartElement(tag = TALEART_ELEMENT_TAG): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, TaleartElement);
  }
}
