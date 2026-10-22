import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnDestroy,
  output,
  viewChild,
} from '@angular/core';
import { Icon } from './icon';

let nextId = 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Matches FOCUSABLE and is not under a `hidden` attribute (such as a file input opened by its button). */
function reachable(el: HTMLElement): boolean {
  return !el.closest('[hidden]');
}

/**
 * The drawers open now, oldest first. A drawer opened from another one (the tale drawer over the
 * group view) sits above it; only the top one answers Escape.
 */
const openDrawers: Drawer[] = [];

/**
 * A modal panel from the right. Moves focus inside on open, keeps Tab inside, closes on Escape
 * or the backdrop, and returns focus to `returnFocus` when it is removed. Drawers stack: Escape
 * closes only the top one. `wide` is the group view's drawer (epic UX rework R11): wider, below the
 * other drawers, and a whole page on phones.
 */
@Component({
  selector: 'app-drawer',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'escape()',
    '(click)': 'onClick($event)',
    '[class.drawer-host--wide]': 'wide()',
  },
  template: `
    <div class="drawer-backdrop" aria-hidden="true"></div>
    <div
      #panel
      class="drawer"
      [class.drawer--wide]="wide()"
      [attr.id]="panelId()"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      (keydown)="trapTab($event)"
    >
      <header class="drawer__header">
        <h2 class="drawer__title" [id]="titleId" tabindex="-1">{{ heading() }}</h2>
        <button type="button" class="btn btn--ghost btn--icon drawer__close" [attr.aria-label]="closeLabel()" (click)="requestClose()">
          <app-icon name="close" />
        </button>
      </header>
      <ng-content />
    </div>
  `,
})
export class Drawer implements OnDestroy {
  readonly heading = input.required<string>();
  /**
   * Where focus goes when the drawer is removed: an element, or a function read
   * at that moment, for a caller whose target changes while the drawer is open.
   */
  readonly returnFocus = input<HTMLElement | null | (() => HTMLElement | null)>(null);
  /** While true (a save is in flight), Escape, the backdrop and the close button do nothing. */
  readonly busy = input(false);
  /** The group view's drawer: wide, under the other drawers, a whole page on phones. */
  readonly wide = input(false);
  /** The dialog's id, for a trigger's `aria-controls`. */
  readonly panelId = input<string | null>(null);
  /** The close button's name. */
  readonly closeLabel = input('Close');
  /**
   * Where focus goes on open: an element matching this selector in the drawer, `title` for the
   * heading, or by default the first control of its body.
   */
  readonly initialFocus = input<string | null>(null);
  /**
   * Whether the drawer puts focus back (`returnFocus`, else the page) when it is removed; false
   * when its owner does it, such as the group view, which first lifts the page's inertness.
   */
  readonly restoreFocus = input(true);
  readonly closed = output<void>();

  protected readonly titleId = `drawer-title-${nextId++}`;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    openDrawers.push(this);
    afterNextRender(() => {
      const panel = this.panel().nativeElement;
      const initial = this.initialFocus();
      const chosen =
        initial === 'title'
          ? panel.querySelector<HTMLElement>('.drawer__title')
          : initial
            ? panel.querySelector<HTMLElement>(initial)
            : null;
      const body = panel.querySelector('.drawer__body');
      const first = body ? [...body.querySelectorAll<HTMLElement>(FOCUSABLE)].find(reachable) : undefined;
      (chosen ?? first ?? this.focusables()[0])?.focus();
    });
  }

  ngOnDestroy(): void {
    const at = openDrawers.indexOf(this);
    if (at >= 0) openDrawers.splice(at, 1);
    if (!this.restoreFocus()) return;
    const returnFocus = this.returnFocus();
    const target = typeof returnFocus === 'function' ? returnFocus() : returnFocus;
    if (target?.isConnected) target.focus();
    else this.panel().nativeElement.ownerDocument.getElementById('main')?.focus();
  }

  // A click on the backdrop closes the drawer; Escape is the keyboard way.
  protected onClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('drawer-backdrop')) this.requestClose();
  }

  // Escape closes the top drawer only: one opened over this one takes it first.
  protected escape(): void {
    if (openDrawers.at(-1) === this) this.requestClose();
  }

  protected requestClose(): void {
    if (!this.busy()) this.closed.emit();
  }

  protected trapTab(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.panel().nativeElement.ownerDocument.activeElement as HTMLElement | null;
    // Focus on something Tab does not reach (the heading, focused on open) wraps like an end.
    const outside = !active || !items.includes(active);
    if (event.shiftKey && (active === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return [...this.panel().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);
  }
}
