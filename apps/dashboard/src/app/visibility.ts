import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import {
  visibilityReasonText,
  visibilitySummary,
  VISIBLE_ON_SITE_TEXT,
  type Visibility,
  type VisibilitySubject,
} from '@taleart/contract/core';
import { formatLocal } from './schedule';

let nextId = 0;

/** How long the reasons stay after the pointer leaves, so it can cross to them. */
export const TIP_HIDE_DELAY_MS = 150;

/** The space between the tooltip and what it belongs to, and the viewport's edge. */
const GAP = 8;

/** "Visible on site" or "Not visible: <first reason>" for content of kind `viewing`, times in the browser's zone. */
export function visibilityLine(visibility: Visibility, viewing: VisibilitySubject): string {
  return visibilitySummary(visibility, viewing, formatLocal);
}

/** Every reason content is not visible, in plain words, most useful first. */
export function visibilityReasons(visibility: Visibility, viewing: VisibilitySubject): string[] {
  return visibility.reasons.map((reason) => visibilityReasonText(reason, viewing, formatLocal));
}

/**
 * Where the tooltip goes, in viewport pixels. On a tale card (`compact`) it goes beside the card,
 * right or else left, so it never covers the card's switch or move buttons; otherwise beside its
 * line, or below it when there is no room. Kept inside the viewport.
 */
export function tipPosition(
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  card: Pick<DOMRect, 'left' | 'right' | 'top'> | null,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const clamp = (value: number, max: number) => Math.max(GAP, Math.min(value, max - GAP));
  if (card) {
    const right = card.right + GAP;
    const left = right + tip.width <= viewport.width - GAP ? right : card.left - GAP - tip.width;
    return { left: Math.max(GAP, left), top: clamp(anchor.top, viewport.height - tip.height) };
  }
  // Beside the line when it fits, so it does not cover the controls below it; else below the line.
  if (anchor.right + GAP + tip.width <= viewport.width - GAP) {
    return { left: anchor.right + GAP, top: clamp(anchor.top - GAP / 2, viewport.height - tip.height) };
  }
  return {
    left: clamp(anchor.left, viewport.width - tip.width),
    top: clamp(anchor.bottom + GAP / 2, viewport.height - tip.height),
  };
}

/**
 * The "Visible on site / Not visible because…" indicator (epic UX rework R7, R18): a filled dot and
 * "Visible on site", or a hollow dot and "Not visible:" with the first reason. The dot's shape
 * says the state too, so it is not told by colour alone. When content is not visible, the line is
 * a button: hovering or focusing it shows every reason, and pressing it toggles them. They show in
 * the top layer (a manual popover), so no card or scroll area clips them; they stay while the
 * pointer is over them, and close with Escape or a press elsewhere (WCAG 1.4.13); they follow the page when it scrolls. The
 * reasons are also the button's description for screen readers. `compact` shows only the dot, for
 * tale cards; its name is the line and its tooltip goes beside the card. Nothing shows while the
 * visibility is unknown. `anyZone` words a group read for every zone (the Tale groups page).
 */
@Component({
  selector: 'app-visibility',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, so a page can place it (.tale-card__visibility); loaded only with the pages that use it.
  encapsulation: ViewEncapsulation.None,
  styles: `
    /* A filled dot when visible, a hollow ring when not: the shape says it as well as the colour. */
    .visibility {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      min-width: 0;
    }
    .visibility__line {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
      min-height: 24px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-secondary);
      font: inherit;
      font-size: var(--text-sm);
      font-weight: 600;
      text-align: start;
    }
    button.visibility__line {
      cursor: help;
      text-decoration: underline dotted;
      text-underline-offset: 3px;
    }
    button.visibility__line:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
      border-radius: var(--radius-control);
    }
    .visibility__text {
      overflow-wrap: anywhere;
    }
    .visibility__dot {
      flex: none;
      width: 10px;
      height: 10px;
      border: 2px solid #b54708;
      border-radius: 50%;
      background: transparent;
    }
    .visibility--visible .visibility__line {
      color: #067647;
    }
    .visibility--visible .visibility__dot {
      border-color: #067647;
      background: #067647;
    }
    /* In the top layer, placed by script beside or below what it belongs to. */
    .visibility__tip {
      position: fixed;
      inset: auto;
      margin: 0;
      width: max-content;
      max-width: min(20rem, calc(100vw - 16px));
      padding: var(--space-2) var(--space-3);
      border: 0;
      border-radius: var(--radius-control);
      background: var(--ink);
      box-shadow: var(--shadow-raised);
      color: #fff;
      font-size: var(--text-sm);
      font-weight: 400;
      line-height: 1.4;
      overflow: visible;
    }
    .visibility__tip:not(:popover-open) {
      display: none;
    }
    .visibility__tip p,
    .visibility__tip ul {
      margin: 0;
    }
    .visibility__tip ul {
      padding-left: var(--space-4);
    }
    .visibility__tip-title {
      font-weight: 600;
    }
    /* On a tale card: only the dot, on a dark plate beside the position badge. */
    .tale-card__visibility {
      position: absolute;
      z-index: 2;
      top: var(--space-2);
      left: calc(var(--space-2) + 30px);
    }
    .tale-card__visibility .visibility__line {
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: var(--radius-pill);
      background: rgb(0 0 0 / 62%);
      text-decoration: none;
    }
    .tale-card__visibility .visibility__dot {
      border-color: #fec84b;
    }
    .tale-card__visibility.visibility--visible .visibility__dot {
      border-color: #32d583;
      background: #32d583;
    }
  `,
  host: {
    class: 'visibility',
    '[class.visibility--visible]': 'visibility()?.visible',
    '[class.visibility--compact]': 'compact()',
    '[class.visibility--open]': 'open()',
    '(mouseenter)': 'hoverIn()',
    '(mouseleave)': 'hoverOut()',
    '(focusin)': 'focusIn()',
    '(focusout)': 'focusOut($event)',
  },
  template: `
    @if (visibility(); as known) {
      @if (interactive()) {
        <button
          #trigger
          type="button"
          class="visibility__line"
          [attr.aria-label]="compact() ? line() : null"
          [attr.aria-describedby]="known.visible ? null : tipId"
          (pointerdown)="pressing = true"
          (click)="toggle()"
        >
          <span class="visibility__dot" aria-hidden="true"></span>
          @if (!compact()) {
            <span class="visibility__text">{{ line() }}</span>
          }
        </button>
        <div #tip class="visibility__tip" role="tooltip" popover="manual" [id]="tipId">
          @if (known.visible) {
            <p>{{ line() }}</p>
          } @else {
            <p class="visibility__tip-title">{{ anyZone() ? 'Not visible in any zone because:' : 'Not visible because:' }}</p>
            <ul>
              @for (reason of reasons(); track $index) {
                <li>{{ reason }}</li>
              }
            </ul>
          }
        </div>
      } @else {
        <span class="visibility__line">
          <span class="visibility__dot" aria-hidden="true"></span>
          <span class="visibility__text">{{ line() }}</span>
        </span>
      }
    }
  `,
})
export class VisibilityIndicator {
  /** What the API says; nothing is shown while it is unknown. */
  readonly visibility = input<Visibility | undefined>();
  /** What the content is, so a reason about it does not name it ("archived" on a tale). */
  readonly viewing = input.required<VisibilitySubject>();
  /** Only the dot, for tale cards; the line is its name and its tooltip. */
  readonly compact = input(false);
  /** Read for every zone the content is placed in, as the Tale groups page does. */
  readonly anyZone = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly tip = viewChild<ElementRef<HTMLElement>>('tip');

