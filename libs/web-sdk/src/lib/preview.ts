import {
  DEFAULT_TALE_DURATION_MS,
  EDITOR_ONLY_ELEMENT_FIELDS,
  resolveDocumentMedia,
  stageTaleMedia,
  TALE_SAFE_AREA,
  type DeliveryFont,
  type DeliveryTale,
  type DeliveryTaleDocument,
  type DeliveryTaleElement,
  type DeliveryTaleGroup,
} from '@taleart/contract';
import { DOCUMENT_STYLES } from './document/renderer';
import { DEFAULT_STRINGS, type Translate } from './i18n';
import { applyTheme } from './theme';
import { TaleViewer, VIEWER_BASE_STYLES } from './viewer';

/**
 * The phone sizes the Tale Studio preview offers, in CSS pixels (epic Tale Studio R10). The default
 * is the size the preview is compared with the sample page at.
 */
export const PREVIEW_SIZES = [
  { id: 'small', label: DEFAULT_STRINGS['preview.size.small'], labelKey: 'preview.size.small', width: 375, height: 667 },
  { id: 'default', label: DEFAULT_STRINGS['preview.size.default'], labelKey: 'preview.size.default', width: 390, height: 844 },
  { id: 'large', label: DEFAULT_STRINGS['preview.size.large'], labelKey: 'preview.size.large', width: 430, height: 932 },
] as const;

export type PreviewSizeId = (typeof PREVIEW_SIZES)[number]['id'];

/** The size the preview opens at: 390 × 844. */
export const DEFAULT_PREVIEW_SIZE: PreviewSizeId = 'default';

/** How long the preview waits after the last change before it redraws the tale. */
export const PREVIEW_REDRAW_MS = 150;

/**
 * How long the preview waits after the last change before it plays a tale from its start, when a
 * change cannot be drawn in place (its duration or the video that runs it changed).
 */
export const PREVIEW_RESTART_MS = 500;

/**
 * A draft tale document (the studio's unsaved one) as the Delivery API would deliver it (AD-15):
 * hidden elements and the editor-only fields left out, and each media key turned into a URL by
 * `mediaUrl` (an element whose key gives no URL is left out, a media background becomes its
 * colour), so the preview renders what a visitor's SDK would be sent.
 *
 * Limits against delivery: the server also validates a document when it is updated to the site
 * (schema, size and text limits, alt text, one video and one swipe-up link) and delivers none that
 * fails, while the preview draws the draft as it stands. The SDK's own checks still apply here as
 * for visitors (unknown types, unsafe URLs and invalid values render nothing), and the studio
 * itself keeps a draft within those rules.
 */
export function previewDocument(
  doc: { canvas: unknown; elements: readonly unknown[]; version?: unknown; durationMs?: unknown },
  mediaUrl: (key: string) => string | null,
): DeliveryTaleDocument {
  const elements = doc.elements
    .filter((element) => (element as { hidden?: unknown } | null)?.hidden !== true)
    .map((element) => {
      const delivered: Record<string, unknown> = { ...(element as object) };
      for (const field of EDITOR_ONLY_ELEMENT_FIELDS) delete delivered[field];
      return delivered;
    });
  return resolveDocumentMedia({ ...doc, elements }, mediaUrl) as unknown as DeliveryTaleDocument;
}

/** What the preview shows: one tale of a group, as the viewer would open it. */
export interface PreviewTale {
  /** The tale's id. */
  id: string;
  /** The tale's title, which names its canvas for screen readers. */
  title: string;
  /** The name of the tale's group, shown in the viewer's top bar. */
  groupName: string;
  /** The document as delivered: see {@link previewDocument}. */
  document: DeliveryTaleDocument;
  /** The project fonts its text uses, with absolute URLs. */
  fonts?: DeliveryFont[];
}

