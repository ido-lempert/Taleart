import type { DeliveryTale, DeliveryTaleGroup } from '@taleart/contract';
import { prefersReducedMotion } from './bar';
import { loadTaleFonts } from './document/fonts';
import { canvasColor, DOCUMENT_STYLES, renderTaleDocument } from './document/renderer';

/** How long an image, or a tale without playable media, shows when its document sets no duration. */
export const IMAGE_DURATION_MS = 5000;
/** Horizontal travel that makes a pointer gesture a swipe between groups. */
export const SWIPE_MIN_PX = 50;
/** A press at least this long is a hold (pause), not a tap (step). */
export const HOLD_MIN_MS = 250;

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
${DOCUMENT_STYLES}`;

const ICONS = {
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  play: 'M7 4.5v15L19.5 12z',
  close: 'M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z',
};

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

export function setIcon(button: HTMLButtonElement, path: string): void {
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
 * zone's tale groups in order. Images show for {@link IMAGE_DURATION_MS}
 * (or their document's duration), videos to their end. A tale with a document
 * (AD-15) shows its elements over its media on a 9:16 canvas; its text is
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
    segments: HTMLElement;
    name: HTMLElement;
    pause: HTMLButtonElement;
    stage: HTMLElement;
    top: HTMLElement;
    status: HTMLElement;
  };
  private group = 0;
  private tale = 0;
  private media: HTMLElement | null = null;
  private layer: HTMLElement | null = null; // the current tale's document, over its media
  private video: HTMLVideoElement | null = null;
  private paused = false; // by the visitor (Space or the button)
  private held = false; // while a pointer is down on the stage
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timed = false; // the current tale runs on the timer, not a video
  private duration = IMAGE_DURATION_MS; // the current tale's time on the timer
  private remaining = 0;
  private startedAt = 0;
  private press: { x: number; y: number; at: number } | null = null;
  private suppressClick = false;
  private opened = false;
  private reduced = false;
  private rtl = false; // the host page lays out right to left: tap zones, arrows and swipes mirror
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onBlur = () => this.onPointerCancel();

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
    dialog.appendChild(frame);

    // One click handler for both zones: with pointer capture a tap's click may target the stage.
    stage.addEventListener('click', (e) => this.onStageClick(e));
    pause.addEventListener('click', () => this.togglePause());
    close.addEventListener('click', () => this.close());
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
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
    this.parts = { segments, name, pause, stage, top, status };
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
    const doc = current.document;
    this.duration = doc?.durationMs ?? IMAGE_DURATION_MS;
    // The media is framed the same with or without a document: full-bleed in the stage. A tale
    // with a document but no media shows its canvas colour instead, and the canvas carries the
    // tale's name.
    this.media = doc && !current.media ? null : this.renderMedia(current);
    if (this.media) stage.prepend(this.media);
    // Behind a document tale's media, its canvas colour fills the stage, such as the bands a
    // contained image leaves; without a document the stage stays the viewer's black.
    stage.style.backgroundColor = (current.media && doc && canvasColor(doc)) || '';
    if (doc) {
      // Its project fonts load now that it opens (R18); its text shows the fallback stack until then.
      loadTaleFonts(current);
      // A tale document (AD-16): its elements on a 9:16 canvas between the tap zones and the controls.
      this.layer = renderTaleDocument(doc, {
        background: !current.media,
        label: current.media ? undefined : current.title || `Tale ${tale + 1}`,
      });
      this.parts.top.before(this.layer);
    }
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

  private renderMedia(tale: DeliveryTale): HTMLElement {
    const label = tale.title || `Tale ${this.tale + 1}`;
    const media = tale.media;
    if (media?.kind === 'image') {
      const img = el('img', 'media');
      img.alt = label;
      img.src = media.url;
      img.draggable = false;
      return img;
    }
    if (media?.kind === 'video') {
      const video = el('video', 'media');
      video.setAttribute('aria-label', label);
      video.playsInline = true;
      // Under reduced motion the video waits on its first frame (`#t` paints it in Safari) until Play.
      video.preload = this.reduced ? 'metadata' : 'auto';
      video.src = this.reduced ? `${media.url}#t=0.001` : media.url;
      video.addEventListener('ended', () => {
        if (video !== this.video) return;
        if (!this.reduced) this.next();
        else if (!this.paused) this.togglePause();
      });
      video.addEventListener('error', () => {
        if (video === this.video) this.startTimed();
      });
      video.addEventListener('timeupdate', () => {
        if (video !== this.video || !video.duration) return;
        this.fill().style.transform = `scaleX(${Math.min(1, video.currentTime / video.duration)})`;
      });
      this.video = video;
      return video;
    }
    const placeholder = el('span', 'media');
    placeholder.setAttribute('role', 'img');
    placeholder.setAttribute('aria-label', label);
    return placeholder;
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
      if (stopped) this.video.pause();
      else this.play(this.video);
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
    this.media?.remove();
    this.media = null;
    this.layer?.remove();
    this.layer = null;
  }
}
