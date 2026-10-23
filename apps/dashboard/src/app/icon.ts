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
  | 'tag'
  | 'settings'
  | 'text'
  | 'image'
  | 'video'
  | 'shape'
  | 'emoji'
  | 'sticker'
  | 'button'
  | 'image-button'
  | 'swipe-up'
  | 'poll'
  | 'rating'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'more'
  | 'undo'
  | 'redo';

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
        @case ('settings') {
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        }
        @case ('text') {
          <path d="M5 6V4h14v2M12 4v16M9 20h6" />
        }
        @case ('image') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="M21 17l-5-5-9 8" />
        }
        @case ('video') {
          <rect x="3" y="5" width="13" height="14" rx="2" />
          <path d="M16 10l5-3v10l-5-3" />
        }
        @case ('shape') {
          <rect x="3" y="3" width="10" height="10" rx="2" />
          <circle cx="16" cy="16" r="5" />
        }
        @case ('emoji') {
          <circle cx="12" cy="12" r="9" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
        }
        @case ('sticker') {
          <path d="M15 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h9l6-6V6a3 3 0 0 0-3-3z" />
          <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
        }
        @case ('button') {
          <rect x="2" y="7" width="20" height="10" rx="5" />
          <path d="M8 12h8" />
        }
        @case ('image-button') {
          <rect x="3" y="3" width="18" height="14" rx="2" />
          <path d="M21 13l-5-5-9 9M12 21h6M15 18l3 3-3 3" />
        }
        @case ('swipe-up') {
          <path d="M7 10l5-5 5 5M12 5v10" />
          <rect x="6" y="17" width="12" height="4" rx="2" />
        }
        @case ('poll') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9h6M7 13h10M7 17h4" />
        }
        @case ('rating') {
          <path d="M3 12h18" />
          <circle cx="15" cy="12" r="4" />
        }
        @case ('eye') {
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        }
        @case ('eye-off') {
          <path
            d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"
          />
        }
        @case ('lock') {
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        }
        @case ('unlock') {
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 7.7-1.5" />
        }
        @case ('more') {
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        }
        @case ('undo') {
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        }
        @case ('redo') {
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
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
