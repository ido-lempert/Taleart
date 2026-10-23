import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { Icon } from './icon';
import { hideFromTopLayer, isOutside, placeAt, PopupListeners, showInTopLayer, viewportSize } from './top-layer';

let nextId = 0;

/** Closes the one menu open on the page: opening another calls it. */
let closeOpenMenu: (() => void) | null = null;

/** The space between the menu and its button, and the viewport's edge. */
const GAP = 4;

/** One item of a ⋯ menu. An item that cannot apply stays in the menu, disabled, with its reason. */
export interface MenuItem {
  /** What `picked` emits when the item is chosen. */
  id: string;
  label: string;
  /** Why the item cannot apply, such as "Already in every zone"; the item is disabled when set. */
  disabledReason?: string;
}

/** A chosen item, with the menu's button, so a drawer it opens can return focus there. */
export interface MenuPick {
  id: string;
  opener: HTMLElement;
}

/**
 * Where the menu goes, in viewport pixels: below its button, aligned with the button's end edge
 * (its right edge, or its left edge when `rtl`), or above it when there is no room below; kept
 * inside the viewport. A menu taller than the room is placed at the top; its own scroll shows the rest.
 */
export function menuPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  rtl = false,
): { left: number; top: number } {
  const start = rtl ? anchor.left : anchor.right - menu.width;
  const left = Math.max(GAP, Math.min(start, viewport.width - menu.width - GAP));
  const below = anchor.bottom + GAP;
  const top =
    below + menu.height <= viewport.height - GAP ? below : Math.max(GAP, anchor.top - GAP - menu.height);
  return { left, top };
}

/**
 * A ⋯ menu button (WAI-ARIA menu button pattern). The button says what it opens
 * (`aria-haspopup`, `aria-expanded`) and is named by `label`, such as "More for Summer". Enter,
 * Space or Down open the menu on its first item, Up on its last; in the menu the arrow keys move
 * (wrapping), Home and End go to the ends, Enter or Space choose, and Escape closes it and returns
 * focus to the button. Tab, a press or click outside, focus moving away, a scroll or a resize close
 * it too, and only one menu is open at a time. A disabled item stays reachable, is named by its
 * label and described by why it cannot apply. The menu shows in the top layer (a manual popover),
 * so no card or scroll area clips it. Targets are at least 24 by 24 px (WCAG 2.5.8).
 */
@Component({
  selector: 'app-menu-button',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, so a page can place it (.tale-card__menu); loaded only with the pages that use it.
  encapsulation: ViewEncapsulation.None,
  styles: `
    .menu-button {
      display: inline-flex;
    }
    .menu-button__trigger {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-control);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
    }
    .menu-button__trigger:hover,
    .menu-button__trigger[aria-expanded='true'] {
      border-color: var(--ember);
      color: var(--ember-strong);
    }
    .menu-button__trigger:focus-visible,
    .menu-button__item:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .menu-button__menu {
      position: fixed;
      inset: auto;
      margin: 0;
      min-inline-size: 10rem;
      max-inline-size: min(18rem, calc(100vw - 16px));
      max-block-size: calc(100vh - 8px);
      padding: var(--space-1);
      border: 1px solid var(--border);
      border-radius: var(--radius-control);
      background: var(--surface);
      box-shadow: var(--shadow-raised);
      color: var(--text);
      overflow-y: auto;
    }
    .menu-button__item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      inline-size: 100%;
      min-block-size: 32px;
      padding-block: var(--space-1);
      padding-inline: var(--space-3);
      border: 0;
      border-radius: var(--radius-control);
      background: none;
      color: inherit;
      font: inherit;
      font-size: var(--text-sm);
      text-align: start;
      cursor: pointer;
    }
    .menu-button__item:hover:not([aria-disabled='true']),
    .menu-button__item:focus {
      background: var(--surface-sunken);
    }
    .menu-button__item[aria-disabled='true'] {
      color: var(--text-muted);
      cursor: default;
    }
    .menu-button__reason {
      font-size: var(--text-xs);
    }
    /* A tale card's ⋯ menu, top end corner, above the card's open button. */
    .tale-card__menu {
      position: absolute;
      z-index: 2;
      top: var(--space-2);
      inset-inline-end: var(--space-1);
    }
    .tale-card__menu .menu-button__trigger {
      width: 24px;
      height: 24px;
      border-color: transparent;
      border-radius: var(--radius-pill);
      background: rgb(0 0 0 / 62%);
      color: #fff;
    }
    .tale-card__menu .menu-button__trigger:hover,
    .tale-card__menu .menu-button__trigger[aria-expanded='true'] {
      border-color: #fff;
      color: #fff;
    }
    /* Drawn inside the button, so it does not cover the drag handle beside it. */
    .tale-card__menu .menu-button__trigger:focus-visible {
      outline-width: 2px;
      outline-offset: -2px;
    }
  `,
  host: { class: 'menu-button', '(focusout)': 'focusOut($event)' },
  template: `
    <button
      #trigger
      type="button"
      class="menu-button__trigger"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? menuId : null"
      [attr.aria-label]="label()"
      [id]="triggerId"
      (click)="toggle()"
      (keydown)="triggerKey($event)"
    >
      <app-icon name="more" />
    </button>
    @if (open()) {
      <div
        #menu
        class="menu-button__menu"
        role="menu"
        tabindex="-1"
        popover="manual"
        [id]="menuId"
        [attr.aria-labelledby]="triggerId"
        (keydown)="menuKey($event)"
        (toggle)="popoverToggled($event)"
      >
        @for (item of items(); track item.id; let i = $index) {
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="menu-button__item"
            [attr.aria-disabled]="item.disabledReason ? 'true' : null"
            [attr.aria-describedby]="item.disabledReason ? menuId + '-reason-' + i : null"
            (click)="choose(item)"
          >
            <span>{{ item.label }}</span>
            @if (item.disabledReason) {
              <!-- Out of the item's name, which is its label; read once, as its description. -->
              <span class="menu-button__reason" aria-hidden="true" [id]="menuId + '-reason-' + i">{{
                item.disabledReason
              }}</span>
            }
          </button>
        }
      </div>
    }
  `,
})
export class MenuButton {
  /** The button's accessible name, such as "More for Summer". */
  readonly label = input.required<string>();
  readonly items = input.required<readonly MenuItem[]>();
  /** An enabled item was chosen; the menu has closed and focus is back on its button. */
  readonly picked = output<MenuPick>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  protected readonly menuId = `menu-${nextId++}`;
  protected readonly triggerId = `${this.menuId}-button`;
  protected readonly open = signal(false);

