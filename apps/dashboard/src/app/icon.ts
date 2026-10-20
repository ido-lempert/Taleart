import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'zones'
  | 'projects'
  | 'plus'
  | 'close'
  | 'back'
  | 'alert'
  | 'frame'
  | 'tales'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'grip'
  | 'tag';

/** Inline SVG icons (24px grid, 2px stroke). Decorative: the control around an icon carries the label. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('zones') {
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <rect x="14" y="14" width="7" height="7" rx="2" />
        }
        @case ('projects') {
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        }
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6L6 18" />
        }
        @case ('back') {
          <path d="M15 18l-6-6 6-6" />
        }
        @case ('alert') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" />
        }
        @case ('frame') {
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
        }
        @case ('left') {
          <path d="M15 18l-6-6 6-6" />
        }
        @case ('right') {
          <path d="M9 18l6-6-6-6" />
        }
        @case ('up') {
          <path d="M18 15l-6-6-6 6" />
        }
        @case ('down') {
          <path d="M6 9l6 6 6-6" />
        }
        @case ('grip') {
          <circle cx="9" cy="6" r="1" />
          <circle cx="15" cy="6" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="9" cy="18" r="1" />
          <circle cx="15" cy="18" r="1" />
        }
        @case ('tag') {
          <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
          <circle cx="8" cy="8" r="1.5" />
        }
        @case ('tales') {
          <rect x="7" y="3" width="10" height="18" rx="2" />
          <path d="M4 6v12M20 6v12" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
}

/** The TaleArt mark: an ember tile holding a "T" inside a story ring arc. */
@Component({
  selector: 'app-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#F2542D" />
      <path d="M16 5.5a10.5 10.5 0 1 1-9.1 5.25" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".55" />
      <path d="M10.5 10.5h11v3h-4v8.5h-3v-8.5h-4z" fill="#fff" />
    </svg>
  `,
})
export class Mark {}