  protected readonly tipId = `visibility-tip-${nextId++}`;
  protected readonly line = computed(() => {
    const visibility = this.visibility();
    if (!visibility) return '';
    if (visibility.visible && this.anyZone()) return `${VISIBLE_ON_SITE_TEXT} in at least one zone`;
    return visibilityLine(visibility, this.viewing());
  });
  protected readonly reasons = computed(() => {
    const visibility = this.visibility();
    return visibility ? visibilityReasons(visibility, this.viewing()) : [];
  });
  /** A button with a tooltip when there is more to say than the line: reasons, or a compact dot. */
  protected readonly interactive = computed(() => this.visibility()?.visible === false || this.compact());
  protected readonly open = signal(false);

  /** True between a press and its click, so the focus a press gives does not open what the click toggles. */
  protected pressing = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.hide();
  };
  private readonly onPointerdown = (event: Event) => {
    if (!this.host.nativeElement.contains(event.target as Node)) this.hide();
  };
  // Follows what it belongs to when the page scrolls or resizes.
  private readonly onScroll = () => this.place();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  protected hoverIn(): void {
    clearTimeout(this.hideTimer);
    this.show();
  }

  protected hoverOut(): void {
    clearTimeout(this.hideTimer);
    if (this.host.nativeElement.contains(this.document.activeElement)) return;
    this.hideTimer = setTimeout(() => this.hide(), TIP_HIDE_DELAY_MS);
  }

  protected focusIn(): void {
    if (!this.pressing) this.show();
  }

  protected focusOut(event: FocusEvent): void {
    if (!this.host.nativeElement.contains(event.relatedTarget as Node | null)) this.hide();
  }

  protected toggle(): void {
    this.pressing = false;
    if (this.open()) this.hide();
    else this.show();
  }

  /** Shows the reasons in the top layer, placed beside the card or below the line. */
  show(): void {
    if (!this.interactive() || this.open()) return;
    this.open.set(true);
    const tip = this.tip()?.nativeElement;
    if (tip && typeof tip.showPopover === 'function') tip.showPopover();
    this.place();
    this.document.addEventListener('keydown', this.onKeydown, true);
    this.document.addEventListener('pointerdown', this.onPointerdown, true);
    this.document.defaultView?.addEventListener('scroll', this.onScroll, true);
    this.document.defaultView?.addEventListener('resize', this.onScroll);
  }

  // Puts the open tip beside the tale card or below the line.
  private place(): void {
    const tip = this.tip()?.nativeElement;
    const trigger = this.trigger()?.nativeElement;
    if (tip && trigger) {
      const view = this.document.defaultView;
      const card = this.compact() ? trigger.closest('.tale-card') : null;
      const at = tipPosition(
        trigger.getBoundingClientRect(),
        card ? card.getBoundingClientRect() : null,
        { width: tip.offsetWidth, height: tip.offsetHeight },
        { width: view?.innerWidth ?? 1024, height: view?.innerHeight ?? 768 },
      );
      tip.style.left = `${at.left}px`;
      tip.style.top = `${at.top}px`;
    }
  }

  /** Hides the reasons. */
  hide(): void {
    clearTimeout(this.hideTimer);
    this.document.removeEventListener('keydown', this.onKeydown, true);
    this.document.removeEventListener('pointerdown', this.onPointerdown, true);
    this.document.defaultView?.removeEventListener('scroll', this.onScroll, true);
    this.document.defaultView?.removeEventListener('resize', this.onScroll);
    if (!this.open()) return;
    this.open.set(false);
    const tip = this.tip()?.nativeElement;
    if (tip && typeof tip.hidePopover === 'function') {
      try {
        tip.hidePopover();
      } catch {
        // Already closed, as when the page removed it.
      }
    }
  }
}
