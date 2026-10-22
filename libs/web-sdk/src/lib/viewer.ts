import {
  DEFAULT_TALE_DURATION_MS,
  LEGACY_TALE_DURATION_MS,
  MAX_TALE_VIDEO_MS,
  stageTaleMedia,
  type DeliveryTale,
  type DeliveryTaleElement,
  type DeliveryTaleGroup,
} from '@taleart/contract';
import { prefersReducedMotion, stillCover } from './bar';
import { loadTaleFonts } from './document/fonts';
import { mediaUrl, renderImage } from './document/media';
import { canvasColor, DOCUMENT_STYLES, renderTaleDocument } from './document/renderer';

/** How long a tale shows on the timer when the server sends it without a document (servers before R16). */
export const IMAGE_DURATION_MS = LEGACY_TALE_DURATION_MS;

/** A document's video that makes no progress for this long while it should play ends its tale. */
export const VIDEO_STALL_MS = 5000;
/**
 * Travel that makes a pointer gesture a swipe: horizontally between groups, and upwards to open
 * the tale's swipe-up link (epic Tale Studio R7).
 */
export const SWIPE_MIN_PX = 50;
/** A press at least this long is a hold (pause), not a tap (step). */
export const HOLD_MIN_MS = 250;

/**
 * A wide screen (a desktop window): the tale shows as a card in the middle, the group's other tales
 * as smaller cards beside it, with arrows by the card and the neighbouring groups in the corners.
 */
export const WIDE_QUERY = '(min-width: 768px) and (min-aspect-ratio: 1/1)';
/** How many of the group's other tales show on each side of the card. */
export const DECK_SIDE = 3;
/** The side cards' size against the card's. */
export const DECK_SCALE = 0.6;
// The gap between the card and the first side card, and between side cards, in px.
const DECK_GAP = 56;
const DECK_SIDE_GAP = 20;
/** How long the deck moves when the tale or the group changes. */
export const DECK_MS = 380;
const DECK_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const SIDE_FILTER = 'brightness(0.45)';

function isWide(): boolean {
  return typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches;
}

/**
 * Full-screen viewer look, on black. The project's theme (R9) sets the font
 * and the accent (progress fill and control icons) through the `--ta-*`
 * custom properties; without a theme font it keeps `system-ui`. The font is
 * set on its own, never through the `font` shorthand, so a value the browser
 * refuses cannot drop the size and line height. TaleArt's default accent is
 * white, 21:1 on black.
 * Controls are 44 px targets.
 */
