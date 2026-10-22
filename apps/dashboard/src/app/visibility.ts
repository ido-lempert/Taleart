import { ChangeDetectionStrategy, Component, computed, input, signal, ViewEncapsulation } from '@angular/core';
import {
  visibilityReasonText,
  visibilitySummary,
  VISIBLE_ON_SITE_TEXT,
  type Visibility,
  type VisibilitySubject,
} from '@taleart/contract/core';
import { formatLocal } from './schedule';

let nextId = 0;

/** "Visible on site" or "Not visible: <first reason>" for content of kind `viewing`, times in the browser's zone. */
export function visibilityLine(visibility: Visibility, viewing: VisibilitySubject): string {
  return visibilitySummary(visibility, viewing, formatLocal);
}

/** Every reason content is not visible, in plain words, most useful first. */
export function visibilityReasons(visibility: Visibility, viewing: VisibilitySubject): string[] {
  return visibility.reasons.map((reason) => visibilityReasonText(reason, viewing, formatLocal));
}

/**
 * The "Visible on site / Not visible because…" indicator (epic UX rework R7, R18): a filled dot and
 * "Visible on site", or a hollow dot and "Not visible:" with the first reason. The dot's shape
 * says the state too, so it is not told by colour alone. When content is not visible, the line is
 * a button: hovering, focusing or pressing it shows every reason in a tooltip that stays while
 * the pointer is over it and closes with Escape (WCAG 1.4.13); the reasons are also its
 * description for screen readers. `compact` shows only the dot, for tale cards; its name and
 * tooltip carry the line.
 */
@Component({
  selector: 'app-visibility',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped, so a page can place it (.tale-card__visibility); loaded only with the pages that use it.
  encapsulation: ViewEncapsulation.None,
  styles: `
/* A filled dot when visible, a hollow ring when not: the shape says it as well as the colour. */
.visibility {
  position: relative;
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

.visibility__tip {
  position: absolute;
  z-index: 20;
  top: calc(100% + var(--space-1));
  left: 0;
  display: none;
  width: max-content;
  max-width: min(20rem, 80vw);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--ink);
  box-shadow: var(--shadow-raised);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.4;
}

.visibility--open .visibility__tip {
  display: block;
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

/* On a tale card: only the dot, on a dark plate beside the position badge; the tooltip stays inside the card. */
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

.tale-card__visibility .visibility__tip {
  top: 28px;
  left: -30px;
  width: calc(var(--tale-width) - 2 * var(--space-2));
  max-width: none;
  padding: var(--space-2);
  font-size: var(--text-xs);
}
  `,
  host: {
    class: 'visibility',
    '[class.visibility--visible]': 'visibility()?.visible',
    '[hidden]': '!visibility()',
    '[class.visibility--compact]': 'compact()',
    '[class.visibility--open]': 'open()',
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
  template: `
    @if (interactive()) {
      <button
        type="button"
        class="visibility__line"
        [attr.aria-label]="compact() ? line() : null"
        [attr.aria-describedby]="tipId"
        (click)="show()"
      >
        <span class="visibility__dot" aria-hidden="true"></span>
        @if (!compact()) {
          <span class="visibility__text">{{ line() }}</span>
        }
      </button>
      <div class="visibility__tip" role="tooltip" [id]="tipId">
        @if (visibility()?.visible) {
          <p>{{ visibleText }}</p>
        } @else {
          <p class="visibility__tip-title">Not visible because:</p>
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
  `,
})
export class VisibilityIndicator {
  /** What the API says; nothing is shown while it is unknown. */
  readonly visibility = input<Visibility | undefined>();
  /** What the content is, so a reason about it does not name it ("archived" on a tale). */
  readonly viewing = input.required<VisibilitySubject>();
  /** Only the dot, for tale cards; the line is its name and its tooltip. */
  readonly compact = input(false);

  protected readonly tipId = `visibility-tip-${nextId++}`;
  protected readonly visibleText = VISIBLE_ON_SITE_TEXT;
  private readonly known = computed(() => this.visibility() ?? { visible: true, reasons: [] });
  protected readonly line = computed(() => visibilityLine(this.known(), this.viewing()));
  protected readonly reasons = computed(() => visibilityReasons(this.known(), this.viewing()));
  /** A button with a tooltip when there is more to say than the line: reasons, or a compact dot. */
  protected readonly interactive = computed(() => !this.known().visible || this.compact());
  protected readonly open = signal(false);

  protected show(): void {
    if (this.interactive()) this.open.set(true);
  }

  protected hide(): void {
    this.open.set(false);
  }
}