export interface TalePreviewOptions {
  /** Called when the tale has played to its end or the viewer's Close was used: the viewer is closed. */
  onEnded?: () => void;
  /** Called whenever a tale starts playing from its start (a first show, another tale, or `replay`). */
  onStarted?: () => void;
  /** The preview's and viewer's strings, in the studio's locale (see `i18n.ts`); English when left out. */
  t?: Translate;
}

/** The look only the preview adds: the viewer fills the host, and the safe-area overlay. */
const PREVIEW_STYLES = `
:host { all: initial; display: block; position: relative; overflow: hidden; contain: strict; background: #000; }
.taleart { position: absolute; inset: 0; }
.viewer[data-embedded] { position: absolute; container-type: size; }
.viewer[data-embedded] .frame { max-width: 56.25cqh; }
.ta-safe-overlay { z-index: 3; }
.ta-safe-overlay[hidden] { display: none; }
.ta-safe {
  position: absolute;
  top: ${TALE_SAFE_AREA.top * 100}%;
  bottom: ${TALE_SAFE_AREA.bottom * 100}%;
  left: ${TALE_SAFE_AREA.side * 100}%;
  right: ${TALE_SAFE_AREA.side * 100}%;
  outline: 2px dashed #22d3ee;
  box-shadow: 0 0 0 100vmax rgba(34, 211, 238, 0.18);
}
`;

function videosIn(node: HTMLElement | null): HTMLVideoElement[] {
  if (!node) return [];
  return node instanceof HTMLVideoElement ? [node] : [...node.querySelectorAll('video')];
}

// Stops a video that leaves the preview and lets its download go.
function release(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    // Environments without media support.
  }
}

// The SDK's viewer embedded in the preview: shown in place (a region, not a modal dialog, never
// taking focus from the studio), always on a phone-sized screen whatever the dashboard window is,
// letting the page scroll, its links inert, muted unless sound is asked for, and able to take a
// changed tale without starting over.
class PreviewViewer extends TaleViewer {
  protected override renderOptions = { inertLinks: true };
  /** True once the person asked for sound: the tale's own video then plays with it, as for visitors. */
  sound = false;
  private quiet = false; // a redraw: the live region does not say the tale again
  private shown: DeliveryTale | null = null;

  protected override present(dialog: HTMLDialogElement): void {
    dialog.setAttribute('data-embedded', '');
    dialog.setAttribute('role', 'region');
    dialog.setAttribute('aria-roledescription', 'preview');
    dialog.querySelector('.close')?.setAttribute('aria-label', this.t('preview.stop'));
    dialog.setAttribute('open', '');
  }

  protected override wide(): boolean {
    return false;
  }

  protected override holdsScroll(): boolean {
    return false;
  }

  protected override announce(text: string): void {
    if (!this.quiet) super.announce(text);
  }

  protected override play(video: HTMLVideoElement): void {
    video.muted = !this.sound || video !== this.media;
    super.play(video);
  }

  protected override renderContent(current: DeliveryTale, tale: number, keepMedia = false): void {
    this.shown = current;
    super.renderContent(current, tale, keepMedia);
  }

  protected override clearContent(keepMedia = false): void {
    for (const video of [...videosIn(keepMedia ? null : this.media), ...videosIn(this.layer)]) release(video);
    super.clearContent(keepMedia);
  }

  /** Turns sound on or off; the tale's own video follows at once. */
  setSound(on: boolean): void {
    this.sound = on;
    if (this.video) this.video.muted = !on || this.video !== this.media;
  }

  /**
   * True when `tale` can be drawn in place of the tale on screen without starting over: on the
   * timer with the same duration and no video, or run by the tale's own video, which is unchanged.
   */
  canRedraw(tale: DeliveryTale | undefined): boolean {
    const before = this.shown;
    if (!this.opened || !tale || !before) return false;
    const doc = tale.document;
    if (this.timed && !this.video) {
      return (doc?.durationMs ?? DEFAULT_TALE_DURATION_MS) === this.duration && !hasVideo(doc);
    }
    // The tale's own video runs it: kept while it is the same element, and no other video comes or goes.
    const own = stageTaleMedia(doc);
    return (
      !!this.video &&
      this.video === this.media &&
      JSON.stringify(own) === JSON.stringify(stageTaleMedia(before.document)) &&
      videoCount(doc) === videoCount(before.document)
    );
  }

