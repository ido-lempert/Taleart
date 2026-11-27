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
  type DeliveryZone,
} from '@taleart/contract';
import { BAR_FRAME_TYPE, BAR_STYLES, barLayoutStyles, renderBar } from './bar';
import { BANNER_FRAME_TYPE, BANNER_STYLES, renderBanner, type BannerView } from './banner';
import { DOCUMENT_STYLES } from './document/renderer';
import { DEFAULT_STRINGS, defaultTranslate, type Translate } from './i18n';
import { applyTheme, THEME_SCHEME_STYLES } from './theme';
import { TaleViewer, VIEWER_BASE_STYLES } from './viewer';
import { applyNonce } from './nonce';

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
  inset-inline: ${TALE_SAFE_AREA.side * 100}%;
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
  // The preview brings its own styles (the viewer's phone styles, see the constructor), never the wide-screen deck.
  protected override styles(): string {
    return '';
  }
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

  /**
   * Takes the zone's groups again, as edited (a group preview): the group on screen is drawn in place at its
   * tale when that can be, else it plays from its start at the same tale. A group no longer listed closes the viewer.
   */
  replaceGroups(groups: readonly DeliveryTaleGroup[]): void {
    const groupId = this.groupId;
    const at = this.tale;
    this.groups = groups.filter((group) => group.tales.length > 0);
    if (!this.opened || groupId === null) return;
    const index = this.groups.findIndex((group) => group.id === groupId);
    if (index < 0) {
      this.close();
      return;
    }
    const group = this.groups[index];
    this.group = index;
    this.parts.name.textContent = group.name;
    this.dialog?.setAttribute('aria-label', group.name);
    const tale = Math.min(at, group.tales.length - 1);
    if (tale === at && this.canRedraw(group.tales[tale])) {
      const keepMedia = !!this.video;
      this.clearContent(keepMedia);
      this.renderContent(group.tales[tale], tale, keepMedia);
      this.applyPause();
      return;
    }
    this.quiet = true;
    try {
      this.show(index, tale, true);
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
    applyNonce(style);
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

// What the zone's display draws: its frame, and each group's name, cover and tales' titles and media. A change in
// any of them redraws the display; a change in a tale's document only redraws the viewer's tale.
function displayKey(zone: DeliveryZone): string {
  return JSON.stringify({
    frame: zone.frame,
    groups: zone.taleGroups.map((group) => ({
      id: group.id,
      name: group.name,
      cover: group.cover,
      tales: group.tales.map((tale) => ({ id: tale.id, title: tale.title, media: tale.media })),
    })),
  });
}

/**
 * The Tale Studio's group preview (epic Tale Studio R10, AD-16, story 7.10): a tale group shown as a visitor's page
 * shows it. The zone's display is drawn by the SDK's own renderers, the bar or the banner the zone's frame names, with
 * the zone's tale groups, covers and display settings; the viewer that opens when an entry is tapped is the SDK's
 * viewer, here embedded in the host at a phone size, with its chrome and the same tale renderer. The zone data is what
 * the studio gives (the groups as the Delivery API would send them, with the unsaved tale in place of its published
 * one): the preview draws it as it stands, with no targeting applied.
 *
 * The viewer opens on the group by itself when the preview is first shown, and again on "replay"; a tap on an entry
 * opens its group as well. A change to the zone redraws the display, and the open viewer in place (or from the start of
 * its tale when its duration or video changed), once changes stop ({@link PREVIEW_REDRAW_MS}). Links show but go nowhere.
 */
export class GroupPreview {
  private readonly root: ShadowRoot;
  private readonly themed: HTMLElement;
  // The zone's display (bar or banner), over the page the preview draws behind it.
  private readonly page: HTMLElement;
  // Where the viewer is built; replaced on each open, so a closed viewer leaves nothing behind.
  private readonly viewerHost: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly t: Translate;
  private viewer: PreviewViewer | null = null;
  private zone: DeliveryZone | null = null;
  private groupId: string | null = null;
  private shownKey = '';
  private shownTheme = '';
  private banner: BannerView | null = null;
  private ended = false;
  private sound = false;
  private redrawTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    host: HTMLElement,
    private readonly options: TalePreviewOptions = {},
  ) {
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.t = options.t ?? defaultTranslate;
    const style = document.createElement('style');
    applyNonce(style);
    style.textContent = VIEWER_BASE_STYLES + DOCUMENT_STYLES + PREVIEW_STYLES + GROUP_PAGE_STYLES;
    this.themed = document.createElement('div');
    this.themed.className = 'taleart';
    this.page = document.createElement('div');
    this.page.className = 'group-page';
    this.viewerHost = document.createElement('div');
    this.viewerHost.className = 'group-viewer';
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
    this.themed.replaceChildren(this.page, this.viewerHost);
    this.root.replaceChildren(style, this.themed);
  }

  /** True while the viewer is open (playing or paused). */
  get isOpen(): boolean {
    return !!this.viewer?.isOpen;
  }

  /** Shows or hides the safe-area overlay. */
  setSafeArea(on: boolean): void {
    this.overlay.hidden = !on;
  }

  /** Turns sound on or off (off at first). */
  setSound(on: boolean): void {
    this.sound = on;
    this.viewer?.setSound(on);
  }

  /**
   * Shows `zone`'s display, and the viewer of `groupId` (the group being edited). The first call draws the display and
   * opens the viewer on the group; later calls redraw once changes stop. A zone with no display draws nothing.
   */
  show(zone: DeliveryZone, groupId: string): void {
    const first = this.zone === null;
    this.zone = zone;
    this.groupId = groupId;
    if (first) {
      this.redraw();
      this.openGroup(groupId);
      return;
    }
    clearTimeout(this.redrawTimer);
    this.redrawTimer = setTimeout(() => this.redraw(), PREVIEW_REDRAW_MS);
  }

  /**
   * Opens the viewer on the group again, from its first tale (after the viewer ended or was closed). With no group being
   * edited (the zone's own preview), it plays the zone's first group that has tales.
   */
  replay(): void {
    if (!this.zone || this.groupId === null) return;
    const first = this.zone.taleGroups.find((group) => group.tales.length > 0);
    this.openGroup(this.groupId || first?.id || '');
  }

  /** Pauses or resumes the viewer, as its Pause button does. */
  togglePause(): void {
    if (this.viewer?.isOpen) this.viewer.togglePause();
  }

  /** Stops playing and empties the host. */
  destroy(): void {
    clearTimeout(this.redrawTimer);
    this.stopViewer();
    this.banner?.destroy();
    this.banner = null;
    this.root.replaceChildren();
  }

  // Draws the zone as it now is: the display when it changed, the theme, and the open viewer in place.
  private redraw(): void {
    const zone = this.zone;
    if (!zone) return;
    const theme = JSON.stringify(zone.theme ?? null);
    if (theme !== this.shownTheme) {
      this.shownTheme = theme;
      applyTheme(this.themed, zone.theme ?? {});
    }
    const key = displayKey(zone);
    if (key !== this.shownKey) this.drawDisplay(zone);
    const viewer = this.viewer;
    // An ended viewer stays ended until it is replayed, as the tale preview's does.
    if (!viewer?.isOpen || this.ended) return;
    if (viewer.groupId !== this.groupId) this.openGroup(this.groupId ?? '');
    else viewer.replaceGroups(zone.taleGroups);
  }

  // Draws the zone's display: the bar or the banner its frame names, as the SDK's element draws it.
  private drawDisplay(zone: DeliveryZone): void {
    this.banner?.destroy();
    this.banner = null;
    this.shownKey = displayKey(zone);
    const style = document.createElement('style');
    applyNonce(style);
    style.textContent = THEME_SCHEME_STYLES + BAR_STYLES + BANNER_STYLES + barLayoutStyles();
    const frame = zone.frame;
    let display: HTMLElement | null = null;
    if (frame?.type === BAR_FRAME_TYPE) {
      const list = renderBar(zone.taleGroups, new Set(), frame.settings, undefined, this.t);
      // A tap on an entry opens its group, as the element's bar does.
      list.addEventListener('click', (event) => {
        const item = (event.target as Element | null)?.closest<HTMLButtonElement>('button.item');
        if (item) this.openGroup(item.dataset['taleGroupId'] ?? '');
      });
      display = list;
    } else if (frame?.type === BANNER_FRAME_TYPE) {
      const banner = renderBanner(zone.taleGroups, frame.settings, (groupId) => this.openGroup(groupId), this.t);
      if (banner) {
        this.banner = banner;
        display = banner.element;
      }
    }
    this.page.replaceChildren(style);
    if (display) this.page.appendChild(display);
    this.banner?.refresh();
  }

  // Opens the viewer on `groupId` at its first tale, in place of any viewer open now. An unknown group opens nothing.
  private openGroup(groupId: string): void {
    const zone = this.zone;
    // A zone with no display shows no group to a visitor, so nothing opens here either.
    if (!zone?.frame) return;
    this.stopViewer();
    this.viewerHost.replaceChildren();
    this.ended = false;
    const viewer = new PreviewViewer(this.viewerHost, zone.taleGroups, {
      t: this.t,
      onClose: () => {
        if (this.viewer !== viewer) return;
        this.ended = true;
        this.options.onEnded?.();
      },
    });
    viewer.sound = this.sound;
    if (!viewer.open(groupId)) return;
    this.viewer = viewer;
    // Over the tale, under nothing: the overlay sits in the viewer's frame, above the document.
    this.viewerHost.querySelector('.frame')?.appendChild(this.overlay);
    // Inert links never navigate, even when activated by script or the keyboard.
    this.viewerHost.querySelector('dialog')?.addEventListener(
      'click',
      (e) => {
        if ((e.target as Element | null)?.closest?.('a')) e.preventDefault();
      },
      true,
    );
    this.options.onStarted?.();
  }

  // Closes the viewer without saying the group ended: nothing played to its end.
  private stopViewer(): void {
    const viewer = this.viewer;
    this.viewer = null;
    viewer?.close();
  }
}

// The page the zone's display sits on in the group preview: a plain white page with the display's gutter. The viewer's
// layer lies over the page but takes no pointer events of its own while no viewer is open, so the display's entries
// still receive taps; the open viewer's dialog takes them back.
const GROUP_PAGE_STYLES = `
.group-page { position: absolute; inset: 0; overflow: hidden; padding: 16px 12px; background: #ffffff; box-sizing: border-box; }
.group-viewer { position: absolute; inset: 0; pointer-events: none; }
.group-viewer > * { pointer-events: auto; }
`;