export const VIEWER_STYLES = `
.viewer {
  position: fixed;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: #000;
  color: #fff;
  font-family: var(--ta-font, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.4;
  overflow: hidden;
  overscroll-behavior: contain;
  touch-action: pinch-zoom;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.viewer:focus { outline: none; }
.viewer::backdrop { background: #000; overflow: hidden; overscroll-behavior: contain; }
.frame { position: relative; width: 100%; max-width: 56.25vh; height: 100%; margin: 0 auto; }
.stage { position: absolute; inset: 0; }
.media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
span.media { background: #1f2937; }
.zone {
  position: absolute;
  top: 0;
  bottom: 0;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.zone.prev { inset-inline-start: 0; width: 33.333%; }
.zone.next { inset-inline-end: 0; width: 66.667%; }
.zone:focus-visible { outline: 3px solid #fff; outline-offset: -6px; box-shadow: inset 0 0 0 6px #000; }
.top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 8px;
  background: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0));
  pointer-events: none;
}
.segments { display: flex; gap: 4px; }
.segment { flex: 1; height: 3px; border-radius: 2px; overflow: hidden; background: rgba(255, 255, 255, 0.4); }
.fill { display: block; height: 100%; background: var(--ta-accent, #fff); transform-origin: left; transform: scaleX(0); }
.viewer[data-rtl] .fill { transform-origin: right; }
.done .fill { transform: none; }
.fill.timed { animation: taleart-fill var(--taleart-duration) linear forwards; }
.viewer[data-paused] .fill { animation-play-state: paused; }
@keyframes taleart-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (prefers-reduced-motion: reduce) {
  .fill.timed { animation: none; transform: none; }
}
.head { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.8);
  font-weight: 600;
}
.pause { margin-inline-start: auto; }
.pause[hidden] + .close { margin-inline-start: auto; }
.control[hidden] { display: none; }
.control {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  /* Transparent, so forced colours draw the button's edge. */
  border: 1px solid transparent;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: var(--ta-accent, #fff);
  cursor: pointer;
  pointer-events: auto;
}
.control:focus-visible { outline: 2px solid #fff; outline-offset: 0; box-shadow: 0 0 0 5px #000; }
.control svg { width: 24px; height: 24px; fill: currentColor; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
@media (forced-colors: active) {
  .segment { forced-color-adjust: none; background: GrayText; }
  .fill { forced-color-adjust: none; background: CanvasText; }
}
.side, .nav, .chip { display: none; }
@media ${WIDE_QUERY} {
  .viewer {
    --card-w: min(calc(88vh * 9 / 16), 36vw);
    --card-h: calc(var(--card-w) * 16 / 9);
    background: #0b0d12;
  }
  .viewer::backdrop { background: #0b0d12; }
  .frame, .side {
    position: absolute;
    top: calc(50% - var(--card-h) / 2);
    left: calc(50% - var(--card-w) / 2);
    width: var(--card-w);
    max-width: none;
    height: var(--card-h);
    margin: 0;
    border-radius: 12px;
    overflow: hidden;
  }
  .frame { z-index: 2; background: #000; }
  .side { display: block; z-index: 1; background: #111827; cursor: pointer; filter: ${SIDE_FILTER}; }
  .side:hover { filter: brightness(0.6); }
  .side .ta-cta { pointer-events: none; }
  .nav { display: grid; position: absolute; top: calc(50% - 22px); z-index: 3; }
  .nav.prev { inset-inline-start: calc(50% - var(--card-w) / 2 - 56px); }
  .nav.next { inset-inline-start: calc(50% + var(--card-w) / 2 + 12px); }
  .chip {
    display: flex;
    position: absolute;
    bottom: 24px;
    z-index: 3;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    max-width: 260px;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .chip[hidden] { display: none; }
  .chip.prev { inset-inline-start: 24px; }
  .chip.next { inset-inline-end: 24px; align-items: flex-end; }
  .chip:focus-visible { outline: none; }
  .chip:focus-visible .chip-body { outline: 2px solid #fff; outline-offset: 2px; }
  .chip-label { font-size: 12px; font-weight: 600; opacity: 0.8; }
  .chip-body {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
  }
  .chip:hover .chip-body { background: rgba(255, 255, 255, 0.14); }
  .chip-cover {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    background: #1f2937;
    box-shadow: 0 0 0 2px #fff;
  }
  .chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip svg, .nav svg { flex: none; width: 20px; height: 20px; fill: currentColor; }
  .viewer[data-rtl] .chip svg, .viewer[data-rtl] .nav svg { transform: scaleX(-1); }
}
${DOCUMENT_STYLES}`;

const ICONS = {
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  play: 'M7 4.5v15L19.5 12z',
  close: 'M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z',
  chevronBack: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z',
  chevronForward: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
  arrowBack: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  arrowForward: 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4z',
};

// How the deck moves into place: the viewer opens, the group changes, the tale steps, or no motion.
type DeckMotion = 'open' | 'group' | 'step' | 'none';