  /** Takes the group again, as edited: redrawn in place when it can be, else from its start. */
  update(group: DeliveryTaleGroup): void {
    this.groups = [group];
    if (!this.opened) return;
    this.parts.name.textContent = group.name;
    this.dialog?.setAttribute('aria-label', group.name);
    const tale = group.tales[this.tale];
    if (tale && this.canRedraw(tale)) {
      const keepMedia = !!this.video;
      this.clearContent(keepMedia);
      this.renderContent(tale, this.tale, keepMedia);
      this.applyPause();
      return;
    }
    this.restart();
  }

  /** Plays the tale on screen from its start, without saying it again. */
  restart(): void {
    if (!this.opened) return;
    this.quiet = true;
    try {
      this.show(0, Math.min(this.tale, this.groups[0].tales.length - 1), true);
    } finally {
      this.quiet = false;
    }
  }
}

function hasVideo(doc: DeliveryTaleDocument | null | undefined): boolean {
  return videoCount(doc) > 0;
}

function videoCount(doc: DeliveryTaleDocument | null | undefined): number {
  return doc?.elements?.filter((e: DeliveryTaleElement) => e?.type === 'video').length ?? 0;
}

/**
 * The Tale Studio preview (epic Tale Studio R10, AD-16): the Web SDK's own viewer and document
 * renderer, embedded in `host` in its own Shadow DOM, playing one tale as a visitor's viewer
 * would, with its chrome (progress, pause, and close as "Stop preview"). Size the host to a phone
 * size ({@link PREVIEW_SIZES}); the viewer fills it as it fills a phone's screen. It starts muted
 * ({@link setSound}). Links show and take focus but go nowhere: the preview shows a draft, and its
 * destinations never become live links in the dashboard.
 */
