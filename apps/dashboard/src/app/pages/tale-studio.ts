import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  linkedSignal,
  OnChanges,
  type SimpleChanges,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ErrorCodes,
  visibilityOf,
  visibilitySummary,
  type MediaKind,
  type ProjectFont,
  type ProjectMedia,
  type Visibility,
} from '@taleart/contract/core';
import { loadProjectFont, projectFontIds } from '@taleart/contract/project-fonts';
import {
  cleanText,
  DEFAULT_TALE_DURATION_MS,
  ELEMENT_TEXT_RULE,
  EMOJI_FONT_STACK,
  emojiFontSize,
  emptyTaleDocument,
  elementBounds,
  hasAltText,
  hasVideoElement,
  isLinkElement,
  isMediaElement,
  isSwipeUpBox,
  isOutsideSafeArea,
  readingOrder,
  isTaleMediaElement,
  stageTaleMedia,
  limitedVideoCount,
  MAX_VIDEO_ELEMENTS,
  MAX_TALE_DURATION_MS,
  MAX_TALE_VIDEO_MS,
  MAX_TALE_ELEMENTS,
  MAX_TEXT_LENGTH,
  MAX_SWIPE_UP_ELEMENTS,
  MEDIA_FITS,
  MIN_TALE_DURATION_MS,
  NEW_BUTTON_BOX,
  NEW_EMOJI_BOX,
  NEW_IMAGE_BUTTON_BOX,
  NEW_LINE_BOX,
  NEW_MEDIA_BOX,
  NEW_SHAPE_BOX,
  NEW_STICKER_BOX,
  NEW_TEXT_BOX,
  newButtonProps,
  newShapeProps,
  newSwipeUpProps,
  SWIPE_UP_BOX,
  TALE_SAFE_AREA,
  type MediaElement,
  type ShapeElement,
  type ShapeKind,
  type PublishedTaleDocument,
  type TaleDocument,
  type TaleElement,
  type TaleElementBox,
  type TaleElementType,
  UNKNOWN_MEDIA_REASON,
} from '@taleart/contract/tale-document';
import {
  isSmallTarget,
  resolveTextStyle,
  textContrast,
  type TextBackdrop,
} from '@taleart/contract/text-style';
import { DashboardStore } from '../dashboard.store';
import { formatLocal } from '../schedule';
import { Icon } from '../icon';
import { projectFontFileUrl, ProjectFontsService } from '../project-fonts.service';
import { projectMediaSrc } from '../project-media.service';
import { TaleDocumentService, type TaleDocumentFailure } from '../tale-document.service';
import { ThemeService } from '../theme.service';
import { TaleTextStyle, type TextStyleChange } from './tale-text-style';
import {
  BackdropReads,
  TaleBackdropSampler,
  type BackdropResults,
} from './tale-backdrop';
import { DuplicateTale, duplicatedMessage, type DuplicatedTale } from './duplicate-tale';
import { AUTOSAVE_TIMING, TaleAutosaver, type AutosaveState } from './tale-autosave';
import { changeCount, sameDocument, siteVersion, TaleHistory } from './tale-history';
import { TaleLayerMenu, type LayerMenuItem } from './tale-layer-menu';
import { FIT_NAMES, STICKER_CONTENT_TYPES, TaleMediaPicker, TaleMediaStyle } from './tale-media';
import { needsLinkUrl, TaleLinkStyle } from './tale-links';
import {
  addMenuRows,
  STUDIO_TEST_ELEMENT_TYPES,
  studioElementTypes,
  type AddMenuEntry,
  type StudioElementType,
} from './tale-element-types';
import { TaleFieldsInspector } from './tale-fields-inspector';
import { contrastChange, isLowContrast, labelBackdrop, wantedReads, type SampleLookup } from './tale-contrast';
import {
  kindName,
  linkView,
  newTextProps,
  shapeView,
  textView,
  type LinkView,
  type ShapeView,
  type TextView,
} from './tale-canvas-view';
import { TalePreviewPane } from './tale-preview';
import {
  SHAPE_NAMES,
  TaleEmojiPicker,
  TaleEmojiStyle,
  TaleShapeStyle,
  type ElementChange,
  type EmojiChoice,
} from './tale-shapes';
import {
  arrowMove,
  boundsOf,
  clamp,
  clampMove,
  duplicateElement,
  historyKeyShortcuts,
  historyLabel,
  hiddenUnder,
  historyShortcut,
  isApple,
  isMenuKey,
  isSelectionKey,
  isTextEntry,
  LAYER_KEYSHORTCUTS,
  layerName,
  layerSpokenName,
  layerShortcut,
  moveBox,
  percent,
  reorder,
  round,
  snap,
  SNAP_DISTANCE_PX,
  shortcutLabel,
  snapTargets,
  type HistoryCommand,
  type LayerCommand,
  type ReorderCommand,
  type SnapTargets,
} from './tale-layers';

/** How far an arrow key moves an element, as a fraction of the canvas; Shift moves ten times as far. */
const MOVE_STEP = 0.01;

/** How long leaving the studio waits for unsaved changes to save before it asks (ms). */
const LEAVE_WAIT_MS = 5000;

/** How often, at most, coming back to the page reads the tale again (ms). */
export const BACK_TO_PAGE_INTERVAL_MS = 15_000;

/** Where a layer command came from: focus returns there, to the canvas element or to the layer row. */
type Origin = 'canvas' | 'list';

interface Drag {
  /** The element under the pointer. */
  id: string;
  /** The elements that move: the selection's unlocked, shown ones, at their boxes when the drag began. */
  boxes: Map<string, TaleElementBox>;
  targets: SnapTargets;
  pointerId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  moved: boolean;
  /** The element is locked: the drag only says so. */
  locked: boolean;
  /** The document when the drag began: the whole drag is one step in the history. */
  before: TaleDocument;
}

interface OpenMenu {
  x: number;
  y: number;
  items: LayerMenuItem[];
  origin: Origin;
  /** The DOM id of what opened the menu, focused again when it closes. */
  returnId: string;
}

const LOCKED = 'This layer is locked. Unlock it in the layers list to move or edit it.';
const PINNED = 'The swipe-up link is pinned to the bottom of the tale: it does not move.';
const REORDERED: Record<ReorderCommand, [string, string]> = {
  forward: ['brought forward', 'Already at the front'],
  backward: ['sent backward', 'Already at the back'],
  front: ['moved to the front', 'Already at the front'],
  back: ['moved to the back', 'Already at the back'],
};
const layers = (n: number) => (n === 1 ? 'Layer' : `${n} layers`);
/** The media picker while it is open: what it picks for, and of which kind. */
interface OpenPicker {
  purpose: 'add' | 'replace' | 'background';
  kind: MediaKind;
  /** Picks an image sticker: PNG, WebP and GIF images only (R6). */
  sticker: boolean;
  /** Picks the image of an image button (R7). */
  imageButton?: boolean;
  heading: string;
  /** The element whose media `replace` changes. */
  elementId: string | null;
  currentKey: string | null;
  returnFocus: HTMLElement | null;
}

// The props of a media element given other media: other media is not the tale's own (R16), so the
// mark goes, and the server keeps the tale's media apart from it.
function replacedMedia<P extends object>(props: P, mediaKey: string): P {
  const next: Record<string, unknown> = { ...props, mediaKey };
  delete next['taleMedia'];
  return next as P;
}

/**
 * Tale Studio (epic Tale Studio): a tale on a 9:16 canvas with its media over the canvas colour,
 * where a content manager adds elements of every registered type (texts, media, shapes, emoji,
 * stickers, buttons and the swipe-up link; their inspectors, the canvas views in
 * `tale-canvas-view.ts`, the layer logic in `tale-layers.ts`), types texts in place, moves
 * them by dragging (snapping to the centre, the safe-area edges and other elements), by the arrow
 * keys (Shift for larger steps) or by position fields, arranges them in a layers list (select,
 * reorder, hide, lock, duplicate, delete, from the row, an actions menu or the keyboard), sets
 * the background colour and shows the safe areas. Every change is a step in the history (undo and
 * redo from the keyboard or the toolbar), and the tale document (AD-15) saves itself. A save
 * based on an older revision is refused by the API; the page then offers to reload the latest
 * version or to keep this version as a new tale in the same group.
 */
