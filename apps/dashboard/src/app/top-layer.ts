/**
 * What the dashboard's top-layer popups share: the ⋯ menu (`MenuButton`), the visibility tooltip
 * (`VisibilityIndicator`) and Tale Studio's layer menu. They show in the top layer as manual
 * popovers, are placed in viewport pixels beside what opened them, and close on a press outside.
 */

/** Shows the element in the top layer, where the browser supports popovers. */
export function showInTopLayer(element: HTMLElement | undefined): void {
  if (element && typeof element.showPopover === 'function') element.showPopover();
}

/** Takes the element out of the top layer; nothing happens when it is closed already. */
export function hideFromTopLayer(element: HTMLElement | undefined): void {
  if (element && typeof element.hidePopover === 'function') {
    try {
      element.hidePopover();
    } catch {
      // Already closed, as when the page removed it.
    }
  }
}

/** The viewport's size in pixels; 1024 by 768 where there is no window. */
export function viewportSize(view: Window | null | undefined): { width: number; height: number } {
  return { width: view?.innerWidth ?? 1024, height: view?.innerHeight ?? 768 };
}

/** Puts a fixed-position element at viewport pixels. */
export function placeAt(element: HTMLElement, at: { left: number; top: number }): void {
  element.style.left = `${at.left}px`;
  element.style.top = `${at.top}px`;
}

/** True when the event's target is not inside `container`. */
export function isOutside(container: Node, event: Event): boolean {
  return !container.contains(event.target as Node | null);
}

/** One listener a popup needs while it is open, on the document or on its window. */
export interface PopupListener {
  on: 'document' | 'window';
  type: string;
  listener: (event: never) => void;
  capture?: boolean;
}

/** The listeners of an open popup: added together when it opens, removed together when it closes. */
export class PopupListeners {
  constructor(
    private readonly document: Document,
    private readonly listeners: readonly PopupListener[],
  ) {}

  add(): void {
    for (const { target, type, listener, capture } of this.each()) target?.addEventListener(type, listener, capture);
  }

  remove(): void {
    for (const { target, type, listener, capture } of this.each()) target?.removeEventListener(type, listener, capture);
  }

  private each() {
    return this.listeners.map(({ on, type, listener, capture }) => ({
      target: on === 'document' ? this.document : this.document.defaultView,
      type,
      listener: listener as EventListener,
      capture: capture ?? false,
    }));
  }
}