export class TalePreview {
  private readonly root: ShadowRoot;
  private readonly themed: HTMLElement;
  private readonly overlay: HTMLElement;
  private viewer: PreviewViewer | null = null;
  private tale: PreviewTale | null = null;
  private applied = ''; // the group last given to the viewer, as JSON
  private ended = false;
  private sound = false;
  private redrawTimer: ReturnType<typeof setTimeout> | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    host: HTMLElement,
    private readonly options: TalePreviewOptions = {},
  ) {
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = VIEWER_BASE_STYLES + DOCUMENT_STYLES + PREVIEW_STYLES;
    this.themed = document.createElement('div');
    this.themed.className = 'taleart';
    // The safe areas (R3), drawn over the canvas exactly where the document's canvas lies.
    this.overlay = document.createElement('div');
    this.overlay.className = 'ta-area ta-safe-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.hidden = true;
    const canvas = document.createElement('div');
    canvas.className = 'ta-canvas';
    const safe = document.createElement('div');
    safe.className = 'ta-safe';
    canvas.appendChild(safe);
    this.overlay.appendChild(canvas);
    applyTheme(this.themed, {});
    this.root.replaceChildren(style, this.themed);
  }

  /** True while the viewer is open (playing or paused), false once the tale ended or was closed. */
  get isOpen(): boolean {
    return !!this.viewer?.isOpen;
  }

  /** Applies the project's theme (R9) as the visitor's viewer would: its font and accent. */
  setTheme(theme: unknown): void {
    applyTheme(this.themed, theme ?? {});
  }

  /** Shows or hides the safe-area overlay. */
  setSafeArea(on: boolean): void {
    this.overlay.hidden = !on;
  }

  /** Turns sound on or off (off at first): the tale's own video plays with sound where the browser allows it. */
  setSound(on: boolean): void {
    this.sound = on;
    this.viewer?.setSound(on);
  }

  /**
   * Shows `tale`. The first call, and a call with another tale, opens the viewer and starts
   * playing. Later calls show the changed tale: drawn in place {@link PREVIEW_REDRAW_MS} after the
   * last change, keeping the playback where it is; when that cannot be (a new duration or another
   * video), it plays from its start {@link PREVIEW_RESTART_MS} after the last change. An unchanged
   * tale changes nothing. After the tale ended, a change shows once it is played again ({@link replay}).
   */
  show(tale: PreviewTale): void {
    const other = !this.tale || tale.id !== this.tale.id;
    this.tale = tale;
    if (!this.viewer || other) {
      this.start();
      return;
    }
    if (this.ended) return;
    clearTimeout(this.redrawTimer);
    clearTimeout(this.restartTimer);
    this.redrawTimer = setTimeout(() => this.redraw(), PREVIEW_REDRAW_MS);
  }

  /** Plays the tale from its start. */
  replay(): void {
    if (this.tale) this.start();
  }

  /** Pauses or resumes, as the viewer's Pause button does. */
  togglePause(): void {
    if (this.viewer?.isOpen) this.viewer.togglePause();
  }

  /** Stops playing and empties the host. */
  destroy(): void {
    this.stopViewer();
    this.root.replaceChildren();
  }

  // Gives the viewer the tale as it now is: in place at once, or from its start once changes stop.
  private redraw(): void {
    const viewer = this.viewer;
    if (!viewer || !this.tale || this.ended) return;
    const group = this.group(this.tale);
    const json = JSON.stringify(group);
    if (json === this.applied) return;
    const apply = () => {
      if (this.viewer !== viewer || this.ended) return;
      this.applied = json;
      viewer.update(group);
    };
    if (viewer.canRedraw(group.tales[0])) apply();
    else this.restartTimer = setTimeout(apply, PREVIEW_RESTART_MS - PREVIEW_REDRAW_MS);
  }

  // Closes the viewer without saying the tale ended: nothing played to its end.
  private stopViewer(): void {
    clearTimeout(this.redrawTimer);
    clearTimeout(this.restartTimer);
    const viewer = this.viewer;
    this.viewer = null;
    viewer?.close();
  }

  private group(tale: PreviewTale): DeliveryTaleGroup {
    const delivered: DeliveryTale = { id: tale.id, title: tale.title, media: null, document: tale.document };
    if (tale.fonts?.length) delivered.fonts = tale.fonts;
    // A preview shows the tale to the person editing it, so no targeting tags or audience rule apply.
    return { id: `preview-${tale.id}`, name: tale.groupName, cover: null, tags: [], tagMatch: 'any', audience: null, tales: [delivered] };
  }

  private start(): void {
    const tale = this.tale;
    if (!tale) return;
    this.stopViewer();
    this.themed.replaceChildren();
    this.ended = false;
    const group = this.group(tale);
    this.applied = JSON.stringify(group);
    const viewer = new PreviewViewer(this.themed, [group], {
      t: this.options.t,
      onClose: () => {
        if (this.viewer !== viewer) return;
        this.ended = true;
        clearTimeout(this.redrawTimer);
        clearTimeout(this.restartTimer);
        this.options.onEnded?.();
      },
    });
    viewer.sound = this.sound;
    this.viewer = viewer;
    viewer.open(group.id);
    // Over the tale, under nothing: the overlay sits in the viewer's frame, above the document.
    this.themed.querySelector('.frame')?.appendChild(this.overlay);
    // Inert links never navigate, even when activated by script or the keyboard.
    this.themed.querySelector('dialog')?.addEventListener(
      'click',
      (e) => {
        if ((e.target as Element | null)?.closest?.('a')) e.preventDefault();
      },
      true,
    );
    this.options.onStarted?.();
  }
}
