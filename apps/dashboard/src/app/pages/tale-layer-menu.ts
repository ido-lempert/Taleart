import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, input, output } from '@angular/core';
import type { LayerCommand } from './tale-layers';

/** One entry of the layer actions menu. */
export interface LayerMenuItem {
  command: LayerCommand;
  label: string;
  /**
   * The shortcut as people read it, shown beside the label. It works on the canvas and in the
   * layers list, not in the menu, so the item carries no `aria-keyshortcuts`.
   */
  shortcut?: string;
}

/**
 * Tale Studio's layer actions menu (epic Tale Studio R3): the same actions from a layer row's
 * "More actions" button, a right-click, Shift+F10 or the context-menu key. A WAI-ARIA menu: focus
 * starts on the first item, the arrow keys, Home and End move it, Escape and Tab close the menu,
 * and so does a press outside it. On Escape and Tab the page returns focus to whatever opened it.
 */
@Component({
  selector: 'app-tale-layer-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Keys are read on the host: focus is always on one of the items (a WAI-ARIA menu).
  host: {
    '(document:pointerdown)': 'outside($event)',
    '(keydown)': 'onKey($event)',
    // No browser menu over the studio's own.
    '(contextmenu)': '$event.preventDefault()',
  },
  template: `
    <div class="layer-menu" role="menu" [attr.aria-label]="label()" [style.left.px]="x()" [style.top.px]="y()">
      @for (item of items(); track item.command) {
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="layer-menu__item"
          (click)="chosen.emit(item.command)"
        >
          <span>{{ item.label }}</span>
          @if (item.shortcut) {
            <span class="layer-menu__key" aria-hidden="true">{{ item.shortcut }}</span>
          }
        </button>
      }
    </div>
  `,
})
export class TaleLayerMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** The menu's accessible name. */
  readonly label = input('Layer actions');
  readonly items = input.required<readonly LayerMenuItem[]>();
  /** Where the menu opens, in viewport pixels; it is kept inside the viewport. */
  readonly x = input(0);
  readonly y = input(0);
  /** The DOM id of the button that opened the menu: a press on it is left to the button, which toggles the menu. */
  readonly anchorId = input('');
  readonly chosen = output<LayerCommand>();
  /** The menu closes without a choice: `true` when focus should return to what opened it (Escape, Tab). */
  readonly closed = output<boolean>();

  constructor() {
    afterNextRender(() => {
      const menu = this.host.nativeElement.querySelector<HTMLElement>('.layer-menu');
      if (menu) {
        // Kept on screen: moved back by any overflow past the right or bottom edge.
        const rect = menu.getBoundingClientRect();
        const overX = rect.right - window.innerWidth;
        const overY = rect.bottom - window.innerHeight;
        if (overX > 0) menu.style.left = `${Math.max(0, this.x() - overX - 8)}px`;
        if (overY > 0) menu.style.top = `${Math.max(0, this.y() - overY - 8)}px`;
      }
      this.menuItems()[0]?.focus();
    });
  }

  private menuItems(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('[role=menuitem]')];
  }

  /** A press outside the menu closes it, and focus stays where the press put it. */
  protected outside(event: Event): void {
    const menu = this.host.nativeElement.querySelector('.layer-menu');
    const target = event.target as Element | null;
    const anchor = this.anchorId() ? document.getElementById(this.anchorId()) : null;
    if (anchor && target && anchor.contains(target)) return;
    if (menu && !menu.contains(target)) this.closed.emit(false);
  }

  protected onKey(event: KeyboardEvent): void {
    const items = this.menuItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      this.closed.emit(true);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  }
}
