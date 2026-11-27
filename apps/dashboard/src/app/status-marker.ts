import { ChangeDetectionStrategy, Component, ElementRef, input, signal, viewChild } from '@angular/core';

let nextMarkerId = 0;

/** orange: a warning, will change or is partial; red: a problem, not visible because something is off or missing; green: fine. */
export type StatusTone = 'green' | 'orange' | 'red';

/** A glyph per tone, so the tone is not told by colour alone. */
const GLYPHS: Readonly<Record<StatusTone, string>> = { green: '✓', orange: '!', red: '×' };

/**
 * A small coloured marker beside an item's name (the status text moves to its tooltip). It is a
 * button named by `text`, so a screen reader and the keyboard get the same words as the tooltip,
 * which shows on hover and on keyboard focus. Escape hides the tooltip while it is shown, and
 * stops there (a drawer the marker is in stays open).
 */
@Component({
  selector: 'app-status-marker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(mouseenter)': 'dismissed.set(false)',
    '(mouseleave)': 'dismissed.set(false)',
    '(focusin)': 'dismissed.set(false)',
    '(focusout)': 'dismissed.set(false)',
  },
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      flex: none;
      vertical-align: middle;
    }
    .status-marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      margin: 0;
      padding: 0;
      border: 2px solid #fff;
      border-radius: 50%;
      color: #fff;
      font: inherit;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
      cursor: help;
      box-shadow: 0 0 0 1px var(--border-strong);
    }
    .status-marker--green {
      background: #067647;
    }
    .status-marker--orange {
      background: #b54708;
    }
    .status-marker--red {
      background: #b42318;
    }
    .status-marker:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 2px;
    }
    .status-marker__tip {
      display: none;
      position: absolute;
      z-index: 20;
      bottom: calc(100% + 8px);
      left: 0;
      width: max-content;
      max-width: min(20rem, calc(100vw - 32px));
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-control);
      background: var(--ink);
      box-shadow: var(--shadow-raised);
      color: #fff;
      font-size: var(--text-sm);
      font-weight: 400;
      line-height: 1.4;
      text-align: start;
      white-space: normal;
      pointer-events: none;
    }
    .status-marker:hover + .status-marker__tip,
    .status-marker:focus-visible + .status-marker__tip {
      display: block;
    }
    /* After Escape, until the pointer or the focus comes back. */
    .status-marker--dismissed + .status-marker__tip {
      display: none !important;
    }
  `,
  template: `
    <button
      #button
      type="button"
      class="status-marker"
      [class.status-marker--green]="tone() === 'green'"
      [class.status-marker--orange]="tone() === 'orange'"
      [class.status-marker--red]="tone() === 'red'"
      [class.status-marker--dismissed]="dismissed()"
      [attr.aria-label]="text()"
      [attr.aria-describedby]="detail() ? describedId : null"
      (keydown.escape)="escape($event)"
    ><span aria-hidden="true">{{ glyph() }}</span></button>
    <span class="status-marker__tip" aria-hidden="true">{{ text() }}</span>
    @if (detail()) {
      <span class="visually-hidden" [id]="describedId">{{ detail() }}</span>
    }
  `,
})
export class StatusMarker {
  readonly tone = input.required<StatusTone>();
  /** The status text: the accessible name, and the tooltip's content. */
  readonly text = input.required<string>();
  /** More about the status, read as the marker's description (not shown on screen). */
  readonly detail = input<string>('');
  protected readonly describedId = `status-marker-detail-${++nextMarkerId}`;

  protected readonly dismissed = signal(false);
  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');

  protected glyph(): string {
    return GLYPHS[this.tone()];
  }

  /**
   * Hides the tooltip. The key stops here only when the tooltip was showing, so an open drawer the
   * marker is in still closes on Escape otherwise. Entering or leaving the marker shows it again.
   */
  protected escape(event: Event): void {
    if (isShowing(this.button().nativeElement)) event.stopPropagation();
    this.dismissed.set(true);
  }
}

/** True while the pointer is over the element or it has keyboard focus, as the tooltip's CSS shows it. */
function isShowing(element: HTMLElement): boolean {
  try {
    return element.matches(':hover, :focus-visible');
  } catch {
    return element === element.ownerDocument.activeElement;
  }
}