const CARD_KEYFRAME: Keyframe = { transform: 'translateX(0px) scale(1)', filter: 'none', opacity: 1 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function hasModifier(e: KeyboardEvent): boolean {
  return e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
}

// True when Space goes to the focused Close button, which it activates as on any button.
function onClose(e: Event): boolean {
  return !!(e.target as Element | null)?.closest?.('.close');
}

// True when `node` lays out right to left (the host page's direction reaches the Shadow DOM).
export function isRtl(node: Element): boolean {
  return typeof getComputedStyle === 'function' && getComputedStyle(node).direction === 'rtl';
}

// True when the event happened on a document's text element.
function inText(e: Event): boolean {
  return !!(e.target as Element | null)?.closest?.('.ta-text');
}

export function setIcon(button: HTMLElement, path: string): void {
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
}

export interface TaleViewerOptions {
  /** Called whenever a tale of a group shows (the group is viewed). */
  onGroupShown?: (groupId: string) => void;
  /** Called once the viewer closed, with the group it showed last. */
  onClose?: (groupId: string) => void;
}

/**
 * The full-screen tale viewer: a modal `<dialog>` in `root` that plays a
 * zone's tale groups in order. Every tale is a document (AD-15, R16), shown for its `durationMs`
 * (7 s by default), or for its video: the tale's own media video to its end, else a document's
 * video element (R5). The tale's own media, while it fills the canvas from the bottom, is drawn
 * full-bleed in the stage, as tale media always was; the other elements show over it on a 9:16
 * canvas; its text is
 * selectable, and a tap on it does not step. Tap or arrow keys step through tales (and across
 * groups), a swipe moves between groups, a hold or Space pauses (Space on the focused Close
 * button closes, as on any button), and Escape
 * or Close closes. Groups without tales are skipped. When the visitor
 * prefers reduced motion nothing plays or advances by itself: each tale
 * starts paused, videos play from the Play button, and the visitor steps. On a right-to-left
 * host page the tap zones, arrow keys and swipes mirror: the next tale is to the left.
 */
export class TaleViewer {
  private readonly groups: readonly DeliveryTaleGroup[];
  private dialog: HTMLDialogElement | null = null;
  private parts!: {
    frame: HTMLElement;
    segments: HTMLElement;
    name: HTMLElement;
    pause: HTMLButtonElement;
    stage: HTMLElement;
    top: HTMLElement;
    status: HTMLElement;
    chipPrev: HTMLButtonElement;
    chipNext: HTMLButtonElement;
  };
  // On a wide screen, the group's other tales beside the card, by their index in the group.
  private sides = new Map<number, HTMLElement>();
  private entering = false; // the next show() is the one that opens the viewer
  private group = 0;
  private tale = 0;
  private media: HTMLElement | null = null;
  private layer: HTMLElement | null = null; // the current tale's document, over its media
  private video: HTMLVideoElement | null = null;
  // The clock is a document's video (R5): the tale ends at 15 s at most, and when it stalls.
  private capped = false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  // A document's video beside the tale's own video: it loops along, and follows pause and play.
  private alongside: HTMLVideoElement[] = [];
  private paused = false; // by the visitor (Space or the button)
  private held = false; // while a pointer is down on the stage
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timed = false; // the current tale runs on the timer, not a video
  private duration = IMAGE_DURATION_MS; // the current tale's time on the timer
  private remaining = 0;
  private startedAt = 0;
  private press: { x: number; y: number; at: number } | null = null;
  private suppressClick = false;
  // The click a swipe up may also produce on the swipe-up link, which the swipe already opened.
  private suppressLink = false;
  private opened = false;
  private reduced = false;
  private rtl = false; // the host page lays out right to left: tap zones, arrows and swipes mirror
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onBlur = () => this.onPointerCancel();
  private readonly onResize = () => {
    if (this.opened) this.layoutDeck('none', this.group, this.tale);
  };

  constructor(
    private readonly root: ShadowRoot | HTMLElement,
    groups: readonly DeliveryTaleGroup[],
    private readonly options: TaleViewerOptions = {},
  ) {
    this.groups = groups.filter((group) => group.tales.length > 0);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** The id of the group on screen, or null when closed. */
  get groupId(): string | null {
    return this.opened ? this.groups[this.group].id : null;
  }

  /** Opens the group `groupId` at its first tale; false for an unknown group or one without tales. */
  open(groupId: string): boolean {
    const index = this.groups.findIndex((group) => group.id === groupId);
    if (index < 0) return false;
    if (this.opened) this.close();
    this.paused = false;
    this.held = false;
    this.press = null;
    this.suppressClick = false;
    this.reduced = prefersReducedMotion();
    // Built once and kept, so its live region exists before it is filled.
    const dialog = this.dialog ?? this.build();
    this.opened = true;
    this.syncPauseButton();
    this.parts.pause.hidden = false;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    this.rtl = isRtl(dialog);
    dialog.toggleAttribute('data-rtl', this.rtl);
    dialog.focus();
    addEventListener('blur', this.onBlur);
    addEventListener('resize', this.onResize);
    this.entering = true;
    this.show(index, 0, true);
    return true;
  }

  /** Closes the viewer and stops playback; tells `onClose` the group shown last. */
  close(): void {
    const dialog = this.dialog;
    if (!dialog || !this.opened) return;
    const groupId = this.groups[this.group].id;
    this.opened = false;
    this.stop();
    this.press = null;
    this.held = false;
    clearTimeout(this.statusTimer);
    this.parts.status.textContent = '';
    removeEventListener('blur', this.onBlur);
    removeEventListener('resize', this.onResize);
    this.clearSides();
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    this.options.onClose?.(groupId);
  }

  next(): void {
    if (this.tale + 1 < this.groups[this.group].tales.length) this.show(this.group, this.tale + 1);
    else this.nextGroup();
  }

  previous(): void {
    if (this.tale > 0) this.show(this.group, this.tale - 1);
    else if (this.group > 0) this.show(this.group - 1, this.groups[this.group - 1].tales.length - 1);
    else this.show(this.group, 0, true);
  }

  nextGroup(): void {
    if (this.group + 1 < this.groups.length) this.show(this.group + 1, 0);
    else this.close();
  }

  previousGroup(): void {
    if (this.group > 0) this.show(this.group - 1, 0);
  }

  /** Pauses or resumes, as Space and the Pause button do. */
  togglePause(): void {
    this.paused = !this.paused;
    this.syncPauseButton();
    this.applyPause();
  }

  private syncPauseButton(): void {
    const { pause } = this.parts;
    pause.setAttribute('aria-label', this.paused ? 'Play' : 'Pause');
    setIcon(pause, this.paused ? ICONS.play : ICONS.pause);
  }

  private build(): HTMLDialogElement {
    const dialog = el('dialog', 'viewer');
    dialog.tabIndex = -1;
    const frame = el('div', 'frame');
    const stage = el('div', 'stage');
    const prev = el('button', 'zone prev');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous tale');
    const next = el('button', 'zone next');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next tale');
    stage.append(prev, next);

    const top = el('div', 'top');
    const segments = el('div', 'segments');
    segments.setAttribute('aria-hidden', 'true');
    const head = el('div', 'head');
    const name = el('span', 'name');
    name.dir = 'auto';
    const pause = el('button', 'control pause');
    pause.type = 'button';
    pause.setAttribute('aria-label', 'Pause');
    setIcon(pause, ICONS.pause);
    const close = el('button', 'control close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    setIcon(close, ICONS.close);
    head.append(name, pause, close);
    top.append(segments, head);

    const status = el('p', 'sr-only');
    status.setAttribute('aria-live', 'polite');
    frame.append(stage, top, status);
    // Wide screens only (CSS): arrows by the card, and the neighbouring groups in the corners.
    const navPrev = el('button', 'control nav prev');
    navPrev.type = 'button';
    navPrev.setAttribute('aria-label', 'Previous tale');
    setIcon(navPrev, ICONS.chevronBack);
    const navNext = el('button', 'control nav next');
    navNext.type = 'button';
    navNext.setAttribute('aria-label', 'Next tale');
    setIcon(navNext, ICONS.chevronForward);
    const chipPrev = el('button', 'chip prev');
    chipPrev.type = 'button';
    const chipNext = el('button', 'chip next');
    chipNext.type = 'button';
    dialog.append(frame, navPrev, navNext, chipPrev, chipNext);
    navPrev.addEventListener('click', () => this.previous());
    navNext.addEventListener('click', () => this.next());
    chipPrev.addEventListener('click', () => this.previousGroup());
    chipNext.addEventListener('click', () => this.nextGroup());

    // One click handler for both zones: with pointer capture a tap's click may target the stage.
    stage.addEventListener('click', (e) => this.onStageClick(e));
    pause.addEventListener('click', () => this.togglePause());
    close.addEventListener('click', () => this.close());
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    // A swipe up may start on the swipe-up link itself, which lies over the stage (R7).
    dialog.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && (e.target as Element | null)?.closest?.('.ta-swipe')) {
        this.press = { x: e.clientX, y: e.clientY, at: Date.now() };
      }
    });
    dialog.addEventListener(
      'click',
      (e) => {
        if (this.suppressLink && (e.target as Element | null)?.closest?.('.ta-cta')) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
    stage.addEventListener('lostpointercapture', () => this.onPointerCancel());
    dialog.addEventListener('pointerup', (e) => this.onPointerUp(e));
    dialog.addEventListener('pointercancel', () => this.onPointerCancel());
    // No context menu or scrolling, except on a document's text, where a long press and a drag
    // select it (and the menu copies it) on touch screens.
    dialog.addEventListener('contextmenu', (e) => {
      if (!inText(e)) e.preventDefault();
    });
    // The host page never scrolls under the open viewer; two-finger pinch-zoom still works.
    dialog.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    dialog.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length < 2 && !inText(e)) e.preventDefault();
      },
      { passive: false },
    );
    dialog.addEventListener('keydown', (e) => this.onKeyDown(e));
    // Firefox activates a focused button on Space's keyup.
    dialog.addEventListener('keyup', (e) => {
      if (e.key === ' ' && !hasModifier(e) && !onClose(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    // Escape asks the modal dialog to close: close through `close()` so focus returns.
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close();
    });
    dialog.addEventListener('close', () => {
      if (!dialog.open) this.close();
    });

    this.root.appendChild(dialog);
    this.dialog = dialog;
    this.parts = { frame, segments, name, pause, stage, top, status, chipPrev, chipNext };
    return dialog;
  }

  private onStageClick(e: MouseEvent): void {
    // A keyboard activation (detail 0) always steps; a pointer click after a hold or swipe does not.
    if (e.detail !== 0 && this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const zone = (e.target as Element | null)?.closest?.('.zone');
    let back: boolean;
    if (zone) back = zone.classList.contains('prev');
    else {
      const rect = this.parts.stage.getBoundingClientRect();
      back = this.rtl ? e.clientX > rect.right - rect.width / 3 : e.clientX < rect.left + rect.width / 3;
    }
    if (back) this.previous();
    else this.next();
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Modified keys (such as Alt+Arrow for browser history) stay with the browser.
    if (hasModifier(e)) return;
    // Right to left, the next tale is to the left.
    const [forward, back] = this.rtl ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
    if (e.key === forward) this.next();
    else if (e.key === back) this.previous();
    else if (e.key === ' ' && onClose(e)) return;
    else if (e.key === ' ') {
      if (!e.repeat) this.togglePause();
    } else if (e.key === 'Escape') this.close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.suppressClick = false;
    this.press = { x: e.clientX, y: e.clientY, at: Date.now() };
    this.held = true;
    // A release outside the window still ends the press.
    try {
      this.parts.stage.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured.
    }
    this.applyPause();
  }

  private onPointerUp(e: PointerEvent): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    this.held = false;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    // A swipe up opens the tale's swipe-up link, when it has one (R7); otherwise it is a tap or a hold, as before.
    if (-dy >= SWIPE_MIN_PX && -dy > Math.abs(dx) && this.openSwipeUp()) {
      this.suppressNextClick();
      this.suppressLink = true;
      setTimeout(() => (this.suppressLink = false), 0);
      this.applyPause();
      return;
    }
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      this.suppressNextClick();
      // A swipe toward the start of the line (left, or right in right-to-left) shows the next group.
      if (this.rtl ? dx > 0 : dx < 0) this.nextGroup();
      else {
        this.previousGroup();
        this.applyPause();
      }
      return;
    }
    if (Date.now() - press.at >= HOLD_MIN_MS) this.suppressNextClick();
    this.applyPause();
  }

  // Opens the current tale's swipe-up link as a click on it would (same tab, or a new tab without
  // an opener); false when the tale has none.
  private openSwipeUp(): boolean {
    const link = this.layer?.querySelector<HTMLAnchorElement>('a.ta-swipe');
    if (!link) return false;
    link.click();
    return true;
  }

  // Swallows only the click this release may produce: it comes in the same task, if at all.
  private suppressNextClick(): void {
    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);
  }

  private onPointerCancel(): void {
    if (!this.press && !this.held) return;
    this.press = null;
    this.held = false;
    this.applyPause();
  }

  // Shows tale `tale` of group `group`, rebuilding the group's parts when it changes.
  private show(group: number, tale: number, newGroup = group !== this.group): void {
    if (!this.dialog || !this.opened) return;
    this.stop();
    const g = this.groups[group];
    const [fromGroup, fromTale] = [this.group, this.tale];
    this.group = group;
    this.tale = tale;
    const { segments, name, stage, status } = this.parts;
    if (newGroup || segments.childElementCount !== g.tales.length) {
      this.dialog.setAttribute('aria-label', g.name);
      name.textContent = g.name;
      segments.replaceChildren(
        ...g.tales.map(() => {
          const segment = el('span', 'segment');
          segment.appendChild(el('span', 'fill'));
          return segment;
        }),
      );
    }
    [...segments.children].forEach((segment, i) => {
      segment.classList.toggle('done', i < tale);
      // A fresh fill restarts its animation.
      segment.replaceChildren(el('span', 'fill'));
    });
    // Filled in a later task than any insertion, so screen readers announce it.
    const text = `${g.name}, tale ${tale + 1} of ${g.tales.length}`;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => (status.textContent = text), 0);

    const current = g.tales[tale];
    // Every tale is a document (R16). The tale's own media, while it is the bottom element and
    // fills the canvas, is drawn full-bleed in the stage behind the canvas, as tale media always
    // was, and keeps its rules: a video runs the tale for its whole length, with sound where the
    // browser allows it. The canvas carries the tale's name.
    const doc = current.document;
    if (!doc) {
      // A tale sent without a document (a server from before R16): its media as the viewer always
      // drew it, named by the tale's title, for 5 s or its video's length.
      this.duration = IMAGE_DURATION_MS;
      this.media = this.renderLegacyMedia(current);
      stage.prepend(this.media);
      stage.style.backgroundColor = '';
    } else {
      this.duration = doc.durationMs ?? DEFAULT_TALE_DURATION_MS;
      const elements = Array.isArray(doc.elements) ? doc.elements : [];
      const own = stageTaleMedia(doc);
      this.media = own && this.renderStageMedia(own);
      if (this.media) stage.prepend(this.media);
      // Behind the stage media, the canvas colour fills the stage, such as the bands a contained
      // image leaves (the canvas then paints none; a media background still draws over it, as it
      // always did); so does the placeholder of a tale with neither media nor a document, which
      // always showed its colour across the stage. Otherwise the canvas paints its own colour.
      const placeholder = doc.placeholder === true;
      stage.style.backgroundColor = ((this.media || placeholder) && canvasColor(doc)) || '';
      // Its project fonts load now that it opens (R18); its text shows the fallback stack until then.
      loadTaleFonts(current);
      // A tale document (AD-16): its elements on a 9:16 canvas between the tap zones and the controls.
      this.layer = renderTaleDocument(this.media ? { ...doc, elements: elements.slice(1) } : doc, {
        background: !this.media,
        label: current.title || `Tale ${tale + 1}`,
        reducedMotion: this.reduced,
      });
      this.parts.top.before(this.layer);
      // Its video element (R5) runs the tale: it plays, pauses and ends with it. Next to the tale's
      // own video it only loops along, muted.
      const docVideo = this.layer.querySelector('video');
      if (docVideo && !this.video) this.useVideo(docVideo, true);
      else if (docVideo) {
        docVideo.loop = true;
        this.alongside.push(docVideo);
      }
    }
    let motion: DeckMotion = 'none';
    if (this.entering) motion = 'open';
    else if (group !== fromGroup) motion = 'group';
    else if (tale !== fromTale) motion = 'step';
    this.entering = false;
    this.layoutDeck(motion, fromGroup, fromTale);
    this.options.onGroupShown?.(g.id);
    if (this.reduced) {
      // Reduced motion: every tale starts paused; only a video can be played, from the button.
      this.paused = true;
      this.syncPauseButton();
      this.parts.pause.hidden = !this.video;
    }
    if (this.video) this.applyPause();
    else this.startTimed();
  }

  // On a wide screen, lays out the deck around the card: the group's other tales as side cards, in
  // order (the next to the right, or to the left right to left). Stepping slides the deck like a
  // carousel, the card growing out of its side card; a new group deals its cards like a shuffle.
  // Narrow screens show the card alone. Under reduced motion nothing moves.
  private layoutDeck(motion: DeckMotion, fromGroup: number, fromTale: number): void {
    if (!this.dialog) return;
    this.syncChips();
    if (!isWide()) {
      this.clearSides();
      return;
    }
    const { frame } = this.parts;
    const width = frame.offsetWidth;
    const g = this.groups[this.group];
    const animate = motion !== 'none' && !this.reduced && typeof frame.animate === 'function';
    const timing = (delay = 0): KeyframeAnimationOptions => ({
      duration: DECK_MS,
      easing: DECK_EASING,
      delay,
      fill: 'backwards',
    });
    // Within the group the side cards move along; a new group deals a fresh deck.
    const moving = motion === 'step' || motion === 'none';
    const old = moving ? this.sides : new Map<number, HTMLElement>();
    if (!moving) this.clearSides();
    const sides = new Map<number, HTMLElement>();
    const first = Math.max(0, this.tale - DECK_SIDE);
    const last = Math.min(g.tales.length - 1, this.tale + DECK_SIDE);
    for (let i = first; i <= last; i++) {
      if (i === this.tale) continue;
      const k = i - this.tale;
      const to = this.slot(k, width);
      let side = old.get(i);
      let from: Keyframe;
      if (side) {
        old.delete(i);
        from = this.slot(i - fromTale, width);
      } else {
        side = this.side(g.tales[i], i);
        frame.before(side);
        // The tale that was the card shrinks into its place; the others come in from the far end.
        if (motion === 'step') from = i === fromTale ? CARD_KEYFRAME : { ...this.slot(k + Math.sign(k), width), opacity: 0 };
        else from = { ...to, opacity: 0 };
      }
      side.style.transform = String(to['transform']);
      if (animate) side.animate([from, to], timing(motion === 'step' ? 0 : 60 * Math.abs(k)));
      sides.set(i, side);
    }
    // Side cards that left the deck: the one that became the card goes at once, the others slide out.
    for (const [i, side] of old) {
      if (!animate || i === this.tale) {
        side.remove();
        continue;
      }
      const k = i - this.tale;
      const out = side.animate([this.slot(i - fromTale, width), { ...this.slot(k + Math.sign(k), width), opacity: 0 }], timing());
      out.onfinish = () => side.remove();
    }
    this.sides = sides;
    if (!animate) return;
    if (motion === 'step') frame.animate([this.slot(this.tale - fromTale, width), CARD_KEYFRAME], timing());
    else if (motion === 'group') {
      const dir = (this.group > fromGroup ? 1 : -1) * (this.rtl ? -1 : 1);
      frame.animate(
        [{ transform: `translateX(${dir * width * 0.7}px) rotate(${dir * 6}deg) scale(0.85)`, opacity: 0 }, CARD_KEYFRAME],
        timing(),
      );
    } else frame.animate([{ transform: 'translateX(0px) scale(0.92)', opacity: 0 }, CARD_KEYFRAME], timing());
  }

  // The place of the side card `k` tales from the card (0 is the card itself), for a card `width` px wide.
  private slot(k: number, width: number): Keyframe {
    if (k === 0) return CARD_KEYFRAME;
    const dir = Math.sign(k) * (this.rtl ? -1 : 1);
    const side = DECK_SCALE * width;
    const x = dir * (width / 2 + DECK_GAP + side / 2 + (Math.abs(k) - 1) * (side + DECK_SIDE_GAP));
    return { transform: `translateX(${x}px) scale(${DECK_SCALE})`, filter: SIDE_FILTER, opacity: 1 };
  }

  // A side card: the tale drawn still and silent, hidden from assistive technology (the arrows and
  // keys reach it); a click shows it.
  private side(tale: DeliveryTale, index: number): HTMLElement {
    const side = el('div', 'side');
    side.setAttribute('aria-hidden', 'true');
    const doc = tale.document;
    if (doc) {
      loadTaleFonts(tale);
      side.appendChild(renderTaleDocument(doc, { background: true, reducedMotion: true }));
    } else {
      const url = mediaUrl(tale.media?.url);
      if (tale.media?.kind === 'image' && url) {
        const img = el('img', 'media');
        img.alt = '';
        img.src = url;
        img.draggable = false;
        side.appendChild(img);
      }
    }
    // A side card's links are pictures only: the card is the one target, and focus never reaches them.
    for (const link of side.querySelectorAll('a')) link.tabIndex = -1;
    for (const video of side.querySelectorAll('video')) {
      video.autoplay = false;
      video.muted = true;
      video.preload = 'metadata';
    }
    side.addEventListener('click', () => this.show(this.group, index));
    return side;
  }

  private clearSides(): void {
    this.dialog?.querySelectorAll('.side').forEach((side) => side.remove());
    this.sides.clear();
  }

  // The neighbouring groups' chips in the corners (wide screens), hidden where there is none.
  private syncChips(): void {
    this.fillChip(this.parts.chipPrev, this.groups[this.group - 1], 'Previous', true);
    this.fillChip(this.parts.chipNext, this.groups[this.group + 1], 'Next', false);
  }

  private fillChip(chip: HTMLButtonElement, group: DeliveryTaleGroup | undefined, label: string, back: boolean): void {
    chip.hidden = !group;
    if (!group || chip.dataset['group'] === group.id) return;
    chip.dataset['group'] = group.id;
    chip.setAttribute('aria-label', `${label} group: ${group.name}`);
    const heading = el('span', 'chip-label');
    heading.textContent = label;
    const cover = stillCover(group);
    cover.className = 'chip-cover';
    const name = el('span', 'chip-name');
    name.dir = 'auto';
    name.textContent = group.name;
    const arrow = el('span', 'chip-arrow');
    setIcon(arrow, back ? ICONS.arrowBack : ICONS.arrowForward);
    const body = el('span', 'chip-body');
    body.append(...(back ? [arrow, cover, name] : [cover, name, arrow]));
    chip.replaceChildren(heading, body);
  }

  // A tale's media sent outside a document (servers before R16), exactly as the viewer drew it: an
  // image or video named by the tale's title, or a placeholder of that name.
  private renderLegacyMedia(tale: DeliveryTale): HTMLElement {
    const label = tale.title || `Tale ${this.tale + 1}`;
    const media = tale.media;
    const url = mediaUrl(media?.url);
    if (media?.kind === 'image' && url) {
      const img = el('img', 'media');
      img.alt = label;
      img.src = url;
      img.draggable = false;
      return img;
    }
    if (media?.kind === 'video' && url) {
      const video = el('video', 'media');
      video.setAttribute('aria-label', label);
      video.playsInline = true;
      // Under reduced motion the video waits on its first frame (`#t` paints it in Safari) until Play.
      video.preload = this.reduced ? 'metadata' : 'auto';
      video.src = this.reduced ? `${url}#t=0.001` : url;
      this.useVideo(video);
      return video;
    }
    const placeholder = el('span', 'media');
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', label);
    return placeholder;
  }

  // The tale's own media in the stage (R16), as the viewer always drew a tale's media: full-bleed
  // with the element's fit, named by its alt text or hidden when decorative. A video is the tale's
  // clock, uncapped, and plays with sound where the browser allows it. Null without a usable URL.
  private renderStageMedia(element: DeliveryTaleElement): HTMLElement | null {
    const props = element.props as { url?: unknown; fit?: unknown };
    const url = mediaUrl(props.url);
    if (!url) return null;
    let media: HTMLElement | null;
    if (element.type === 'video') {
      const video = el('video', 'media');
      video.playsInline = true;
      // Under reduced motion the video waits on its first frame (`#t` paints it in Safari) until Play.
      video.preload = this.reduced ? 'metadata' : 'auto';
      video.src = this.reduced ? `${url}#t=0.001` : url;
      video.style.objectFit = props.fit === 'cover' ? 'cover' : 'contain';
      const label = element.a11y?.decorative === true ? '' : (element.a11y?.label ?? '').trim();
      if (label) video.setAttribute('aria-label', label);
      this.useVideo(video);
      media = video;
    } else {
      media = renderImage(element, { reducedMotion: this.reduced });
      if (media) media.className = 'media';
    }
    if (media && element.a11y?.decorative === true) media.setAttribute('aria-hidden', 'true');
    return media;
  }

  // Makes `video` the current tale's clock: the tale ends when it ends (or, under reduced motion,
  // pauses there), its progress fills with it, and a video that fails runs the tale on the timer.
  // A document's video (`capped`) also ends the tale at 15 s (R5), and when it makes no progress
  // for {@link VIDEO_STALL_MS} while it should play.
  private useVideo(video: HTMLVideoElement, capped = false): void {
    const end = () => {
      if (video !== this.video) return;
      if (!this.reduced) this.next();
      else {
        video.pause();
        if (!this.paused) this.togglePause();
      }
    };
    video.addEventListener('ended', end);
    video.addEventListener('error', () => {
      if (video === this.video) this.startTimed();
    });
    video.addEventListener('timeupdate', () => {
      if (video !== this.video) return;
      if (capped) {
        if (video.currentTime * 1000 >= MAX_TALE_VIDEO_MS) {
          end();
          return;
        }
        this.armWatchdog();
      }
      if (!video.duration) return;
      const length = capped ? Math.min(video.duration, MAX_TALE_VIDEO_MS / 1000) : video.duration;
      this.fill().style.transform = `scaleX(${Math.min(1, video.currentTime / length)})`;
    });
    this.video = video;
    this.capped = capped;
  }

  // While a document's video should play, a stall of VIDEO_STALL_MS ends the tale (never under
  // reduced motion, where nothing moves on by itself).
  private armWatchdog(): void {
    this.disarmWatchdog();
    if (!this.capped || !this.video || this.reduced || this.paused || this.held) return;
    const video = this.video;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (video === this.video && !this.paused && !this.held) this.next();
    }, VIDEO_STALL_MS);
  }

  private disarmWatchdog(): void {
    if (this.watchdog !== undefined) clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  private fill(): HTMLElement {
    return this.parts.segments.children[this.tale].firstElementChild as HTMLElement;
  }

  // Runs the current tale on the timer: images, tales without media, and videos that failed.
  private startTimed(): void {
    if (this.video) {
      this.video.pause();
      this.video = null;
    }
    this.capped = false;
    this.disarmWatchdog();
    this.timed = true;
    this.remaining = this.duration;
    const fill = this.fill();
    fill.style.setProperty('--taleart-duration', `${this.duration}ms`);
    fill.classList.add('timed');
    this.applyPause();
  }

  // Brings the timer, the fill animation and the video in line with paused/held.
  private applyPause(): void {
    const dialog = this.dialog;
    if (!dialog) return;
    const stopped = this.paused || this.held;
    dialog.toggleAttribute('data-paused', stopped);
    if (this.timed) {
      if (stopped && this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.remaining -= Date.now() - this.startedAt;
      } else if (!stopped && this.timer === undefined && !this.reduced) {
        this.startedAt = Date.now();
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.next();
        }, Math.max(0, this.remaining));
      }
    } else if (this.video) {
      if (stopped) {
        this.video.pause();
        this.disarmWatchdog();
      } else {
        this.play(this.video);
        this.armWatchdog();
      }
    }
    // A document's video beside the tale's video plays and pauses with the tale, never while it is paused.
    for (const video of this.alongside) {
      if (stopped) video.pause();
      else void Promise.resolve(video.play()).catch(() => undefined);
    }
  }

  // Plays with sound where the browser allows it, else muted; media that cannot play runs on the timer.
  private play(video: HTMLVideoElement): void {
    const fail = (err: unknown): Promise<void> | void => {
      // A play() superseded by pause() or a new source rejects with AbortError: nothing failed.
      if (video !== this.video || this.paused || this.held || (err as Error | null)?.name === 'AbortError') return;
      if ((err as Error | null)?.name === 'NotAllowedError' && !video.muted) {
        video.muted = true;
        return Promise.resolve(video.play()).catch(fail);
      }
      this.startTimed();
    };
    try {
      void Promise.resolve(video.play()).catch(fail);
    } catch (err) {
      void fail(err);
    }
  }

  // Stops whatever the current tale runs, and removes its media.
  private stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.timed = false;
    this.video?.pause();
    this.video = null;
    this.capped = false;
    this.disarmWatchdog();
    for (const video of this.alongside) video.pause();
    this.alongside = [];
    this.media?.remove();
    this.media = null;
    this.layer?.remove();
    this.layer = null;
  }
}
