import {
  DEFAULT_TALE_DURATION_MS,
  EDITOR_ONLY_ELEMENT_FIELDS,
  resolveDocumentMedia,
  TALE_SAFE_AREA,
  type DeliveryFont,
  type DeliveryTale,
  type DeliveryTaleDocument,
  type DeliveryTaleElement,
  type DeliveryTaleGroup,
} from '@taleart/contract';
import { DOCUMENT_STYLES } from './document/renderer';
import { applyTheme } from './theme';
import { TaleViewer, VIEWER_BASE_STYLES } from './viewer';

/**
 * The phone sizes the Tale Studio preview offers, in CSS pixels (epic Tale Studio R10). The default
 * is the size the preview is compared with the sample page at.
 */
export const PREVIEW_SIZES = [
  { id: 'small', label: 'Small', width: 375, height: 667 },
  { id: 'default', label: 'Default', width: 390, height: 844 },
  { id: 'large', label: 'Large', width: 430, height: 932 },
] as const;

export type PreviewSizeId = (typeof PREVIEW_SIZES)[number]['id'];

/** The size the preview opens at: 390 × 844. */
export const DEFAULT_PREVIEW_SIZE: PreviewSizeId = 'default';

/**
 * A draft tale document (the studio's unsaved one) as the Delivery API would deliver it (AD-15):
 * hidden elements and the editor-only fields left out, and each media key turned into a URL by
 * `mediaUrl` (an element whose key gives no URL is left out, a media background becomes its
 * colour), so the preview renders exactly what a visitor's SDK would be sent.
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

// The SDK's viewer embedded in the preview: shown in place (not modal, never taking focus from the
// studio), always on a phone-sized screen whatever the dashboard window is, its links inert, and
// able to take a changed tale without starting over.
class PreviewViewer extends TaleViewer {
  protected override renderOptions = { inertLinks: true };

  protected override present(dialog: HTMLDialogElement): void {
    dialog.setAttribute('data-embedded', '');
    dialog.setAttribute('open', '');
  }

  protected override wide(): boolean {
    return false;
  }

  /** The current tale's time on the timer, in ms, while it runs on the timer; null while a video runs it. */
  get timerMs(): number | null {
    return this.opened && this.timed && !this.video ? this.duration : null;
  }

  /**
   * Takes the group again, as edited. While the tale runs on the timer with the same duration and
   * holds no video, it is redrawn in place and keeps playing where it was; otherwise it starts over.
   */
  update(group: DeliveryTaleGroup): void {
    const running = this.timerMs;
    this.groups = [group];
    if (!this.opened) return;
    this.parts.name.textContent = group.name;
    this.dialog?.setAttribute('aria-label', group.name);
    const tale = group.tales[this.tale];
    const doc = tale?.document;
    if (tale && running !== null && (doc?.durationMs ?? DEFAULT_TALE_DURATION_MS) === running && !hasVideo(doc)) {
      this.clearContent();
      this.renderContent(tale, this.tale);
    } else this.show(0, tale ? this.tale : 0, true);
  }
}

function hasVideo(doc: DeliveryTaleDocument | null | undefined): boolean {
  return !!doc?.elements?.some((e: DeliveryTaleElement) => e?.type === 'video');
}

/**
 * The Tale Studio preview (epic Tale Studio R10, AD-16): the Web SDK's own viewer and document
 * renderer, embedded in `host` in its own Shadow DOM, playing one tale as a visitor's viewer
 * would, with its chrome (progress, pause, close). Size the host to a phone size
 * ({@link PREVIEW_SIZES}); the viewer fills it as it fills a phone's screen. Links show but go
 * nowhere: the preview shows a draft, and its destinations never become live links in the
 * dashboard.
 */
export class TalePreview {
  private readonly root: ShadowRoot;
  private readonly themed: HTMLElement;
  private readonly overlay: HTMLElement;
  private viewer: PreviewViewer | null = null;
  private tale: PreviewTale | null = null;
  private ended = false;

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

  /**
   * Shows `tale`. The first call opens the viewer and starts playing; later calls show the changed
   * tale at once, keeping the playback where it can (see `update`). After the tale ended, a change
   * shows only once it is played again ({@link replay}).
   */
  show(tale: PreviewTale): void {
    this.tale = tale;
    const group = this.group(tale);
    if (!this.viewer) {
      this.start(group);
      return;
    }
    if (this.ended) return;
    this.viewer.update(group);
  }

  /** Plays the tale from its start. */
  replay(): void {
    if (this.tale) this.start(this.group(this.tale));
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

  // Closes the viewer without saying the tale ended: nothing played to its end.
  private stopViewer(): void {
    const viewer = this.viewer;
    this.viewer = null;
    viewer?.close();
  }

  private group(tale: PreviewTale): DeliveryTaleGroup {
    const delivered: DeliveryTale = { id: tale.id, title: tale.title, media: null, document: tale.document };
    if (tale.fonts?.length) delivered.fonts = tale.fonts;
    return { id: `preview-${tale.id}`, name: tale.groupName, cover: null, tales: [delivered] };
  }

  private start(group: DeliveryTaleGroup): void {
    this.stopViewer();
    this.themed.replaceChildren();
    this.ended = false;
    const viewer = new PreviewViewer(this.themed, [group], {
      onClose: () => {
        if (this.viewer !== viewer) return;
        this.ended = true;
        this.options.onEnded?.();
      },
    });
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
  }
}
