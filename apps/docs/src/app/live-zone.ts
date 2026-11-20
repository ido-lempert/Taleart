import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, input, signal, viewChild } from '@angular/core';

/**
 * The Web SDK the live examples load: an exact published build on jsDelivr (npm `@lempert/taleart`). An exact version is
 * cached for good, so a new release never leaves a stale copy behind; bump it when the docs should use a newer SDK.
 */
export const LIVE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@lempert/taleart@0.1.2/index.js';

/** What the live examples use of the SDK: its page handle, set when the module loads. */
export interface LiveSdk {
  validateZone(json: unknown): { ok: true } | { ok: false; errors: string[] };
}

type LiveElement = HTMLElement & { data: unknown };

let loading: Promise<LiveSdk | null> | undefined;

/**
 * Loads the built Web SDK once per page. Resolves to its page handle, or null when it did not load (the static page
 * stays readable). Only the browser runs it: a prerendered page never imports the module.
 */
export function loadLiveSdk(): Promise<LiveSdk | null> {
  loading ??= (async () => {
    try {
      await import(/* @vite-ignore */ LIVE_SDK_URL);
      return (globalThis as unknown as { Taleart?: LiveSdk }).Taleart ?? null;
    } catch {
      return null;
    }
  })();
  return loading;
}

/** A `<taleart-view>` that shows `zone` with no request: the element's data is the zone itself. */
export function liveZoneElement(zone: unknown, attributes: Readonly<Record<string, string>> = {}): LiveElement {
  const element = document.createElement('taleart-view') as LiveElement;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.data = zone;
  return element;
}

/**
 * A live example: one `<taleart-view>` rendered by the real Web SDK from hard-coded zone data, with no zone key and
 * no request to the Delivery API. Give it a zone from `live-zones.ts` (or any zone JSON object) and, optionally, the
 * element's attributes (`frequency`, `dir`, `locale`, `theme`, `fallback`).
 */
@Component({
  selector: 'docs-live-zone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .live {
      border: 1px solid var(--docs-border, #d0d7de);
      border-radius: 12px;
      padding: 16px;
      margin: 16px 0;
    }
    .live--plain {
      border: 0;
      padding: 0;
      margin: 0;
    }
    .live__caption {
      font-size: 0.8125rem;
      margin: 0 0 8px;
      opacity: 0.75;
    }
    .live__host {
      min-height: 120px;
    }
    .live__status {
      font-size: 0.75rem;
      margin: 8px 0 0;
      opacity: 0.6;
    }
  `,
  template: `
    <figure class="live" [class.live--plain]="plain()" [attr.aria-label]="label()">
      @if (caption()) {
        <figcaption class="live__caption">{{ caption() }}</figcaption>
      }
      <div #host class="live__host" [style.min-height.px]="minHeight()"></div>
      <p class="live__status" role="status">{{ status() }}</p>
    </figure>
  `,
})
export class DocsLiveZone {
  /** The zone JSON (the body of `GET /delivery/v1/zone`), hard-coded in the docs. */
  readonly zone = input.required<unknown>();
  /** The element's attributes, such as `{ frequency: 'once' }`. */
  readonly attributes = input<Readonly<Record<string, string>>>({});
  readonly caption = input('');
  readonly label = input('A live example');
  readonly minHeight = input(120);
  /** No border or padding: for a live example already inside a card. */
  readonly plain = input(false);

  protected readonly status = signal('Loading the Web SDK…');
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  constructor() {
    afterNextRender(() => void this.render());
  }

  private async render(): Promise<void> {
    const sdk = await loadLiveSdk();
    if (!sdk) {
      this.status.set('The live example needs JavaScript and the Web SDK, which did not load.');
      return;
    }
    if (typeof sdk.validateZone !== 'function') {
      this.status.set('The Web SDK on the CDN does not read zone data yet, so this example stays empty.');
      return;
    }
    this.host().nativeElement.replaceChildren(liveZoneElement(this.zone(), this.attributes()));
    this.status.set('Rendered by the Web SDK from the data in this page, with no request.');
  }
}
