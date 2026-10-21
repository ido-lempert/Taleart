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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel from the right. Moves focus inside on open, keeps Tab inside, closes on Escape
 * or the backdrop, and returns focus to `returnFocus` when it is removed.
 */
@Component({
  selector: 'app-drawer',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'requestClose()', '(click)': 'onClick($event)' },
  template: `
    <div class="drawer-backdrop" aria-hidden="true"></div>
    <div
      #panel
      class="drawer"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      (keydown)="trapTab($event)"
    >
      <header class="drawer__header">
        <h2 class="drawer__title" [id]="titleId">{{ heading() }}</h2>
        <button type="button" class="btn btn--ghost btn--icon" aria-label="Close" (click)="requestClose()">
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
  readonly closed = output<void>();

  protected readonly titleId = `drawer-title-${nextId++}`;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    afterNextRender(() => {
      const panel = this.panel().nativeElement;
      const first = panel.querySelector('.drawer__body')?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? this.focusables()[0])?.focus();
    });
  }

  ngOnDestroy(): void {
    const returnFocus = this.returnFocus();
    const target = typeof returnFocus === 'function' ? returnFocus() : returnFocus;
    if (target?.isConnected) target.focus();
    else this.panel().nativeElement.ownerDocument.getElementById('main')?.focus();
  }

  // A click on the backdrop closes the drawer; Escape is the keyboard way.
  protected onClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('drawer-backdrop')) this.requestClose();
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
    const active = this.panel().nativeElement.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return [...this.panel().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }
}