@Component({
  selector: 'app-tale-studio-page',
  imports: [
    RouterLink,
    Icon,
    TaleLayerMenu,
    TaleTextStyle,
    TaleMediaPicker,
    TaleMediaStyle,
    TaleEmojiPicker,
    TaleShapeStyle,
    TaleEmojiStyle,
    TaleLinkStyle,
    TaleFieldsInspector,
    TalePreviewPane,
    DuplicateTale,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tale-studio.html',
  // The page's own layout, then the canvas and its layers (two files under the 4 kB style budget).
  styleUrls: ['./tale-studio.css', './tale-studio-canvas.css'],
})
export class TaleStudioPage implements OnChanges {
  protected readonly store = inject(DashboardStore);
  private readonly documents = inject(TaleDocumentService);
  private readonly router = inject(Router);
  /** The tale being edited, bound from the route's `:taleId`. */
  readonly taleId = input.required<string>();
  /** The zone page the studio was opened from (`?zone=`), where its back link returns. */
  readonly zone = input<string | undefined>(undefined);
  /** `?from=tale-groups` when opened from the Tale groups page's group view (story 8.19), where its back link returns. */
  readonly from = input<string | undefined>(undefined);

  /** The document being edited; null until read. */
  protected readonly doc = signal<TaleDocument | null>(null);
  /** The ids of the selected layers, in the order they were selected. */
  protected readonly selection = signal<readonly string[]>([]);
  protected readonly editingId = signal<string | null>(null);
  /** Why the tale could not be read, or kept as a new tale. */
  protected readonly error = signal('');
  /** What the person should know after keeping their version as a new tale. */
  protected readonly notice = signal('');
  protected readonly announcement = signal('');
  /** The canvas layer with keyboard focus (`:focus-visible`): its ring is drawn again above the layers. */
  protected readonly focusRing = signal<string | null>(null);
  /** That layer, raised above the others only while it is wholly under higher layers (WCAG 2.4.11). */
  protected readonly raisedId = signal<string | null>(null);
  protected readonly focusBox = computed(() => {
    const id = this.focusRing();
    const element = id ? this.doc()?.elements.find((e) => e.id === id) : undefined;
    return element && !element.hidden ? element.box : null;
  });
  /** Whether the Duplicate drawer is open (epic Tale Studio R11), and the button that opened it. */
  protected readonly duplicating = signal(false);
  protected duplicateOpener: HTMLElement | null = null;
  /** The last copy made here: what was said, and the copy's id for its link. */
  protected readonly duplicateResult = linkedSignal<string, { id: string; message: string } | null>({
    source: () => this.taleId(),
    computation: () => null,
  });
  /** Every change to the document, for undo and redo (epic Tale Studio R9). */
  private readonly history = new TaleHistory();
  /** What undo and redo would undo and redo now, by label; null for nothing. */
  protected readonly historyState = signal<{ undo: string | null; redo: string | null }>({ undo: null, redo: null });
  /** Where saving stands; see {@link TaleAutosaver}. */
  protected readonly saveState = signal<AutosaveState>({ kind: 'saved' });
  /** Why the last save failed, in words a person can act on. */
  protected readonly saveError = signal('');
  /** True while the person's version is being kept as a new tale. */
  protected readonly keeping = signal(false);
  /**
   * The published document, the one visitors see (user decision 2026-10-22): the studio edits and
   * autosaves the draft, and only Update tale (AD-15), or showing a tale with nothing on the site
   * yet, copies the draft to it.
   */
  protected readonly published = signal<PublishedTaleDocument>({ document: null, revision: 0 });
  /** True while the tale is being updated or its changes discarded. */
  protected readonly updating = signal(false);
  /** When coming back to the page last read the tale again (ms since the epoch). */
  private backToPageAt = 0;
  private readonly autosave = new TaleAutosaver(
    emptyTaleDocument(),
    0,
    (document, revision) => this.saveDraft(document, revision),
    (state) => this.onSaveState(state),
    inject(AUTOSAVE_TIMING),
  );
  // A save failed and has not succeeded since: the failure block stays, and the recovery is announced.
  protected readonly recovering = signal(false);
  /** The first failure of a failing run of saves, for the alert region; cleared when saving recovers. */
  protected readonly saveAlert = signal('');
  /** Now, ticking each second while a retry waits, for its countdown. */
  private readonly now = signal(Date.now());
  private ticker: ReturnType<typeof setInterval> | null = null;
  /**
   * Editing is held: while the draft is discarded, or once the version is kept as a new tale until
   * that tale opens. Changes are refused with a message instead of going to the wrong place.
   */
  private readonly held = signal('');
  // Leaving to open the kept copy: nothing here is to be saved any more.
  private leavingForCopy = false;
  /** True once the server holds a draft: after a read of one, or after any save. */
  private readonly draftStored = signal(false);
  /** The element the last refused save named, marked invalid until it changes. */
  protected readonly invalidId = signal<string | null>(null);
  /** Why the text just typed was changed: cut at the limit, or characters removed. */
  protected readonly textNotice = signal('');
  /** Whether the safe-area guides show on the canvas (an editor preference, not saved in the document). */
  protected readonly guides = signal(true);
  /** The guide lines a drag snapped to, shown while it lasts. */
  protected readonly snapLines = signal<{ x: number | null; y: number | null } | null>(null);
  /** The open layer actions menu, if any. */
  protected readonly menu = signal<OpenMenu | null>(null);
  private drag: Drag | null = null;
  /** A drag just ended: the click that follows it does not change the selection. */
  private dragged = false;
  /** Shift+Space just added to the selection: the click a button may fire for it is ignored. */
  private keyToggled = false;

  protected readonly maxElements = MAX_TALE_ELEMENTS;
  /** The tale's own media while it is drawn full-bleed, with its legacy playback rules (R16), or null. */
  protected readonly stageMedia = computed(() => stageTaleMedia(this.doc()));
  protected readonly isTaleMedia = isTaleMediaElement;
  protected readonly maxText = MAX_TEXT_LENGTH;
  protected readonly safeArea = TALE_SAFE_AREA;
  private readonly apple = isApple();
  /** Each layer shortcut as people read it on this platform. */
  protected readonly keys = Object.fromEntries(
    (['forward', 'backward', 'front', 'back', 'hide', 'lock', 'duplicate', 'delete', 'select-all'] as const).map(
      (command) => [command, shortcutLabel(command, this.apple)],
    ),
  ) as Record<LayerCommand, string>;
  protected readonly keyShortcuts = LAYER_KEYSHORTCUTS;
  protected readonly undoKey = historyLabel('undo', this.apple);
  protected readonly redoKey = historyLabel('redo', this.apple);
  protected readonly undoKeys = historyKeyShortcuts('undo', this.apple);
  protected readonly redoKeys = historyKeyShortcuts('redo', this.apple);
  protected readonly multiHint = this.apple
    ? 'Shift+click, ⌘+click, or Shift+Space'
    : 'Shift+click, Ctrl+click, or Shift+Space';
  /** Why the hex field's value was refused, shown under it; empty when it was not. */
  protected readonly hexError = signal('');
  /** The layers list's one tab stop (roving tabindex): a layer and its column. */
  private readonly active = signal<{ id: string; col: number } | null>(null);
  protected readonly lockedHint = LOCKED;
  protected readonly fits = MEDIA_FITS;
  protected readonly fitNames = FIT_NAMES;
  protected readonly minDuration = MIN_TALE_DURATION_MS / 1000;
  protected readonly maxDuration = MAX_TALE_DURATION_MS / 1000;
  /** The length in seconds of each video the canvas loaded, by key, for the 15 s warning (R5). */
  protected readonly videoSeconds = signal<ReadonlyMap<string, number>>(new Map());
  /** The media picker, while it is open (R5). */
  protected readonly picker = signal<OpenPicker | null>(null);
  /** The emoji picker, while it is open (R6): to add an emoji, or to replace the one `elementId` names. */
  protected readonly emojiPicker = signal<{
    elementId: string | null;
    current: string | null;
    heading: string;
    returnFocus: HTMLElement | null;
  } | null>(null);
  /** The element types the studio offers, from the registry and each type's descriptor (R8). */
  protected readonly elementTypes = studioElementTypes({ testTypes: inject(STUDIO_TEST_ELEMENT_TYPES) });
  private readonly typesByKey = new Map(this.elementTypes.map((t) => [t.key, t]));
  /** The Add menu's rows of entries, in registry order (R8). */
  protected readonly addRows = addMenuRows(this.elementTypes);
  /** The Add menu's limits the tale has reached, whose hints show under the menu. */
  protected readonly reachedLimits = computed(() =>
    this.elementTypes
      .flatMap((t) => t.add.flatMap((a) => (a.limit?.reached(this.doc()) ? [a.limit] : [])))
      .sort((a, b) => a.hintOrder - b.hintOrder),
  );
  protected readonly emojiFont = EMOJI_FONT_STACK;
  /** True when the tale holds its one video: it then plays for the video's length (R5). */
  protected readonly hasVideo = computed(() => hasVideoElement(this.doc()));
  /** True when the tale holds its swipe-up link: a tale holds one (R7). */
  protected readonly swipeUpLimitReached = computed(
    () => (this.doc()?.elements.filter((e) => e.type === 'swipe-up').length ?? 0) >= MAX_SWIPE_UP_ELEMENTS,
  );
  /** True when the Add entry's type is at its limit (the video, the swipe-up link). */
  protected limitReached(entry: AddMenuEntry): boolean {
    return entry.limit?.reached(this.doc()) ?? false;
  }
  /** True when the tale holds its one video; the tale's own media video (R16) does not count, as before documents. */
  protected readonly videoLimitReached = computed(() => limitedVideoCount(this.doc()) >= MAX_VIDEO_ELEMENTS);
  /** The tale's duration in seconds, as the duration field shows it: 7 when the document sets none. */
  protected readonly durationSeconds = computed(() => (this.doc()?.durationMs ?? DEFAULT_TALE_DURATION_MS) / 1000);

  protected readonly tale = computed(() => this.store.tale(this.taleId()));
  // The tale's project: the theme is read again only when it changes, not on each store refresh.
  protected readonly projectId = computed(() => this.tale()?.projectId);
  /**
   * The project theme's font-family list, for texts in the theme font (web zones R9): null when
   * the theme sets none; undefined until read, or when it cannot be read (the fallback shows).
   */
  protected readonly themeFont = signal<string | null | undefined>(undefined);
  /** The project's complete theme, for the preview, as the Delivery API sends it; null until read. */
  protected readonly projectTheme = signal<unknown>(null);
  /** Whether the preview (R10) shows. */
  protected readonly previewOpen = signal(false);
  /** The name of the tale's group, which the viewer shows in its top bar. */
  protected readonly groupName = computed(
    () =>
      Object.values(this.store.taleGroups())
        .flat()
        .find((group) => group.tales.some((t) => t.id === this.taleId()))?.name ?? '',
  );
  private readonly themes = inject(ThemeService);
  /** The project's fonts (R18), which the inspector offers; null until read, or when they cannot be read. */
  protected readonly projectFonts = signal<readonly ProjectFont[] | null>(null);
  private readonly fonts = inject(ProjectFontsService);
  /** What lies behind the canvas, for contrast checks (R12): its colour, and whether media covers it. */
  protected readonly backdrop = computed<TextBackdrop>(() => ({
    canvasColor: this.doc()?.canvas.background.color ?? '#000000',
    // The tale's own media (R16) is an element, which `textBackdropAt` meets on its way down, once.
    overMedia: this.doc()?.canvas.background.type === 'media',
  }));
  /**
   * The colours read behind each label over media (R12, story 7.10), by what lies behind it
   * (`backdropKey`); null when they cannot be read. A label whose key is missing is being read.
   */
  private readonly samples = signal<BackdropResults>(new Map());
  /** The colours read behind the label with this key (read where needed, so only labels over media track them). */
  private readonly sample: SampleLookup = (key) => this.samples().get(key);
  private readonly sampler = inject(TaleBackdropSampler);
  private readonly reads = new BackdropReads(
    (doc, index) => {
      const projectId = untracked(this.projectId);
      return projectId ? this.sampler.sample(doc, index, (k) => projectMediaSrc(projectId, k)) : Promise.resolve(null);
    },
    (results) => this.samples.set(results),
  );
  // The next look at which labels need reading, after a change.
  private readsTimer: ReturnType<typeof setTimeout> | undefined;
  /** What lies behind the selected text: the canvas, or a shape or media below it (R6, R12). */
  protected readonly selectedBackdrop = computed<TextBackdrop>(() => this.backdropOf(this.selectedId() ?? ''));
  // Each text's canvas look, kept per props object, so unchanged texts keep their view.
  private readonly views = new WeakMap<object, { themeFont: string | null; view: TextView }>();
  /** The contrast changes of the last change, said with its announcement (see `say`). */
  private contrastNote = '';
  /** The text a text-style change is restyling: it says its own contrast change. */
  private restylingId: string | null = null;
  // Each shape's canvas look, kept per props object.
  private readonly shapes = new WeakMap<object, ShapeView>();
  // Each link's canvas look, kept per props object and box (a button's label size follows its height).
  private readonly links = new WeakMap<object, { box: TaleElementBox; view: LinkView }>();
  /** The one selected layer's id, or null when none or several are selected. */
  protected readonly selectedId = computed(() => (this.selection().length === 1 ? this.selection()[0] : null));
  protected readonly selected = computed(() => this.doc()?.elements.find((e) => e.id === this.selectedId()) ?? null);
  private readonly selectedSet = computed(() => new Set(this.selection()));
  /** The layers list: top of the z-order first, each with its name and whether it reaches outside the safe area. */
  protected readonly layerRows = computed(() =>
    (this.doc()?.elements ?? [])
      .map((el, i) => ({
        el,
        order: this.readingIndex().get(el.id) ?? null,
        // Said without an emoji's glyph, which a screen reader would read as a second name (7.15).
        ...layerSpokenName(el, this.doc()?.elements ?? [el]),
        // The tale's own media, drawn full-bleed as before (R16), fills the canvas by design, as the
        // swipe-up link sits in the bottom safe area (R7).
        outside: el !== this.stageMedia() && el.type !== 'swipe-up' && isOutsideSafeArea(el.box),
        lowContrast: isLowContrast(this.doc(), i, this.backdrop(), this.sample),
        // An image, video or sticker without alt text or the decorative mark, or an image button
        // without alt text, keeps the tale from being updated (R12).
        missingAlt: isMediaElement({ type: el.type }) && !el.hidden && !hasAltText(el),
        // So does a button, image button or swipe-up link without a web address (R7).
        missingLink: isLinkElement(el) && !el.hidden && needsLinkUrl(el),
        // A button or image button under 24 px on the smallest phone is hard to tap (WCAG 2.5.8): a warning.
        smallTarget: (el.type === 'button' || el.type === 'image-button') && isSmallTarget(el.box),
        // A video over 15 s plays only its first 15 s (R5); the tale's own media video plays in full (R16).
        longVideo:
          el.type === 'video' &&
          el !== this.stageMedia() &&
          (this.videoSeconds().get(el.props.mediaKey) ?? 0) > MAX_TALE_VIDEO_MS / 1000,
      }))
      .reverse(),
  );
  /**
   * Each element's place in the order screen readers and Tab meet the tale (AD-15, R12): the
   * contract's `readingOrder` of what the SDK names (hidden layers and decorative ones, links
   * excepted, are not met).
   */
  protected readonly readingIndex = computed(() => {
    const met = (this.doc()?.elements ?? []).filter(
      (e) => !e.hidden && (e.a11y?.decorative !== true || isLinkElement(e)),
    );
    return new Map(readingOrder(met).map((e, i) => [e.id, i + 1]));
  });
  /** The ids of the labels with low contrast, marked on the canvas as in their layer rows (R12). */
  protected readonly lowContrast = computed(
    () => new Set(this.layerRows().filter((row) => row.lowContrast && !row.el.hidden).map((row) => row.el.id)),
  );
  /**
   * Back to the zone page the studio was opened from (`?zone=`) when it lists the tale, else the
   * first zone that does, with the tale's group open (`?group=`) and named ("Back to Summer sale").
   * Opened from the Tale groups page (`?from=tale-groups`), or for a tale no zone lists (its group
   * is in no zone, story 8.19): back into the group's view there. "Back" to the zones list while
   * the group is not known.
   */
  protected readonly backLink = computed(() => {
    const id = this.taleId();
    const groupId = this.store.tale(id)?.taleGroupId;
    const own = groupId ? this.store.groupSummary(groupId) : undefined;
    const toTaleGroups = (group: { id: string; name: string }) => ({
      link: ['/tale-groups'],
      query: { group: group.id },
      text: `Back to ${group.name}`,
    });
    if (own && this.from() === 'tale-groups') return toTaleGroups(own);
    const lists = this.store.taleGroups();
    const from = this.zone();
    const zones = from && lists[from] ? [from, ...Object.keys(lists).filter((z) => z !== from)] : Object.keys(lists);
    for (const zoneId of zones) {
      const group = lists[zoneId].find((g) => g.tales.some((t) => t.id === id));
      // Back into the group's view on the zone page (epic UX rework R11).
      if (group) return { link: ['/zones', zoneId], query: { group: group.id }, text: `Back to ${group.name}` };
    }
    if (own) return toTaleGroups(own);
    return { link: ['/zones'], query: null, text: 'Back' };
  });

  /** True while the keyboard shortcuts popover is open; closed when the studio opens. */
  protected readonly helpOpen = signal(false);
  private readonly helpButton = viewChild<ElementRef<HTMLButtonElement>>('helpButton');

  protected toggleHelp(): void {
    this.helpOpen.update((open) => !open);
  }

  /** Escape on the "?" button or in the popover closes it and puts focus back on the button. */
  protected closeHelp(event: Event): void {
    if (!this.helpOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    this.helpOpen.set(false);
    this.helpButton()?.nativeElement.focus();
  }

  /** Focus moving out of the "?" button and its popover closes it, leaving focus where it went. */
  protected helpFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    this.helpOpen.set(false);
  }

  /** A press outside the "?" button and its popover closes it, leaving focus where the press put it. */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointer(event: PointerEvent): void {
    if (!this.helpOpen()) return;
    if (event.target instanceof Element && event.target.closest('.studio-help')) return;
    this.helpOpen.set(false);
  }

  /** What the save indicator says. */
  protected readonly saveText = computed(() => {
    switch (this.saveState().kind) {
      case 'saved':
        return 'All changes saved';
      case 'pending':
        return 'Unsaved changes';
      case 'saving':
        return 'Saving…';
      case 'conflict':
        return 'Not saved: a newer version exists';
      default:
        return 'Not saved';
    }
  });
  /** True when the draft on screen differs from the version on the site, or nothing is on the site yet. */
  protected readonly unpublished = computed(() => !sameDocument(this.doc(), this.published().document));
  /**
   * The tale's visibility as the Management API read it for this studio (`GET /tales/{id}`, in any
   * zone, epic UX rework R7): on opening, after a save while nothing is on the site, after Update
   * tale, and back on the page. Null until read.
   */
  private readonly readVisibility = signal<{ taleId: string; visibility: Visibility } | null>(null);
  /**
   * Until the studio's own read answers, the tale's visibility as the store's zone lists give it:
   * visible when any zone shows it, else every zone's reasons in their order; null when no zone
   * lists it.
   */
  private readonly listedVisibility = computed<Visibility | null>(() => {
    const id = this.taleId();
    const listed = Object.values(this.store.taleGroups())
      .flat()
      .flatMap((g) => g.tales)
      .filter((t) => t.id === id && t.visibility)
      .map((t) => t.visibility);
    if (listed.length === 0) return null;
    return listed.find((v) => v.visible) ?? visibilityOf(listed.flatMap((v) => v.reasons));
  });
  /**
   * The tale's visibility on the site (epic UX rework R7), as the Management API last read it;
   * null until read. "Not updated yet" is left out once something is on the site, before it is
   * read again.
   */
  protected readonly siteVisibility = computed<Visibility | null>(() => {
    const read = this.readVisibility();
    const visibility = read?.taleId === this.taleId() ? read.visibility : this.listedVisibility();
    if (!visibility || visibility.visible || this.published().document === null) return visibility;
    return visibilityOf(visibility.reasons.filter((reason) => reason.code !== 'not-updated-yet'));
  });
  /** The version on the site, ready to count the draft's changes against. */
  private readonly onSite = computed(() => siteVersion(this.published().document));
  /** How many changes the draft holds against the version on the site. */
  protected readonly pendingChanges = computed(() =>
    this.unpublished() ? changeCount(this.doc(), this.onSite()) : 0,
  );
  /**
   * The status line, in the indicator's words (epic UX rework R15): "Visible on site · up to
   * date", "Visible on site · changes not updated yet", "Not visible: group is off", "Not
   * visible: group is off · 2 changes not updated yet", or, when nothing is on the site yet,
   * "Not visible: not updated yet · 3 changes".
   */
  protected readonly statusLine = computed(() => {
    const pending = this.unpublished();
    const visibility = this.siteVisibility();
    if (!visibility) return pending ? 'Changes not updated yet' : 'Up to date';
    const line = visibilitySummary(visibility, 'tale', formatLocal);
    if (visibility.visible) return `${line} · ${pending ? 'changes not updated yet' : 'up to date'}`;
    if (!pending) return line;
    const n = this.pendingChanges();
    const changes = `${n} ${n === 1 ? 'change' : 'changes'}`;
    // "Not updated yet" is already said: the count is not said twice.
    return visibility.reasons[0]?.code === 'not-updated-yet'
      ? `${line} · ${changes}`
      : `${line} · ${changes} not updated yet`;
  });
  /** True when there is something to update: a draft that differs from the version on the site. */
  protected readonly canUpdate = computed(
    () => this.unpublished() && (this.draftStored() || this.saveState().kind !== 'saved'),
  );
  /** When the next automatic retry comes. */
  protected readonly retryText = computed(() => {
    const state = this.saveState();
    if (state.kind === 'saving') return 'Trying again now…';
    if (state.kind !== 'retrying') return 'It is not tried again until you change something or press Retry now.';
    const seconds = Math.max(0, Math.ceil((state.retryAt - this.now()) / 1000));
    return seconds > 0 ? `Trying again in ${seconds} s.` : 'Trying again now…';
  });
  protected readonly saveFailed = computed(() => !['saved', 'pending', 'saving'].includes(this.saveState().kind));

  /** The group of the tale, as `GET /tales/{id}` named it, for the tale it was read for (story 8.19). */
  private readonly taleGroupId = signal<{ taleId: string; groupId: string } | null>(null);

  constructor() {
    // A tale no zone lists (its group is in no zone, story 8.19): its group is read, once the store
    // is loaded, so the studio knows the tale (title, project, Update tale, Duplicate) as any other.
    // Released when the tale changes, a zone lists it after all, or the studio closes.
    effect((onCleanup) => {
      const read = this.taleGroupId();
      const taleId = this.taleId();
      if (!read || read.taleId !== taleId || !this.store.loaded()) return;
      const listed = Object.values(this.store.taleGroups()).some((list) => list.some((g) => g.tales.some((t) => t.id === taleId)));
      if (listed) return;
      untracked(() => this.store.ensureTaleGroup(read.groupId));
      onCleanup(() => this.store.releaseTaleGroup(read.groupId));
    });
    // Labels over media are judged against the colours read behind them (R12): read again after each change.
    effect(() => {
      this.doc();
      this.projectId();
      untracked(() => {
        clearTimeout(this.readsTimer);
        this.readsTimer = setTimeout(() => this.requestReads());
      });
    });
    // A layer moved or reordered by keyboard may come out from under the others, or go under them:
    // whether the focused one is raised is read again after each change (2.4.11, story 7.15).
    effect(() => {
      this.doc();
      if (this.focusRing() === null) return;
      untracked(() => setTimeout(() => this.raiseIfHidden()));
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.readsTimer);
      this.reads.destroy();
      this.autosave.dispose();
      this.stopTicker();
    });
    // The project's theme font, read once the tale (and so its project) is known.
    effect(() => {
      const projectId = this.projectId();
      if (projectId) void untracked(() => this.loadThemeFont(projectId));
    });
    // ...and its fonts.
    effect(() => {
      const projectId = this.projectId();
      if (projectId) void untracked(() => this.loadProjectFonts(projectId));
    });
    // The project fonts the document uses load through the same code as the Web SDK's (R18): from
    // their bytes, under their alias; texts show their fallback until then. Each loads once.
    effect(() => {
      const projectId = this.projectId();
      const fonts = this.projectFonts();
      const used = projectFontIds(this.doc());
      if (!projectId || !fonts) return;
      for (const font of fonts) {
        if (!used.includes(font.id)) continue;
        const face = {
          id: font.id,
          url: projectFontFileUrl(projectId, font.id),
          weight: font.weight,
          style: font.style,
        };
        void loadProjectFont(face, { credentials: 'same-origin' });
      }
    });
  }

  private async loadProjectFonts(projectId: string): Promise<void> {
    const result = await this.fonts.list(projectId);
    if (this.tale()?.projectId !== projectId) return;
    this.projectFonts.set(result.value);
  }

  private async loadThemeFont(projectId: string): Promise<void> {
    const result = await this.themes.load(projectId);
    if (this.tale()?.projectId !== projectId) return;
    this.themeFont.set(result.value === null ? undefined : result.value.resolved.fontFamily);
    this.projectTheme.set(result.value?.resolved ?? null);
  }

  /** How the canvas draws a text: as the Web SDK renders it, with the theme font read here. */
  protected view(element: TaleElement): TextView {
    const themeFont = this.themeFont() ?? null;
    const kept = this.views.get(element.props);
    if (kept && kept.themeFont === themeFont) return kept.view;
    const view = textView(element.props, themeFont);
    this.views.set(element.props, { themeFont, view });
    return view;
  }

  /** Applies a change from the text style inspector as one step in the history, and says what changed. */
  protected restyle(id: string, change: TextStyleChange): void {
    if (this.isHeld()) return;
    const element = this.element(id);
    if (!element) return;
    if (element.locked) {
      this.say(LOCKED);
      return;
    }
    const backdrop = this.backdropOf(id);
    const before = textContrast(resolveTextStyle(element.props), backdrop).kind;
    this.restylingId = id;
    const recorded = this.change(change.label, (elements) =>
      elements.map((e) => (e.id === id && e.type === 'text' ? { ...e, props: { ...e.props, ...change.patch } } : e)),
    );
    this.restylingId = null;
    // Only a recorded step is announced; the contrast line is not live, so a change of its warning is said here.
    if (!recorded) return;
    const after = textContrast(resolveTextStyle({ ...element.props, ...change.patch }), backdrop).kind;
    const contrast =
      before === after
        ? ''
        : after === 'low'
          ? ' Low contrast: see the warning under the text style.'
          : before === 'low'
            ? ' Contrast is enough now.'
            : '';
    this.say(change.said + contrast);
  }

  // The route's tale changed (on opening, or after keeping a version as a new tale, where the
  // page stays and its tale changes): start over with that tale's document. Only the zone the
  // studio came from changing (`?zone=`) keeps the tale as it is.
  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['taleId']) return;
    this.held.set('');
    this.leavingForCopy = false;
    this.draftStored.set(false);
    this.doc.set(null);
    this.selection.set([]);
    this.editingId.set(null);
    this.menu.set(null);
    this.invalidId.set(null);
    this.error.set('');
    this.autosave.reset(emptyTaleDocument(), 0);
    void this.load();
  }

  // Reads the tale's document; the history and autosave start over from it.
  private async load(): Promise<void> {
    const taleId = this.taleId();
    const result = await this.documents.load(taleId);
    if (taleId !== this.taleId()) return;
    if (result.value === null) {
      this.error.set(result.message);
      return;
    }
    const doc = result.value.document ?? emptyTaleDocument();
    this.doc.set(doc);
    this.published.set(result.value.published);
    this.draftStored.set(result.value.document !== null);
    this.history.clear();
    this.syncHistory();
    this.autosave.reset(doc, result.value.revision);
    this.saveError.set('');
    this.error.set('');
    void this.readTaleVisibility();
  }

  /**
   * Reads the tale's visibility from the Management API (`GET /tales/{id}`, in any zone), for the
   * status line. True when it was read; a failure keeps what the line showed.
   */
  private async readTaleVisibility(): Promise<boolean> {
    const taleId = this.taleId();
    const tale = await this.store.readTale(taleId);
    if (tale === null || taleId !== this.taleId()) return false;
    this.readVisibility.set({ taleId, visibility: tale.visibility });
    this.taleGroupId.set({ taleId, groupId: tale.taleGroupId });
    return true;
  }

  /**
   * Whether the studio may close (the route's `canDeactivate`): at once when everything is saved;
   * otherwise after the unsaved changes save, waiting up to {@link LEAVE_WAIT_MS}; else the person
   * is asked whether to leave without them.
   */
  async canLeave(): Promise<boolean> {
    if (this.leavingForCopy || !this.autosave.unsaved) return true;
    const saved = await Promise.race([
      this.autosave.flush(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LEAVE_WAIT_MS)),
    ]);
    return saved || window.confirm('Your latest changes to this tale are not saved. Leave Tale Studio and lose them?');
  }

  /** Closing or reloading the browser tab with unsaved changes asks first; a save is tried meanwhile. */
  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.leavingForCopy || !this.autosave.unsaved) return;
    void this.autosave.flush();
    event.preventDefault();
    // Older browsers ask only when a return value is set.
    event.returnValue = '';
  }

  /**
   * Back to the page (focus, or the tab shown again): the version on the site and the tale's
   * visibility may have changed meanwhile, such as after the tale or its group was shown or
   * hidden elsewhere. Focus and the tab shown again come together, so they read once, and at most
   * every {@link BACK_TO_PAGE_INTERVAL_MS}; not while the tale is being updated or held.
   */
  @HostListener('window:focus')
  @HostListener('document:visibilitychange')
  protected backToPage(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (!this.doc() || this.updating() || this.held()) return;
    const now = Date.now();
    if (now - this.backToPageAt < BACK_TO_PAGE_INTERVAL_MS) return;
    this.backToPageAt = now;
    void this.refreshPublished();
    void this.readTaleVisibility();
  }

  // Reads the version on the site now, such as after the tale was shown from the zone page. The
  // draft on screen is not touched; its revision is returned for an update to compare.
  private async refreshPublished(): Promise<number | null> {
    const taleId = this.taleId();
    if (!this.doc() || this.updating() || this.held()) return null;
    const result = await this.documents.load(taleId);
    if (result.value === null || taleId !== this.taleId()) return null;
    this.published.set(result.value.published);
    if (result.value.document !== null) this.draftStored.set(true);
    return result.value.revision;
  }

  /** Back online: a save that failed on the network is tried again at once. */
  @HostListener('window:online')
  protected backOnline(): void {
    this.autosave.online();
  }

  // Autosave's save of the draft; its answer also tells what is on the site now.
  private async saveDraft(document: TaleDocument, revision: number) {
    const taleId = this.taleId();
    const result = await this.documents.save(taleId, document, revision);
    if (result.value !== null && taleId === this.taleId()) {
      if (result.value.published) this.published.set(result.value.published);
      this.draftStored.set(true);
      // With nothing on the site, a saved draft can take the tale off it (media out of step, story
      // 8.4 review): the line reads the server's answer again.
      if (this.published().document === null) void this.readTaleVisibility();
    }
    return result;
  }

  /**
   * Updates the tale: copies the draft to the version on the site (AD-15, compare-and-set on both
   * revisions), once what is unsaved has saved, so visitors see what the studio shows. Another
   * change first leads to the stale choice. Then, with editing free again, reads the tale's
   * visibility and says it with the update.
   */
  protected async updateTale(): Promise<void> {
    if (this.updating() || this.held() || !this.canUpdate()) return;
    const taleId = this.taleId();
    if (!(await this.draftAction('publish'))) return;
    // The other pages' lists follow in the background.
    void this.store.refresh();
    const read = await this.readTaleVisibility();
    if (taleId !== this.taleId()) return;
    const visibility = read ? this.siteVisibility() : null;
    this.say(
      visibility === null
        ? 'Tale updated.'
        : visibility.visible
          ? 'Tale updated. Visitors now see this version.'
          : `Tale updated. ${this.statusLine()}.`,
    );
  }

  /**
   * Discards the draft back to the version on the site, after asking. It is a step in the history:
   * undo brings the draft back (and autosaves it) until the studio closes.
   */
  protected async discardChanges(): Promise<void> {
    if (this.updating() || this.held() || this.published().document === null || !this.unpublished()) return;
    if (
      !window.confirm(
        'Discard your changes and go back to the version on the site? You can undo this until you leave Tale Studio.',
      )
    ) {
      return;
    }
    await this.draftAction('discard');
  }

  /**
   * Updates the tale (copies the draft to the site, `publish` in the API) or discards the draft,
   * compare-and-set on both revisions. Unsaved changes save first; then autosave pauses, so no save
   * of the draft is on its way while the server compares its revision. Changes made while updating
   * are kept and saved after it; while discarding, editing is held. A 409 reads the version on the
   * site now: when only its revision moved (the tale was shown from the zone page, which put its
   * draft on the site) it tries once more with it; otherwise the stale choice opens. True once the
   * tale is updated or the changes discarded.
   */
  private async draftAction(action: 'publish' | 'discard'): Promise<boolean> {
    const taleId = this.taleId();
    const what = action === 'publish' ? 'the tale was not updated' : 'the changes were not discarded';
    this.updating.set(true);
    this.error.set('');
    if (action === 'discard') this.held.set('Wait until the changes are discarded.');
    try {
      if (!(await this.autosave.flush())) {
        if (this.saveState().kind !== 'conflict') {
          this.error.set(
            `Your latest changes are not saved yet, so ${what}. Try again once they are saved.`,
          );
        }
        return false;
      }
      this.autosave.pause();
      const revision = this.autosave.savedRevision;
      // The draft the server checks: a refusal's pointer names an element of this one, which may
      // differ from what the canvas shows once more changes are made while it is on its way.
      const sent = this.autosave.savedDocument;
      const send = (publishedRevision: number) =>
        action === 'publish'
          ? this.documents.publish(taleId, revision, publishedRevision)
          : this.documents.discard(taleId, revision, publishedRevision);
      let result = await send(this.published().revision);
      if (taleId !== this.taleId()) return false;
      if (result.value === null && result.stale) {
        const fresh = await this.documents.load(taleId);
        if (taleId !== this.taleId()) return false;
        if (fresh.value !== null) this.published.set(fresh.value.published);
        if (fresh.value !== null && fresh.value.revision === revision) {
          result = await send(fresh.value.published.revision);
          if (taleId !== this.taleId()) return false;
        }
      }
      if (result.value === null) {
        if (result.stale) this.autosave.conflict(result);
        else if (result.code === ErrorCodes.invalidTaleDocument) {
          // The refused element, such as an image without alt text (R12), is selected and named.
          const index = /^\/elements\/(\d+)/.exec(result.pointer)?.[1];
          const id = index === undefined ? undefined : sent.elements[Number(index)]?.id;
          const element = id === undefined ? undefined : this.element(id);
          if (element) {
            this.invalidId.set(element.id);
            this.selectOnly(element.id);
          }
          this.error.set(
            missingMedia(result.message)
              ? `${missingMediaMessage(element ? kindName(element).toLowerCase() : 'background', 'updated')}${element ? ' It is selected.' : ''}`
              : element && /\/a11y\/label$/.test(result.pointer)
                ? `The tale could not be updated. ${result.message} It is selected.`
                : 'The tale could not be updated because something in it is not valid. Fix it, then try again.',
          );
        } else if (result.code === ErrorCodes.nothingToPublish) {
          this.error.set('There is nothing to update yet: change the tale first.');
        } else this.error.set(`${what[0].toUpperCase()}${what.slice(1)}. ${result.message}`);
        return false;
      }
      this.published.set(result.value.published);
      // Said by updateTale once editing is free again, with the tale's visibility.
      if (action === 'publish') return true;
      const before = this.doc();
      const after = result.value.document ?? emptyTaleDocument();
      this.editingId.set(null);
      this.menu.set(null);
      if (before) {
        this.history.seal();
        this.history.record('Changes discarded', before, after);
      }
      this.doc.set(after);
      const ids = new Set(after.elements.map((e) => e.id));
      this.selection.set(this.selection().filter((id) => ids.has(id)));
      this.syncHistory();
      this.autosave.reset(after, result.value.revision);
      this.say(`Changes discarded: the version on the site is back. Press ${this.undoKey} to undo.`);
      return true;
    } finally {
      this.updating.set(false);
      if (action === 'discard') this.held.set('');
      // Changes kept while it was on its way now save, on the draft revision it left.
      this.autosave.resume();
    }
  }

  private onSaveState(state: AutosaveState): void {
    const previous = this.saveState();
    this.saveState.set(state);
    if (state.kind === 'retrying' || state.kind === 'refused') {
      if (previous.kind !== state.kind) this.saveError.set(this.refusal(state.failure, state.kind === 'retrying'));
      // Only the first failure of a run is announced; retries change the visible text only.
      if (!this.recovering()) this.saveAlert.set(this.saveError());
      this.recovering.set(true);
    } else if (state.kind === 'saved' || state.kind === 'conflict') {
      if (state.kind === 'saved') {
        this.invalidId.set(null);
        if (this.recovering()) this.say('All changes saved');
      }
      this.saveError.set('');
      this.saveAlert.set('');
      this.recovering.set(false);
    }
    if (state.kind === 'retrying') this.startTicker();
    else this.stopTicker();
  }

  protected retrySave(): void {
    if (this.saveState().kind === 'saving') return;
    this.autosave.retryNow();
  }

  private startTicker(): void {
    this.now.set(Date.now());
    this.ticker ??= setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Undo or redo, from the keyboard (outside text fields, whose undo is the browser's) anywhere in the studio. */
  @HostListener('keydown', ['$event'])
  protected onStudioKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || isTextEntry(event.target)) return;
    // A drawer over the studio (Duplicate, the media and emoji pickers) keeps its keys to itself.
    if (this.duplicating() || this.picker() || this.emojiPicker()) return;
    if (event.target instanceof Element && event.target.closest('[role=dialog]')) return;
    const command = historyShortcut(event, this.apple);
    if (!command) return;
    event.preventDefault();
    this.runHistory(command);
  }

  /**
   * Undoes or redoes one step and says which. Layers it brings back are selected; focus stays on
   * the control that had it, else goes to the canvas.
   */
  protected runHistory(command: HistoryCommand): void {
    const current = this.doc();
    if (!current || this.drag) return;
    if (this.held()) {
      this.say(this.held());
      return;
    }
    const step = command === 'undo' ? this.history.undo() : this.history.redo();
    if (!step) {
      this.say(command === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
      return;
    }
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    this.editingId.set(null);
    this.menu.set(null);
    this.hexError.set('');
    this.textNotice.set('');
    this.doc.set(step.document);
    const ids = new Set(step.document.elements.map((e) => e.id));
    const before = new Set(current.elements.map((e) => e.id));
    const back = step.document.elements.filter((e) => !before.has(e.id)).map((e) => e.id);
    this.selection.set(back.length ? back : this.selection().filter((id) => ids.has(id)));
    if (this.invalidId() !== null && !ids.has(this.invalidId() as string)) this.invalidId.set(null);
    this.syncHistory();
    this.autosave.changed(step.document);
    this.say(`${command === 'undo' ? 'Undone' : 'Redone'}: ${step.label}`);
    setTimeout(() => {
      const target = (focused && document.getElementById(focused)) || document.getElementById('studio-canvas');
      if (target !== document.activeElement) target?.focus();
    }, 0);
  }

  /** Ends the current text step, so typing after leaving the field is a new step. */
  protected sealHistory(): void {
    this.history.seal();
  }

  private syncHistory(): void {
    this.historyState.set({ undo: this.history.undoLabel, redo: this.history.redoLabel });
  }

  /**
   * Keeps the person's version, refused as stale, as a new draft tale in the same group, then
   * opens that tale here. Nothing is dropped: on failure the version stays on screen.
   */
  protected async keepAsNewTale(): Promise<void> {
    const doc = this.doc();
    if (!doc || this.keeping()) return;
    const taleId = this.taleId();
    this.keeping.set(true);
    this.error.set('');
    // Nothing more goes to the original tale: autosave stops, and editing is held until the copy opens.
    this.autosave.pause();
    this.held.set('Wait until your version is kept as a new tale.');
    const result = await this.documents.keepAsNewTale(taleId, doc);
    this.keeping.set(false);
    if (result.value === null) {
      this.held.set('');
      this.autosave.resume();
      this.error.set(
        result.code === ErrorCodes.taleGroupFull
          ? 'The tale group already holds the most tales it can, so your version cannot be kept there. ' +
              'Your changes are still here: remove a tale from the group and try again, or reload the latest version.'
          : `Your version was not kept as a new tale. ${result.status === 0 ? 'Check the connection and try again.' : result.message}`,
      );
      return;
    }
    const tale = result.value;
    await this.store.refresh();
    // Saved as the new tale: leaving for it does not ask, and nothing more is saved here.
    this.leavingForCopy = true;
    const opened = await this.router
      .navigate(['/tales', tale.id, 'studio'], { queryParams: { zone: this.zone(), from: this.from() } })
      .catch(() => false);
    if (!opened || this.taleId() === taleId) {
      // Still on the original: it stays in the stale choice, with the version on screen.
      this.leavingForCopy = false;
      this.held.set('');
      this.autosave.resume();
      this.error.set(
        `Your version is kept as a new draft tale, “${tale.title}”, in the same group, but it could not be opened. ` +
          'Open it from the zone page.',
      );
      return;
    }
    const notice = `Your version is kept as a new draft tale, “${tale.title}”, in the same group. The original keeps the other version.`;
    this.notice.set(notice);
    this.say(notice);
  }

  protected name(element: TaleElement): string {
    return layerName(element, this.doc()?.elements ?? [element]);
  }

  /** The layer's name as screen readers are given it: an emoji's without its glyph (see `layerSpokenName`). */
  protected spokenName(element: TaleElement): string {
    return layerSpokenName(element, this.doc()?.elements ?? [element]).spoken;
  }

  protected kind(element: { type: TaleElementType }): string {
    return kindName(element);
  }

  /** What lies behind the text with this id: the canvas, or a shape or media below it (R6, R12). */
  protected backdropOf(id: string): TextBackdrop {
    const doc = this.doc();
    const index = doc?.elements.findIndex((e) => e.id === id) ?? -1;
    return doc ? labelBackdrop(doc, index, this.backdrop(), this.sample) : this.backdrop();
  }

  /** Asks for the colours behind each label over media, for what lies behind it now (see `BackdropReads`). */
  private requestReads(): void {
    const doc = this.doc();
    if (!doc || !this.projectId()) return;
    this.reads.update(doc, wantedReads(doc, this.backdrop()));
  }

  /** How the canvas draws a shape, kept per props object. */
  protected shape(element: ShapeElement): ShapeView {
    const kept = this.shapes.get(element.props);
    if (kept) return kept;
    const view = shapeView(element.props);
    this.shapes.set(element.props, view);
    return view;
  }

  /** How the canvas draws a button or the swipe-up link, kept per props and box. */
  protected link(element: TaleElement): LinkView {
    const kept = this.links.get(element.props);
    if (kept && kept.box === element.box) return kept.view;
    const view = linkView(element);
    this.links.set(element.props, { box: element.box, view });
    return view;
  }

  protected emojiSize(box: TaleElementBox): string {
    return emojiFontSize(box);
  }

  /** Where the canvas loads a file of the project's media, with the session. */
  protected mediaSrc(key: string): string {
    const projectId = this.projectId();
    return projectId ? projectMediaSrc(projectId, key) : '';
  }

  protected readonly percent = percent;

  protected maxPercent(size: number): number {
    return this.percent(1 - size);
  }

  /**
   * Opens the Duplicate drawer (epic Tale Studio R11). The copy is made from what is saved, so the
   * latest changes are saved first; while they cannot be, nothing opens and the reason is shown.
   */
  protected async openDuplicate(event: Event): Promise<void> {
    const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (this.updating()) {
      this.say('Wait until the tale is updated, then duplicate it.');
      return;
    }
    if (this.duplicating()) return;
    if (!this.tale()) {
      this.say('The tale is still loading. Try again in a moment.');
      return;
    }
    this.error.set('');
    if (!(await this.autosave.flush())) {
      if (this.saveState().kind !== 'conflict') {
        this.error.set('Your latest changes are not saved yet, so the tale was not duplicated. Try again once they are saved.');
      }
      return;
    }
    this.duplicateOpener = opener;
    this.duplicating.set(true);
  }

  /** Closes the drawer and says where the copy went, with a link to open it. */
  protected duplicatedTale(result: DuplicatedTale): void {
    this.duplicating.set(false);
    const message = duplicatedMessage(result);
    this.duplicateResult.set({ id: result.copy.id, message });
    this.say(message);
  }

  protected say(text: string): void {
    // A text whose contrast verdict the last change turned is named once, with what the change says.
    const note = this.contrastNote;
    this.contrastNote = '';
    // Two sentences, so a screen reader pauses between them ("Layer hidden. "Sale" has …", story 7.15).
    const said = note ? `${/[.!?…]$/.test(text.trim()) || !text.trim() ? text : `${text.trim()}.`} ${note}`.trim() : text;
    // Cleared first, so the same message twice is announced twice.
    this.announcement.set('');
    setTimeout(() => this.announcement.set(said), 0);
  }

  // When the tale's own media (R16) stops or starts being drawn full-bleed, what that does to how it
  // plays, said with the change (the choice in the plan: restyling keeps nothing implicit).
  private stageMediaChange(before: TaleDocument, next: TaleDocument): string {
    const was = stageTaleMedia(before);
    const now = stageTaleMedia(next);
    if (was && !now && next.elements.some((e) => e.id === was.id)) {
      return was.type === 'video'
        ? "The tale's video is now a layer like any other: muted, and at most 15 seconds."
        : "The tale's media is now a layer like any other.";
    }
    if (!was && now) return "The tale's media fills the stage again, as tale media plays.";
    return '';
  }

  private element(id: string): TaleElement | undefined {
    return this.doc()?.elements.find((e) => e.id === id);
  }

  // Changes the elements as one step in the history, labelled as people read it ("Text moved").
  private change(
    label: string,
    update: (elements: TaleElement[]) => readonly TaleElement[],
    mergeKey: string | null = null,
  ): boolean {
    const doc = this.doc();
    if (!doc) return false;
    const elements = update(doc.elements);
    if (elements === doc.elements) return false;
    return this.commit(label, { ...doc, elements: [...elements] }, mergeKey);
  }

  // Every change to the document comes here: it is recorded in the history, shown, and autosaved.
  // A change that leaves the document as it was is no step. True when a step was recorded.
  private commit(label: string, next: TaleDocument, mergeKey: string | null = null): boolean {
    // The swipe-up link stays pinned to the bottom safe area (R7): no move, resize or rotation sticks.
    if (next.elements.some((e) => e.type === 'swipe-up' && !isSwipeUpBox(e.box))) {
      next = {
        ...next,
        elements: next.elements.map((e) => (e.type === 'swipe-up' ? { ...e, box: { ...SWIPE_UP_BOX } } : e)),
      };
    }
    const before = this.doc();
    if (!before || next === before || JSON.stringify(next) === JSON.stringify(before)) return false;
    if (this.held()) {
      // The change does not go through; the canvas shows the document as it is.
      this.doc.set({ ...before });
      this.say(this.held());
      return false;
    }
    this.history.record(label, before, next, mergeKey);
    this.contrastNote = [contrastChange(before, next, this.restylingId, this.sample), this.stageMediaChange(before, next)]
      .filter(Boolean)
      .join(' ');
    // Said with the change's own announcement; alone when the change says nothing.
    if (this.contrastNote) setTimeout(() => this.contrastNote && this.say(''), 0);
    this.doc.set(next);
    this.notice.set('');
    this.syncHistory();
    this.autosave.changed(next);
    return true;
  }

  private setBox(id: string, box: Partial<TaleElementBox>, label?: string): void {
    const element = this.element(id);
    this.change(label ?? `${element ? kindName(element) : 'Layer'} moved`, (elements) =>
      elements.map((e) => {
        if (e.id !== id) return e;
        const next = { ...e.box, ...box };
        return {
          ...e,
          box: { ...next, x: round(clamp(next.x, 0, 1 - next.w)), y: round(clamp(next.y, 0, 1 - next.h)) },
        };
      }),
    );
  }

  private focusSoon(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }

  protected isSelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  /** An element about 30 px or less across on the canvas: its inner focus ring is thinner. */
  protected isTiny(el: { box: { w: number; h: number } }): boolean {
    return el.box.w < 0.1 || el.box.h < 0.06;
  }

  /** The layers list is one tab stop: the cell last focused, else the top layer's name. */
  protected tabIndex(id: string, col: number): number {
    const rows = this.layerRows();
    const active = this.active();
    const current = active && rows.some((r) => r.el.id === active.id) ? active : { id: rows[0]?.el.id, col: 0 };
    return current.id === id && current.col === col ? 0 : -1;
  }

  protected activate(id: string, col: number): void {
    this.active.set({ id, col });
  }

  private selectOnly(id: string | null): void {
    this.selection.set(id === null ? [] : [id]);
  }

  // Adds the layer to the selection, or takes it out.
  private toggleSelected(id: string): void {
    const selection = this.selection();
    this.selection.set(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    const n = this.selection().length;
    this.say(this.selection().includes(id) ? `Added to the selection, ${n} selected` : `Removed from the selection`);
  }

  /** A click on a canvas element or a layer row: selects it alone, or with Shift, Ctrl or Cmd adds or removes it. */
  protected pick(event: MouseEvent, id: string): void {
    if ((this.keyToggled && event.detail === 0) || this.dragged) {
      this.keyToggled = false;
      this.dragged = false;
      return;
    }
    // On a Mac, Ctrl+click is the context menu; Cmd+click adds to the selection there.
    if (event.shiftKey || event.metaKey || (event.ctrlKey && !this.apple)) this.toggleSelected(id);
    else this.selectOnly(id);
  }

  // True, after saying why, while editing is held (see `held`).
  private isHeld(): boolean {
    if (!this.held()) return false;
    this.say(this.held());
    return true;
  }

  protected addText(): void {
    if (this.isHeld()) return;
    const element: TaleElement = {
      id: crypto.randomUUID(),
      type: 'text',
      box: { ...NEW_TEXT_BOX },
      hidden: false,
      locked: false,
      a11y: {},
      props: newTextProps('Text'),
    };
    this.change('Text added', (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say('Text added');
    this.edit(element.id);
  }

  /** Types in place: the element becomes a text field at its place on the canvas. A locked one is not edited. */
  protected edit(id: string): void {
    if (this.isHeld()) return;
    this.selectOnly(id);
    const element = this.element(id);
    if (!element || element.hidden || element.type !== 'text') return;
    if (element.locked) {
      this.say(LOCKED);
      return;
    }
    this.editingId.set(id);
    setTimeout(() => {
      const field = document.getElementById(`studio-edit-${id}`) as HTMLTextAreaElement | null;
      field?.focus();
      field?.select();
    }, 0);
  }

  protected stopEditing(refocus = false): void {
    const id = this.editingId();
    if (id === null) return;
    this.editingId.set(null);
    this.history.seal();
    if (refocus) this.focusSoon(`studio-el-${id}`);
  }

  /**
   * Takes what was typed or pasted into a text field: characters text may not hold are removed
   * (line feeds stay), and text past the limit, counted in characters as the server counts them,
   * is cut. The field shows what was kept, and the notice says why. A locked layer keeps its text.
   */
  protected typeText(id: string, field: HTMLTextAreaElement): void {
    const element = this.element(id);
    if (!element || element.type !== 'text') return;
    if (element.locked || this.held()) {
      field.value = element.props.text;
      this.say(this.held() || LOCKED);
      return;
    }
    let text = cleanText(field.value, ELEMENT_TEXT_RULE);
    let notice = text === field.value ? '' : 'Characters that text cannot hold were removed.';
    const characters = [...text];
    if (characters.length > MAX_TEXT_LENGTH) {
      text = characters.slice(0, MAX_TEXT_LENGTH).join('');
      notice = `A text holds at most ${MAX_TEXT_LENGTH.toLocaleString('en')} characters.`;
    }
    if (text !== field.value) field.value = text;
    if (notice !== this.textNotice()) {
      this.textNotice.set(notice);
      if (notice) this.say(notice);
    }
    if (this.invalidId() === id) this.invalidId.set(null);
    // Typing in one text is one step until a pause or leaving the field; its own undo stays the browser's.
    this.change(
      'Text edited',
      (elements) => elements.map((e) => (e.id === id && e.type === 'text' ? { ...e, props: { ...e.props, text } } : e)),
      `text:${id}`,
    );
  }

  /** Applies a position field and writes back the value applied, which keeps the box on the canvas. */
  protected setPosition(id: string, axis: 'x' | 'y', field: HTMLInputElement): void {
    const element = this.element(id);
    if (!element) return;
    if (this.isHeld()) {
      field.value = String(this.percent(element.box[axis]));
      return;
    }
    const name = axis === 'x' ? 'left' : 'top';
    if (element.locked) {
      field.value = String(this.percent(element.box[axis]));
      this.say(LOCKED);
      return;
    }
    const requested = Number(field.value);
    if (field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(this.percent(element.box[axis]));
      this.say(`Enter a number for ${name}; it stays at ${field.value}%`);
      return;
    }
    this.setBox(id, { [axis]: requested / 100 });
    const applied = this.percent(this.element(id)?.box[axis] ?? 0);
    field.value = String(applied);
    this.say(
      applied === requested
        ? `${kindName(element)} moved to ${name} ${applied}%`
        : `${kindName(element)} moved to ${name} ${applied}%, as far as it goes`,
    );
  }

  /** Removes one element, as the inspector's Delete button does. */
  protected remove(id: string): void {
    this.removeLayers([id], 'canvas');
  }

  /**
   * Removes elements. Focus moves to the next layer where the command came from: on the canvas the
   * next shown element above, else the one below, else the canvas; in the list the next row down,
   * else the one up, else the Add text button.
   */
  private removeLayers(ids: readonly string[], origin: Origin): void {
    if (this.isHeld()) return;
    const elements = this.doc()?.elements ?? [];
    const gone = new Set(ids);
    const indexes = elements.map((e, i) => (gone.has(e.id) ? i : -1)).filter((i) => i >= 0);
    if (indexes.length === 0) return;
    const first = Math.min(...indexes);
    const last = Math.max(...indexes);
    const keep = (e: TaleElement) => !gone.has(e.id) && (origin === 'list' || !e.hidden);
    const above = elements.slice(last + 1).find(keep);
    const below = [...elements.slice(0, first)].reverse().find(keep);
    const next = (origin === 'canvas' ? (above ?? below) : (below ?? above)) ?? null;
    const done = indexes.length === 1 ? `${kindName(elements[first])} deleted` : `${indexes.length} layers deleted`;
    this.change(done, (list) => list.filter((e) => !gone.has(e.id)));
    this.selectOnly(next?.id ?? null);
    if (this.editingId() !== null && gone.has(this.editingId() as string)) this.editingId.set(null);
    if (this.invalidId() !== null && gone.has(this.invalidId() as string)) this.invalidId.set(null);
    const prefix = origin === 'canvas' ? 'studio-el-' : 'layer-';
    this.focusSoon(next ? `${prefix}${next.id}` : origin === 'canvas' ? 'studio-canvas' : 'studio-add');
    // Deleting is immediate, and undoable.
    this.say(`${done} — press ${this.undoKey} to undo`);
  }

  /**
   * Runs a layer command on the selection (reorder, delete, select all) or on one layer (`target`,
   * else the one selected: hide, lock, duplicate), announces it, and returns focus to `returnId`,
   * the control that asked, which the list may have moved.
   */
  protected run(command: LayerCommand, origin: Origin, returnId: string, target?: string): void {
    if (command !== 'select-all' && this.isHeld()) return;
    const doc = this.doc();
    if (!doc) return;
    const one = target ?? this.selectedId();
    switch (command) {
      case 'forward':
      case 'backward':
      case 'front':
      case 'back': {
        const ids = this.selectedSet();
        if (ids.size === 0) return;
        const next = reorder(doc.elements, ids, command);
        const [done, already] = REORDERED[command];
        if (next === doc.elements) this.say(already);
        else {
          this.change(`${layers(ids.size)} ${done}`, () => next);
          this.say(`${layers(ids.size)} ${done}`);
        }
        break;
      }
      case 'hide':
      case 'lock': {
        const element = one === null ? undefined : this.element(one);
        if (!element) return;
        const field = command === 'hide' ? 'hidden' : 'locked';
        const on = !element[field];
        const done = `Layer ${command === 'hide' ? (on ? 'hidden' : 'shown') : on ? 'locked' : 'unlocked'}`;
        this.change(done, (elements) => elements.map((e) => (e.id === element.id ? { ...e, [field]: on } : e)));
        if (on && this.editingId() === element.id) this.editingId.set(null);
        this.say(done);
        // A hidden layer leaves the canvas, so focus goes to its row.
        if (on && command === 'hide' && origin === 'canvas') returnId = `layer-${element.id}`;
        break;
      }
      case 'duplicate': {
        const element = one === null ? undefined : this.element(one);
        if (!element) return;
        if (element.type === 'video') {
          this.say('A tale holds one video, so it cannot be duplicated');
          break;
        }
        if (element.type === 'swipe-up') {
          this.say('A tale holds one swipe-up link, so it cannot be duplicated');
          break;
        }
        if (doc.elements.length >= MAX_TALE_ELEMENTS) {
          this.say(`A tale holds at most ${MAX_TALE_ELEMENTS} layers`);
          break;
        }
        const copy = duplicateElement(element, crypto.randomUUID());
        this.change('Layer duplicated', (elements) => {
          const at = elements.findIndex((e) => e.id === element.id);
          return [...elements.slice(0, at + 1), copy, ...elements.slice(at + 1)];
        });
        this.selectOnly(copy.id);
        this.say('Layer duplicated');
        returnId = `${origin === 'canvas' && !copy.hidden ? 'studio-el-' : 'layer-'}${copy.id}`;
        break;
      }
      case 'delete':
        this.removeLayers(this.selection(), origin);
        return;
      case 'select-all':
        this.selection.set(doc.elements.map((e) => e.id));
        this.say(`All ${doc.elements.length} layers selected`);
        break;
    }
    this.focusSoon(returnId);
  }

  // A layer shortcut pressed on a canvas element or in the layers list; true when it was one. Hide,
  // lock and duplicate act on the focused layer; the others on the selection, which holds it.
  private shortcut(event: KeyboardEvent, element: TaleElement, origin: Origin): boolean {
    const command = layerShortcut(event, this.apple);
    if (!command) return false;
    event.preventDefault();
    if (!this.isSelected(element.id) && command !== 'select-all') this.selectOnly(element.id);
    this.run(command, origin, (event.currentTarget as HTMLElement).id, element.id);
    return true;
  }

  // Shift+Space, Ctrl+Space or Cmd+Space adds the layer to the selection or takes it out; true when it was one.
  private selectionKey(event: KeyboardEvent, id: string): boolean {
    this.keyToggled = false;
    if (!isSelectionKey(event)) return false;
    event.preventDefault();
    this.keyToggled = true;
    this.toggleSelected(id);
    return true;
  }

  // Shift+F10 or the context-menu key (`isMenuKey`) opens the layer actions below the control;
  // true when it was one. Handled here, so no `contextmenu` event follows.
  private menuKey(event: KeyboardEvent, element: TaleElement, origin: Origin): boolean {
    if (!isMenuKey(event)) return false;
    event.preventDefault();
    if (!this.isSelected(element.id)) this.selectOnly(element.id);
    const control = event.currentTarget as HTMLElement;
    const rect = control.getBoundingClientRect();
    this.openMenu(rect.left, rect.bottom, origin, control.id);
    return true;
  }

  /** A canvas layer took focus: with a keyboard (`:focus-visible`), its ring is drawn above the layers. */
  protected layerFocused(event: FocusEvent, id: string): void {
    const target = event.target as HTMLElement;
    if (!target.matches(':focus-visible')) return;
    this.focusRing.set(id);
    this.raiseIfHidden();
  }

  protected layerBlurred(id: string): void {
    if (this.focusRing() === id) this.focusRing.set(null);
    if (this.raisedId() !== id) return;
    this.raisedId.set(null);
    // Back to its place at once, as `raiseIfHidden` raised it (a render may not have come between).
    const index = this.doc()?.elements.findIndex((e) => e.id === id) ?? -1;
    const target = document.getElementById(`studio-el-${id}`);
    if (target && index >= 0) target.style.zIndex = String(index + 1);
  }

  /**
   * Raises the keyboard-focused layer above the others only while it is wholly under higher layers,
   * read in the browser at nine points of it by the layers' own order (a raise does not count);
   * otherwise it keeps its place and only its ring is drawn above (2.4.11, story 7.15).
   */
  private raiseIfHidden(): void {
    const id = this.focusRing();
    const doc = this.doc();
    const target = id ? document.getElementById(`studio-el-${id}`) : null;
    if (!id || !doc || !target || typeof document.elementsFromPoint !== 'function') {
      this.raisedId.set(null);
      return;
    }
    const order = new Map(doc.elements.map((e, i) => [`studio-el-${e.id}`, i]));
    const box = target.getBoundingClientRect();
    const stacks: number[][] = [];
    for (const fx of [0.15, 0.5, 0.85]) {
      for (const fy of [0.15, 0.5, 0.85]) {
        const x = box.left + box.width * fx;
        const y = box.top + box.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        stacks.push(
          document
            .elementsFromPoint(x, y)
            .map((n) => order.get(n.closest('.el')?.id ?? '') ?? -1)
            .filter((i) => i >= 0),
        );
      }
    }
    const index = order.get(target.id) ?? -1;
    const raise = hiddenUnder(stacks, index);
    // At once, as the next render will: the ring and the layer show in the frame focus arrived in.
    target.style.zIndex = String(raise ? 99 : index + 1);
    this.raisedId.set(raise ? id : null);
  }

  protected onKey(event: KeyboardEvent, element: TaleElement): void {
    if (this.menuKey(event, element, 'canvas')) return;
    if (this.shortcut(event, element, 'canvas') || this.selectionKey(event, element.id)) return;
    const move = arrowMove(event, event.shiftKey ? MOVE_STEP * 10 : MOVE_STEP);
    if (move) {
      event.preventDefault();
      if (!this.isSelected(element.id)) this.selectOnly(element.id);
      // An arrow held down is one step; each press is a step of its own.
      this.moveSelection(move[0], move[1], event.repeat);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      this.edit(element.id);
    }
  }

  /**
   * Keys in the layers list, a WAI-ARIA grid: the layer shortcuts; Shift+Space (or Ctrl or Cmd)
   * on a name to add it to the selection, Enter or Space to select it alone; up and down to the
   * same control of the next layer, left and right between a layer's controls, Home and End to its
   * first and last, Ctrl+Home and Ctrl+End to the top and bottom layers.
   */
  protected onCellKey(event: KeyboardEvent, element: TaleElement, col: number): void {
    if (this.menuKey(event, element, 'list') || this.shortcut(event, element, 'list')) return;
    if (col === 0 && this.selectionKey(event, element.id)) return;
    if (
      col === 0 &&
      (event.key === 'Enter' || event.key === ' ') &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      this.selectOnly(element.id);
      return;
    }
    if (event.altKey || event.shiftKey || ((event.ctrlKey || event.metaKey) && !/^(Home|End)$/.test(event.key))) return;
    const rows = this.layerRows();
    const at = rows.findIndex((r) => r.el.id === element.id);
    const mod = event.ctrlKey || event.metaKey;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [at - 1, col],
      ArrowDown: [at + 1, col],
      ArrowLeft: [at, Math.max(0, col - 1)],
      ArrowRight: [at, Math.min(3, col + 1)],
      Home: mod ? [0, col] : [at, 0],
      End: mod ? [rows.length - 1, col] : [at, 3],
    };
    const move = moves[event.key];
    const row = move ? rows[move[0]] : undefined;
    if (!move || !row) return;
    event.preventDefault();
    const prefix = ['layer-', 'layer-hide-', 'layer-lock-', 'layer-more-'][move[1]];
    this.active.set({ id: row.el.id, col: move[1] });
    document.getElementById(`${prefix}${row.el.id}`)?.focus();
  }

  /**
   * Moves the selected layers together by `dx`, `dy`, kept on the canvas as a group; locked and
   * hidden ones stay where they are.
   */
  private moveSelection(dx: number, dy: number, repeat = false): void {
    if (this.isHeld()) return;
    // Hidden layers are not on the canvas: they neither move nor hold the group back, as when dragging.
    const selected = (this.doc()?.elements ?? []).filter((e) => this.isSelected(e.id) && !e.hidden);
    // The swipe-up link is pinned to the bottom safe area (R7): it stays, as a locked layer does.
    const movable = selected.filter((e) => !e.locked && e.type !== 'swipe-up');
    if (movable.length === 0) {
      this.say(
        selected.some((e) => e.type === 'swipe-up')
          ? PINNED
          : selected.length
            ? LOCKED
            : 'Hidden layers do not move. Show them first.',
      );
      return;
    }
    const step = clampMove(
      movable.map((e) => e.box),
      dx,
      dy,
    );
    const ids = new Set(movable.map((e) => e.id));
    const key = `move:${[...ids].join(',')}`;
    if (!repeat) this.history.seal();
    this.change(
      movable.length === 1 ? `${kindName(movable[0])} moved` : `${movable.length} layers moved`,
      (elements) => elements.map((e) => (ids.has(e.id) ? { ...e, box: moveBox(e.box, step.dx, step.dy) } : e)),
      key,
    );
    const locked = selected.length - movable.length;
    const stay = locked ? `; ${locked === 1 ? 'a locked layer stays' : `${locked} locked layers stay`}` : '';
    if (movable.length === 1) {
      const moved = this.element(movable[0].id);
      if (moved) {
        this.say(
          `${kindName(moved)} moved to left ${this.percent(moved.box.x)}%, top ${this.percent(moved.box.y)}%${stay}`,
        );
      }
    } else this.say(`${movable.length} layers moved${stay}`);
  }

  protected dragStart(event: PointerEvent, element: TaleElement): void {
    if (this.held()) return;
    this.dragged = false;
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
    const canvas = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    const before = this.doc();
    if (!canvas || canvas.width === 0 || canvas.height === 0 || !before) return;
    if (!this.isSelected(element.id)) this.selectOnly(element.id);
    const moving = (this.doc()?.elements ?? []).filter(
      (e) => this.isSelected(e.id) && !e.locked && !e.hidden && e.type !== 'swipe-up',
    );
    this.drag = {
      id: element.id,
      boxes: new Map(moving.map((e) => [e.id, e.box])),
      targets: snapTargets(this.doc()?.elements ?? [], new Set(moving.map((e) => e.id))),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: canvas.width,
      height: canvas.height,
      moved: false,
      // A locked layer alone stays; pressed in a selection, the unlocked others move.
      locked: moving.length === 0,
      before,
    };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
  }

  protected dragMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 3) return;
    if (drag.locked) {
      // A locked layer stays; the drag says why once.
      this.drag = null;
      this.say(this.element(drag.id)?.type === 'swipe-up' && !this.element(drag.id)?.locked ? PINNED : LOCKED);
      return;
    }
    drag.moved = true;
    const boxes = [...drag.boxes.values()];
    let step = clampMove(boxes, (event.clientX - drag.x) / drag.width, (event.clientY - drag.y) / drag.height);
    let lines: { x: number | null; y: number | null } | null = null;
    if (!event.altKey) {
      // Snapped by what shows: the bounds of the rotated boxes, as the safe-area warning measures them.
      const at = boundsOf(boxes.map(elementBounds));
      const snapped = snap({ ...at, x: at.x + step.dx, y: at.y + step.dy }, drag.targets, {
        x: SNAP_DISTANCE_PX / drag.width,
        y: SNAP_DISTANCE_PX / drag.height,
      });
      step = clampMove(boxes, step.dx + snapped.dx, step.dy + snapped.dy);
      lines = snapped.x === null && snapped.y === null ? null : { x: snapped.x, y: snapped.y };
    }
    this.snapLines.set(lines);
    // Shown as it goes; recorded and saved as one step when the drag ends.
    this.doc.set({
      ...drag.before,
      elements: drag.before.elements.map((e) => {
        const origin = drag.boxes.get(e.id);
        return origin ? { ...e, box: moveBox(origin, step.dx, step.dy) } : e;
      }),
    });
  }

  protected dragEnd(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.snapLines.set(null);
    if (!drag.moved) return;
    const moved = this.doc();
    const one = drag.boxes.size === 1 ? this.element([...drag.boxes.keys()][0]) : undefined;
    const label = one ? `${kindName(one)} moved` : `${drag.boxes.size} layers moved`;
    if (moved) {
      // The drag's step: from the document before it to the one it shows now.
      this.doc.set(drag.before);
      this.commit(label, moved);
    }
    this.dragged = true;
    // A click may not follow (the pointer was released elsewhere); it is only ignored straight after.
    setTimeout(() => (this.dragged = false), 0);
    const locked = [...this.selectedSet()].filter((id) => {
      const e = this.element(id);
      return e?.locked && !e.hidden;
    }).length;
    const stay = locked ? `; ${locked === 1 ? 'a locked layer stays' : `${locked} locked layers stay`}` : '';
    this.say(`${label}${stay}`);
  }

  // The menu's items for the selection: reorder and delete for several layers, and hide, lock and duplicate for one.
  private menuItems(): LayerMenuItem[] {
    const many = this.selection().length > 1;
    const one = this.selected();
    const item = (command: LayerCommand, label: string): LayerMenuItem => ({
      command,
      label,
      shortcut: this.keys[command],
    });
    return [
      item('forward', 'Bring forward'),
      item('backward', 'Send backward'),
      item('front', 'Bring to front'),
      item('back', 'Send to back'),
      ...(one && !many
        ? [
            item('hide', one.hidden ? 'Show' : 'Hide'),
            item('lock', one.locked ? 'Unlock' : 'Lock'),
            item('duplicate', 'Duplicate'),
          ]
        : []),
      item('delete', many ? `Delete ${this.selection().length} layers` : 'Delete'),
    ];
  }

  private openMenu(x: number, y: number, origin: Origin, returnId: string): void {
    this.stopEditing();
    // One popup at a time: the layer menu closes the keyboard shortcuts popover.
    this.helpOpen.set(false);
    this.menu.set({ x, y, items: this.menuItems(), origin, returnId });
  }

  /** A right-click on a canvas element or a layer row opens the actions for the selection holding it. */
  protected openMenuAt(event: MouseEvent, element: TaleElement, origin: Origin): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.isSelected(element.id)) this.selectOnly(element.id);
    const control = event.currentTarget as HTMLElement;
    const rect = control.getBoundingClientRect();
    // A pointer opens it where it is; the context-menu key or Shift+F10 below the control.
    const inside =
      (event.clientX !== 0 || event.clientY !== 0) &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    this.openMenu(inside ? event.clientX : rect.left, inside ? event.clientY : rect.bottom, origin, control.id);
  }

  /** A row's "More actions" button opens the actions below it. */
  protected openMenuFrom(button: HTMLElement, element: TaleElement): void {
    // The button toggles: pressed while its menu is open, it closes it.
    if (this.menu()?.returnId === button.id) {
      this.closeMenu(true);
      return;
    }
    if (!this.isSelected(element.id)) this.selectOnly(element.id);
    const rect = button.getBoundingClientRect();
    this.openMenu(rect.left, rect.bottom, 'list', button.id);
  }

  protected menuChosen(command: LayerCommand): void {
    const open = this.menu();
    this.menu.set(null);
    if (open) this.run(command, open.origin, open.returnId);
  }

  protected closeMenu(refocus: boolean): void {
    const open = this.menu();
    this.menu.set(null);
    if (open && refocus) this.focusSoon(open.returnId);
  }

  /** Sets the canvas background colour, from the colour picker or the hex field. */
  protected setBackground(color: string): void {
    if (this.isHeld()) return;
    this.hexError.set('');
    const doc = this.doc();
    if (!doc || doc.canvas.background.color === color) return;
    // A background image keeps its image: the colour is its band colour then (R2).
    this.commit('Background colour changed', {
      ...doc,
      canvas: { ...doc.canvas, background: { ...doc.canvas.background, color } },
    });
    this.say(`Background colour set to ${color}`);
  }

  /** Applies the hex field: `#RRGGBB` or `#RRGGBBAA`, with or without the `#`; anything else is restored. */
  protected setBackgroundHex(field: HTMLInputElement): void {
    const current = this.doc()?.canvas.background.color ?? '';
    const value = field.value.trim();
    const color = value.startsWith('#') ? value : `#${value}`;
    if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
      // The entry stays, marked invalid, so it can be corrected; the canvas keeps its colour.
      this.hexError.set(`Enter a colour as #RRGGBB or #RRGGBBAA. The background stays ${current}.`);
      this.say(this.hexError());
      return;
    }
    this.hexError.set('');
    field.value = color;
    this.setBackground(color);
  }

  /**
   * Opens the media picker (R5): to add an image or a video, to replace the selected one's media,
   * or to choose the background image. A tale holds one video, so a second is refused here.
   */
  protected openPicker(
    purpose: OpenPicker['purpose'],
    kind: MediaKind,
    elementId: string | null = null,
    sticker = false,
    imageButton = false,
  ): void {
    if (this.isHeld()) return;
    if (purpose === 'add' && kind === 'video' && this.videoLimitReached()) {
      this.say('A tale holds one video. Delete it to add another.');
      return;
    }
    const doc = this.doc();
    const element = elementId === null ? undefined : this.element(elementId);
    if (element?.locked) {
      this.say(LOCKED);
      return;
    }
    const background = doc?.canvas.background;
    const currentKey =
      purpose === 'background'
        ? background?.type === 'media'
          ? background.mediaKey
          : null
        : element && isMediaElement(element)
          ? element.props.mediaKey
          : null;
    const heading =
      purpose === 'background'
        ? 'Choose a background image'
        : imageButton
          ? purpose === 'replace'
            ? 'Choose another image for the button'
            : 'Add an image button'
          : sticker
          ? purpose === 'replace'
            ? 'Choose another sticker image'
            : 'Add an image sticker'
          : purpose === 'replace'
            ? `Choose another ${kind}`
            : `Add ${kind === 'image' ? 'an image' : 'a video'}`;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.picker.set({ purpose, kind, sticker, imageButton, heading, elementId, currentKey, returnFocus });
  }

  /** A canvas video read its length: one over 15 s is flagged, as only its first 15 s will play. */
  protected videoLoaded(key: string, video: HTMLVideoElement): void {
    const seconds = video.duration;
    if (!Number.isFinite(seconds) || this.videoSeconds().get(key) === seconds) return;
    this.videoSeconds.set(new Map([...this.videoSeconds(), [key, seconds]]));
  }

  protected closePicker(): void {
    this.picker.set(null);
  }

  /** The picker's choice: a new image or video, another file for the selected one, or the background image. */
  protected pickedMedia(media: ProjectMedia): void {
    const open = this.picker();
    this.picker.set(null);
    if (!open || this.isHeld()) return;
    const doc = this.doc();
    if (!doc) return;
    if (open.purpose === 'background') {
      if (media.kind !== 'image') return;
      const fit = doc.canvas.background.type === 'media' ? doc.canvas.background.fit : 'cover';
      this.commit('Background image set', {
        ...doc,
        canvas: {
          ...doc.canvas,
          background: { type: 'media', mediaKey: media.key, fit, color: doc.canvas.background.color },
        },
      });
      this.say('Background image set');
      return;
    }
    if (open.purpose === 'replace' && open.elementId !== null) {
      const id = open.elementId;
      const element = this.element(id);
      const fits =
        element?.type === 'sticker'
          ? media.kind === 'image' && STICKER_CONTENT_TYPES.includes(media.contentType)
          : element?.type === 'image-button'
            ? media.kind === 'image'
            : element?.type === media.kind;
      if (!element || !fits) return;
      const kind = kindName(element);
      this.change(`${kind} replaced`, (elements) =>
        elements.map((e) =>
          e.id === id && isMediaElement(e) ? ({ ...e, props: replacedMedia(e.props, media.key) } as TaleElement) : e,
        ),
      );
      this.say(`${kind} replaced`);
      this.focusSoon(`studio-el-${id}`);
      return;
    }
    if (open.imageButton) this.addImageButton(media);
    else this.addMedia(media, open.sticker);
  }

  // Adds an image button (R7) over the other layers, with no alt text or web address yet: the
  // inspector and the layers list say it needs both before the tale is updated.
  private addImageButton(media: ProjectMedia): void {
    if (media.kind !== 'image' || !this.roomForLayer()) return;
    const element: TaleElement = {
      id: crypto.randomUUID(),
      type: 'image-button',
      box: { ...NEW_IMAGE_BUTTON_BOX },
      hidden: false,
      locked: false,
      a11y: {},
      props: { mediaKey: media.key },
    };
    this.change('Image button added', (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say('Image button added. Give it a web address and alt text before updating the tale.');
    this.focusSoon(`link-href-${element.id}`);
  }

  // True when the tale has room for one more layer; otherwise says so.
  private roomForLayer(): boolean {
    if ((this.doc()?.elements.length ?? 0) < MAX_TALE_ELEMENTS) return true;
    this.say(`A tale holds at most ${MAX_TALE_ELEMENTS} layers`);
    return false;
  }

  /** Runs an Add menu entry (R8): the studio's own flow for a built-in type, else a configured type's. */
  protected addFromMenu(entry: AddMenuEntry, type: StudioElementType): void {
    const action = entry.action;
    switch (action.kind) {
      case 'text':
        return this.addText();
      case 'media':
        return this.openPicker('add', action.media);
      case 'sticker':
        return this.openPicker('add', 'image', null, true);
      case 'image-button':
        return this.openPicker('add', 'image', null, false, true);
      case 'shape':
        return this.addShape(action.shape);
      case 'emoji':
        return this.openEmojiPicker();
      case 'button':
        return this.addButton();
      case 'swipe-up':
        return this.addSwipeUp();
      case 'configured':
        return this.addConfigured(type);
    }
  }

  /** Adds an element of a type registered by configuration (R8), from its descriptor, and opens its inspector. */
  private addConfigured(type: StudioElementType): void {
    if (this.isHeld() || !this.roomForLayer() || !type.create) return;
    const element = {
      id: crypto.randomUUID(),
      type: type.key,
      box: { ...type.create.box },
      hidden: false,
      locked: false,
      a11y: { ...(type.create.a11y ?? {}) },
      props: type.create.props(),
    } as unknown as TaleElement;
    this.change(`${type.label} added`, (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say(`${type.label} added`);
    const first = typeof type.inspector === 'object' ? type.inspector.fields[0] : undefined;
    if (first) this.focusSoon(`field-${type.key}-${first.prop}-${element.id}`);
  }

  /** True for an image, video, image sticker or image button: the media inspector edits it. */
  protected isMedia(element: TaleElement): element is MediaElement {
    return isMediaElement(element);
  }

  /** The registered type of an element whose inspector is its descriptor's fields (R8), or null. */
  protected fieldsTypeOf(element: { type: string }): StudioElementType | null {
    const type = this.typesByKey.get(element.type);
    return type && typeof type.inspector === 'object' ? type : null;
  }

  /** How the canvas draws an element of a configured type: its descriptor's stand-in text. */
  protected configuredView(element: { type: string; box: TaleElementBox; props: unknown }): {
    text: string;
    color: string;
    fontSize: string;
  } {
    const type = this.typesByKey.get(element.type);
    const props = (typeof element.props === 'object' && element.props !== null ? element.props : {}) as Record<
      string,
      unknown
    >;
    const color = typeof props['color'] === 'string' && /^#[0-9a-f]{6}$/i.test(props['color']) ? props['color'] : '#ffffff';
    return {
      text: type?.preview?.(props) ?? type?.label ?? element.type,
      color,
      fontSize: `${Math.round(Math.min(element.box.h * 0.45, 0.05) * 100000) / 1000}cqh`,
    };
  }

  /** Adds a button (R7) above the bottom safe area, with no web address yet. */
  protected addButton(): void {
    if (this.isHeld() || !this.roomForLayer()) return;
    const element: TaleElement = {
      id: crypto.randomUUID(),
      type: 'button',
      box: { ...NEW_BUTTON_BOX },
      hidden: false,
      locked: false,
      a11y: {},
      props: newButtonProps(),
    };
    this.change('Button added', (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say('Button added. Give it a web address before updating the tale.');
    this.focusSoon(`link-href-${element.id}`);
  }

  /** Adds the swipe-up link (R7), pinned to the bottom safe area; a tale holds one. */
  protected addSwipeUp(): void {
    if (this.isHeld()) return;
    if (this.swipeUpLimitReached()) {
      this.say('A tale holds one swipe-up link. Delete it to add another.');
      return;
    }
    if (!this.roomForLayer()) return;
    const element: TaleElement = {
      id: crypto.randomUUID(),
      type: 'swipe-up',
      box: { ...SWIPE_UP_BOX },
      hidden: false,
      locked: false,
      a11y: {},
      props: newSwipeUpProps(),
    };
    this.change('Swipe-up link added', (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say('Swipe-up link added at the bottom of the tale. Give it a web address before updating the tale.');
    this.focusSoon(`link-href-${element.id}`);
  }

  // Adds an image, video or image sticker of the project's media over the other layers, with no alt
  // text yet: the layers list and the inspector say it needs some before the tale is updated (R12).
  private addMedia(media: ProjectMedia, sticker = false): void {
    const doc = this.doc();
    if (!doc) return;
    if (doc.elements.length >= MAX_TALE_ELEMENTS) {
      this.say(`A tale holds at most ${MAX_TALE_ELEMENTS} layers`);
      return;
    }
    if (media.kind === 'video' && this.hasVideo()) {
      this.say('A tale holds one video. Delete it to add another.');
      return;
    }
    const base = {
      id: crypto.randomUUID(),
      box: { ...NEW_MEDIA_BOX },
      hidden: false,
      locked: false,
      a11y: {},
      props: { mediaKey: media.key, fit: 'cover' as const },
    };
    let element: MediaElement;
    if (sticker) {
      if (media.kind !== 'image' || !STICKER_CONTENT_TYPES.includes(media.contentType)) return;
      element = { ...base, type: 'sticker', box: { ...NEW_STICKER_BOX }, props: { mediaKey: media.key } };
    } else element = media.kind === 'video' ? { ...base, type: 'video' } : { ...base, type: 'image' };
    const kind = kindName(element);
    this.change(`${kind} added`, (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say(`${kind} added. Give it alt text, or mark it decorative, before updating the tale.`);
    this.focusSoon(`media-alt-${element.id}`);
  }

  /**
   * Applies a change from the media, shape or emoji inspector as one step in the history, and says
   * what changed. A prop the change sets to `undefined` is removed.
   */
  protected restyleElement(id: string, change: ElementChange): void {
    if (this.isHeld()) return;
    const element = this.element(id);
    if (!element || element.type === 'text') return;
    if (element.locked) {
      this.say(LOCKED);
      return;
    }
    const recorded = this.change(change.label, (elements) =>
      elements.map((e) => {
        if (e.id !== id || e.type === 'text') return e;
        let props = e.props as Record<string, unknown>;
        if (change.props) {
          props = { ...props, ...change.props };
          for (const [key, value] of Object.entries(change.props)) if (value === undefined) delete props[key];
        }
        return { ...e, a11y: change.a11y ?? e.a11y, props } as TaleElement;
      }),
    );
    if (recorded) {
      if (this.invalidId() === id) this.invalidId.set(null);
      this.say(change.said);
    }
  }

  /** Adds a shape (R6) over the other layers: white, and decorative until it is named. */
  protected addShape(shape: ShapeKind): void {
    if (this.isHeld()) return;
    if ((this.doc()?.elements.length ?? 0) >= MAX_TALE_ELEMENTS) {
      this.say(`A tale holds at most ${MAX_TALE_ELEMENTS} layers`);
      return;
    }
    const element: TaleElement = {
      id: crypto.randomUUID(),
      type: 'shape',
      box: { ...(shape === 'line' ? NEW_LINE_BOX : NEW_SHAPE_BOX) },
      hidden: false,
      locked: false,
      a11y: { decorative: true },
      props: newShapeProps(shape),
    };
    const name = SHAPE_NAMES[shape];
    this.change(`${name} added`, (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say(`${name} added. It is decorative: screen readers skip it.`);
    this.focusSoon(`studio-el-${element.id}`);
  }

  /** Opens the emoji picker (R6): to add an emoji, or to choose another for the one `elementId` names. */
  protected openEmojiPicker(elementId: string | null = null): void {
    if (this.isHeld()) return;
    const element = elementId === null ? undefined : this.element(elementId);
    if (element?.locked) {
      this.say(LOCKED);
      return;
    }
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.emojiPicker.set({
      elementId,
      current: element?.type === 'emoji' ? element.props.emoji : null,
      heading: element ? 'Choose another emoji' : 'Add an emoji',
      returnFocus,
    });
  }

  /**
   * The emoji picker's choice: a new emoji named by its Unicode name, which the content manager can
   * edit (R6), or another emoji for the selected one, which then takes the new emoji's name.
   */
  protected pickedEmoji(choice: EmojiChoice): void {
    const open = this.emojiPicker();
    this.emojiPicker.set(null);
    if (!open || this.isHeld()) return;
    if (open.elementId !== null) {
      const id = open.elementId;
      const recorded = this.change('Emoji replaced', (elements) =>
        elements.map((e) =>
          e.id === id && e.type === 'emoji'
            ? { ...e, a11y: { ...e.a11y, label: choice.name }, props: { ...e.props, emoji: choice.emoji } }
            : e,
        ),
      );
      if (recorded) this.say(`Emoji replaced by ${choice.name}`);
      this.focusSoon(`studio-el-${id}`);
      return;
    }
    if ((this.doc()?.elements.length ?? 0) >= MAX_TALE_ELEMENTS) {
      this.say(`A tale holds at most ${MAX_TALE_ELEMENTS} layers`);
      return;
    }
    const element: TaleElement = {
      id: crypto.randomUUID(),
      type: 'emoji',
      box: { ...NEW_EMOJI_BOX },
      hidden: false,
      locked: false,
      a11y: { label: choice.name },
      props: { emoji: choice.emoji },
    };
    this.change('Emoji added', (elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say(`Emoji added: ${choice.name}. Screen readers announce it by this name, which you can edit.`);
    this.focusSoon(`studio-el-${element.id}`);
  }

  /** Applies a width or height field (a percentage of the canvas), keeping the box on the canvas. */
  protected setSize(id: string, axis: 'w' | 'h', field: HTMLInputElement): void {
    const element = this.element(id);
    if (!element) return;
    const name = axis === 'w' ? 'width' : 'height';
    if (this.isHeld() || element.locked) {
      field.value = String(this.percent(element.box[axis]));
      if (element.locked) this.say(LOCKED);
      return;
    }
    const requested = Number(field.value);
    if (field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(this.percent(element.box[axis]));
      this.say(`Enter a number for ${name}; it stays at ${field.value}%`);
      return;
    }
    const size = round(clamp(requested / 100, 0.01, 1));
    this.setBox(id, { [axis]: size }, `${kindName(element)} resized`);
    const applied = this.percent(this.element(id)?.box[axis] ?? size);
    field.value = String(applied);
    this.say(`${kindName(element)} ${name} set to ${applied}%`);
  }

  /** Applies the rotation field, in degrees from -180 to 180 about the box's centre. */
  protected setRotation(id: string, field: HTMLInputElement): void {
    const element = this.element(id);
    if (!element) return;
    if (this.isHeld() || element.locked) {
      field.value = String(element.box.rotation);
      if (element.locked) this.say(LOCKED);
      return;
    }
    const requested = Number(field.value);
    if (field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(element.box.rotation);
      this.say(`Enter a number of degrees from -180 to 180; it stays at ${field.value}°`);
      return;
    }
    const rotation = Math.round(clamp(requested, -180, 180) * 10) / 10;
    field.value = String(rotation);
    this.setBox(id, { rotation }, `${kindName(element)} rotated`);
    this.say(`${kindName(element)} rotated to ${rotation}°`);
  }

  /** Applies the duration field (R5): 3 to 15 seconds, for a tale without a video. */
  protected setDuration(field: HTMLInputElement): void {
    const doc = this.doc();
    if (!doc) return;
    const current = this.durationSeconds();
    if (this.isHeld() || this.hasVideo()) {
      field.value = String(current);
      if (this.hasVideo()) this.say("The tale plays for its video's length.");
      return;
    }
    const requested = Number(field.value);
    if (field.value.trim() === '' || !Number.isFinite(requested)) {
      field.value = String(current);
      this.say(`Enter a number of seconds from ${this.minDuration} to ${this.maxDuration}; it stays at ${current}`);
      return;
    }
    const seconds = clamp(Math.round(requested * 2) / 2, this.minDuration, this.maxDuration);
    field.value = String(seconds);
    this.commit('Duration changed', { ...doc, durationMs: Math.round(seconds * 1000) });
    this.say(
      seconds === requested
        ? `Duration set to ${seconds} seconds`
        : `Duration set to ${seconds} seconds, as far as it goes`,
    );
  }

  protected setBackgroundFit(fit: string): void {
    const doc = this.doc();
    if (this.isHeld() || !doc || doc.canvas.background.type !== 'media') return;
    if (!(MEDIA_FITS as readonly string[]).includes(fit)) return;
    const value = fit as (typeof MEDIA_FITS)[number];
    this.commit('Background fit changed', {
      ...doc,
      canvas: { ...doc.canvas, background: { ...doc.canvas.background, fit: value } },
    });
    this.say(`Background image fit set to ${FIT_NAMES[value]}`);
  }

  protected removeBackgroundMedia(): void {
    const doc = this.doc();
    if (this.isHeld() || !doc || doc.canvas.background.type !== 'media') return;
    this.commit('Background image removed', {
      ...doc,
      canvas: { ...doc.canvas, background: { type: 'color', color: doc.canvas.background.color } },
    });
    this.say('Background image removed; the background colour shows');
    this.focusSoon('studio-bg-media');
  }

  protected showGuides(on: boolean): void {
    this.guides.set(on);
    this.say(on ? 'Safe areas shown' : 'Safe areas hidden');
  }

  // A failed save in words a person can act on. A refused element, named by the pointer, is selected and marked.
  private refusal(result: TaleDocumentFailure, retrying: boolean): string {
    if (retrying) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return 'You are offline. Your changes are kept on this page and saved when you are back online.';
      }
      return result.status === 0
        ? 'Your latest changes are not saved: the connection failed. Trying again automatically.'
        : 'Your latest changes are not saved: the server did not answer. Trying again automatically.';
    }
    if (result.code === ErrorCodes.taleDocumentTooLarge) {
      return 'This tale is too large to save. Shorten or remove some text, then save again.';
    }
    if (result.code === ErrorCodes.invalidTaleDocument) {
      const index = /^\/elements\/(\d+)/.exec(result.pointer)?.[1];
      const element = index === undefined ? undefined : this.doc()?.elements[Number(index)];
      const gone = missingMedia(result.message);
      if (element) {
        this.invalidId.set(element.id);
        this.selectOnly(element.id);
        if (gone) return `${missingMediaMessage(kindName(element).toLowerCase(), 'saved')} It is selected on the canvas.`;
        if (element.type !== 'text') {
          const kind = kindName(element).toLowerCase();
          return `This ${kind} could not be saved: ${result.message}. It is selected on the canvas.`;
        }
        return 'A text could not be saved: it is too long or holds something a text cannot. It is selected on the canvas.';
      }
      if (gone) return missingMediaMessage('background', 'saved');
      return 'The tale could not be saved because something in it is not valid. Reload the page and try again.';
    }
    return `Your latest changes are not saved. ${result.message}`;
  }

  /** After a stale save: reads the latest version, which replaces this one; the history starts over. */
  protected async reload(): Promise<void> {
    this.selectOnly(null);
    this.editingId.set(null);
    this.menu.set(null);
    await this.load();
    if (!this.error()) {
      this.say('Latest version loaded');
      // The stale choice that had focus is gone: focus goes to the canvas.
      this.focusSoon('studio-canvas');
    }
  }
}

// True for a refusal of media the project does not have (any more): an unknown key, or the file of
// a deleted tale that this tale's draft still shows (story 8.20).
function missingMedia(message: string): boolean {
  return message.endsWith(UNKNOWN_MEDIA_REASON);
}

// What to do about media that no longer exists, for the element kind (or the background) using it.
function missingMediaMessage(subject: string, what: 'saved' | 'updated'): string {
  return (
    `The tale could not be ${what}: this ${subject} uses a media file that no longer exists, ` +
    'perhaps because the tale it came from was deleted. Pick other media for it, or remove it.'
  );
}
