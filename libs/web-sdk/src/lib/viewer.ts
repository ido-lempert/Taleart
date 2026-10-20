import type { DeliveryTale, DeliveryTaleGroup } from '@taleart/contract';

/** How long an image, or a tale without playable media, shows. */
export const IMAGE_DURATION_MS = 5000;
/** Horizontal travel that makes a pointer gesture a swipe between groups. */
export const SWIPE_MIN_PX = 50;
/** A press at least this long is a hold (pause), not a tap (step). */
export const HOLD_MIN_MS = 250;

/**
 * Full-screen viewer look. Colours are TaleArt's defaults until the theme
 * story; white on black passes contrast, controls are 44 px targets.
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
  font: 14px/1.4 system-ui, sans-serif;
  overflow: hidden;
  overscroll-behavior: contain;
  touch-action: none;
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
.zone.prev { left: 0; width: 33.333%; }
.zone.next { right: 0; width: 66.667%; }
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
.fill { display: block; height: 100%; background: #fff; transform-origin: left; transform: scaleX(0); }
.done .fill { transform: none; }
.fill.timed { animation: taleart-fill var(--taleart-duration) linear forwards; }
.viewer[data-paused] .fill { animation-play-state: paused; }
@keyframes taleart-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
.head { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.control {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
}
.control:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
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
`;

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

function setIcon(button: HTMLButtonElement, path: string): void {
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
 * zone's tale groups in order. Images show for {@link IMAGE_DURATION_MS},
 * videos to their end. Tap or arrow keys step through tales (and across
 * groups), a swipe moves between groups, a hold or Space pauses, and Escape
 * or Close closes. Groups without tales are skipped.
 */
export class TaleViewer {
  private readonly groups: readonly DeliveryTaleGroup[];
  private dialog: HTMLDialogElement | null = null;
  private parts!: {
    segments: HTMLElement;
    name: HTMLElement;
    pause: HTMLButtonElement;
    stage: HTMLElement;
    status: HTMLElement;
  };
  private group = 0;
  private tale = 0;
  private media: HTMLElement | null = null;
  private video: HTMLVideoElement | null = null;
  private paused = false; // by the visitor (Space or the button)
  private held = false; // while a pointer is down on the stage
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timed = false; // the current tale runs on the timer, not a video
  private remaining = 0;
  private startedAt = 0;
  private press: { x: number; y: number; at: number } | null = null;
  private suppressClick = false;

  constructor(
    private readonly root: ShadowRoot | HTMLElement,
    groups: readonly DeliveryTaleGroup[],
    private readonly options: TaleViewerOptions = {},
  ) {
    this.groups = groups.filter((group) => group.tales.length > 0);
  }

  get isOpen(): boolean {
    return this.dialog !== null;
  }

  /** The id of the group on screen, or null when closed. */
  get groupId(): string | null {
    return this.dialog ? this.groups[this.group].id : null;
  }

  /** Opens the group `groupId` at its first tale; false for an unknown group or one without tales. */
  open(groupId: string): boolean {
    const index = this.groups.findIndex((group) => group.id === groupId);
    if (index < 0) return false;
    if (this.dialog) this.close();
    this.paused = false;
    this.held = false;
    this.build();
    const dialog = this.dialog as unknown as HTMLDialogElement;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.focus();
    this.show(index, 0, true);
    return true;
  }

  /** Closes the viewer and stops playback; tells `onClose` the group shown last. */
  close(): void {
    const dialog = this.dialog;
    if (!dialog) return;
    const groupId = this.groups[this.group].id;
    this.stop();
    this.dialog = null;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    dialog.remove();
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
    const { pause } = this.parts;
    pause.setAttribute('aria-label', this.paused ? 'Play' : 'Pause');
    setIcon(pause, this.paused ? ICONS.play : ICONS.pause);
    this.applyPause();
  }

  private build(): void {
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

    prev.addEventListener('click', () => this.onZone(() => this.previous()));
    next.addEventListener('click', () => this.onZone(() => this.next()));
    pause.addEventListener('click', () => this.togglePause());
    close.addEventListener('click', () => this.close());
    stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    dialog.addEventListener('pointerup', (e) => this.onPointerUp(e));
    dialog.addEventListener('pointercancel', () => this.onPointerCancel());
    dialog.addEventListener('contextmenu', (e) => e.preventDefault());
    dialog.addEventListener('keydown', (e) => this.onKeyDown(e));
    // Firefox activates a focused button on Space's keyup.
    dialog.addEventListener('keyup', (e) => {
      if (e.key === ' ') e.preventDefault();
    });
    // Escape asks the modal dialog to close: close through `close()` so focus returns.
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close();
    });
    dialog.addEventListener('close', () => this.close());

    this.root.appendChild(dialog);
    this.dialog = dialog;
    this.parts = { segments, name, pause, stage, status };
  }

  private onZone(step: () => void): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    step();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowRight') this.next();
    else if (e.key === 'ArrowLeft') this.previous();
    else if (e.key === ' ') {
      if (!e.repeat) this.togglePause();
    } else if (e.key === 'Escape') this.close();
    else return;
    e.preventDefault();
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.suppressClick = false;
    this.press = { x: e.clientX, y: e.clientY, at: Date.now() };
    this.held = true;
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
      this.suppressClick = true;
      if (dx < 0) this.nextGroup();
      else {
        this.previousGroup();
        this.applyPause();
      }
      return;
    }
    if (Date.now() - press.at >= HOLD_MIN_MS) this.suppressClick = true;
    this.applyPause();
  }

  private onPointerCancel(): void {
    this.press = null;
    this.held = false;
    this.applyPause();
  }

  // Shows tale `tale` of group `group`, rebuilding the group's parts when it changes.
  private show(group: number, tale: number, newGroup = group !== this.group): void {
    if (!this.dialog) return;
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
    status.textContent = `${g.name}, tale ${tale + 1} of ${g.tales.length}`;

    this.media = this.renderMedia(g.tales[tale]);
    stage.prepend(this.media);
    this.options.onGroupShown?.(g.id);
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
      video.preload = 'auto';
      video.src = media.url;
      video.addEventListener('ended', () => {
        if (video === this.video) this.next();
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
    this.remaining = IMAGE_DURATION_MS;
    const fill = this.fill();
    fill.style.setProperty('--taleart-duration', `${IMAGE_DURATION_MS}ms`);
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
      } else if (!stopped && this.timer === undefined) {
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
      if (video !== this.video || this.paused || this.held) return;
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
  }
}