  // A press or a click (a keyboard or assistive technology click has no press) outside closes it.
  private readonly onOutside = (event: Event) => {
    if (isOutside(this.host.nativeElement, event)) this.close(false);
  };
  // The menu does not follow its button: a scroll (other than the menu's own) or a resize closes it.
  private readonly onScroll = (event: Event) => {
    if (!this.menu()?.nativeElement.contains(event.target as Node)) this.close(false);
  };
  private readonly onResize = () => this.close(false);
  private readonly closeQuietly = () => this.close(false);
  private readonly listeners = new PopupListeners(this.document, [
    { on: 'document', type: 'pointerdown', listener: this.onOutside, capture: true },
    { on: 'document', type: 'click', listener: this.onOutside, capture: true },
    { on: 'window', type: 'scroll', listener: this.onScroll, capture: true },
    { on: 'window', type: 'resize', listener: this.onResize },
  ]);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close(false));
  }

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.show('first');
  }

  protected triggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.show(event.key === 'ArrowDown' ? 'first' : 'last');
    }
    // Enter and Space reach the button as a click.
  }

  protected menuKey(event: KeyboardEvent): void {
    const items = this.menuItems();
    const at = items.indexOf(this.document.activeElement as HTMLElement);
    const focus = (index: number) => items[(index + items.length) % items.length]?.focus({ preventScroll: true });
    switch (event.key) {
      case 'ArrowDown':
        focus(at + 1);
        break;
      case 'ArrowUp':
        focus(at < 0 ? -1 : at - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(-1);
        break;
      case 'Escape':
        this.close(true);
        break;
      case 'Tab':
        // Focus moves on from the button, as the menu closes.
        this.close(false);
        this.trigger().nativeElement.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  protected focusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    // Focus left for something else on the page; a press outside is handled on its own.
    if (next && !this.host.nativeElement.contains(next)) this.close(false);
  }

  // The browser closed the popover by itself.
  protected popoverToggled(event: Event): void {
    if ((event as Event & { newState?: string }).newState !== 'closed') return;
    // A late event from an earlier close does not close the menu opened since.
    let stillOpen = false;
    try {
      stillOpen = (event.target as HTMLElement).matches(':popover-open');
    } catch {
      // No popover support: nothing closed it.
    }
    if (!stillOpen) this.close(false);
  }

  protected choose(item: MenuItem): void {
    if (item.disabledReason) return;
    this.close(true);
    this.picked.emit({ id: item.id, opener: this.trigger().nativeElement });
  }

  /** Opens the menu with focus on its first or last item, closing any other open menu. */
  show(focus: 'first' | 'last'): void {
    if (!this.open()) {
      if (closeOpenMenu && closeOpenMenu !== this.closeQuietly) closeOpenMenu();
      closeOpenMenu = this.closeQuietly;
      this.open.set(true);
      // Renders the menu now, so it can be shown and focused in this event.
      this.changes.detectChanges();
      showInTopLayer(this.menu()?.nativeElement);
      this.place();
      this.listeners.add();
    }
    const items = this.menuItems();
    items[focus === 'first' ? 0 : items.length - 1]?.focus({ preventScroll: true });
  }

  /** Closes the menu; `refocus` puts focus back on its button. */
  close(refocus: boolean): void {
    this.listeners.remove();
    if (closeOpenMenu === this.closeQuietly) closeOpenMenu = null;
    if (!this.open()) return;
    this.open.set(false);
    hideFromTopLayer(this.menu()?.nativeElement);
    if (refocus) this.trigger().nativeElement.focus();
  }

  private menuItems(): HTMLElement[] {
    return [...(this.menu()?.nativeElement.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
  }

  private place(): void {
    const menu = this.menu()?.nativeElement;
    if (!menu) return;
    const view = this.document.defaultView;
    const trigger = this.trigger().nativeElement;
    const rtl = view?.getComputedStyle(trigger).direction === 'rtl';
    const at = menuPosition(
      trigger.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.offsetHeight },
      viewportSize(view),
      rtl,
    );
    placeAt(menu, at);
  }
}
