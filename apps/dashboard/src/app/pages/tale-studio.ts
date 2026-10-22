import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  HostListener,
  inject,
  input,
  linkedSignal,
  OnChanges,
  signal,
  untracked,
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
  elementName,
  hasAltText,
  hasVideoElement,
  isMediaElement,
  isOutsideSafeArea,
  isTaleMediaElement,
  stageTaleMedia,
  limitedVideoCount,
  MAX_VIDEO_ELEMENTS,
  MAX_TALE_DURATION_MS,
  MAX_TALE_VIDEO_MS,
  MAX_TALE_ELEMENTS,
  MAX_TEXT_LENGTH,
  MEDIA_FITS,
  MIN_TALE_DURATION_MS,
  SHAPE_KINDS,
  NEW_EMOJI_BOX,
  NEW_LINE_BOX,
  NEW_MEDIA_BOX,
  NEW_SHAPE_BOX,
  NEW_STICKER_BOX,
  NEW_TEXT_BOX,
  newShapeProps,
  resolveShapeStyle,
  TALE_SAFE_AREA,
  type MediaElement,
  type ShapeElement,
  type ShapeKind,
  type PublishedTaleDocument,
  type TaleDocument,
  type TaleElement,
  type TaleElementBox,
  type TextElementProps,
} from '@taleart/contract/tale-document';
import {
  DEFAULT_TEXT_STYLE,
  resolveTextStyle,
  TEXT_BOX_PADDING_EM,
  TEXT_HIGHLIGHT_PADDING_EM,
  textCssWeight,
  textBackdropAt,
  textContrast,
  textFontFamily,
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
import { DuplicateTale, duplicatedMessage, type DuplicatedTale } from './duplicate-tale';
import { AUTOSAVE_TIMING, TaleAutosaver, type AutosaveState } from './tale-autosave';
import { changeCount, sameDocument, siteVersion, TaleHistory } from './tale-history';
import { TaleLayerMenu, type LayerMenuItem } from './tale-layer-menu';
import { FIT_NAMES, STICKER_CONTENT_TYPES, TaleMediaPicker, TaleMediaStyle } from './tale-media';
import {
  SHAPE_NAMES,
  TaleEmojiPicker,
  TaleEmojiStyle,
  TaleShapeStyle,
  type ElementChange,
  type EmojiChoice,
} from './tale-shapes';
import {
  boundsOf,
  clamp,
  clampMove,
  duplicateElement,
  historyKeyShortcuts,
  historyLabel,
  historyShortcut,
  isApple,
  isTextEntry,
  LAYER_KEYSHORTCUTS,
  layerName,
  layerShortcut,
  moveBox,
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
export const MOVE_STEP = 0.01;

/** How long leaving the studio waits for unsaved changes to save before it asks (ms). */
export const LEAVE_WAIT_MS = 5000;

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
const REORDERED: Record<ReorderCommand, [string, string]> = {
  forward: ['brought forward', 'Already at the front'],
  backward: ['sent backward', 'Already at the back'],
  front: ['moved to the front', 'Already at the front'],
  back: ['moved to the back', 'Already at the back'],
};
const layers = (n: number) => (n === 1 ? 'Layer' : `${n} layers`);
const KIND_NAMES: Readonly<Record<TaleElement['type'], string>> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  shape: 'Shape',
  emoji: 'Emoji',
  sticker: 'Sticker',
};
/** How people read an element's type: "Text", "Image", "Video", "Emoji", "Sticker", or a shape's ("Ellipse"). */
export const kindName = (element: { type: TaleElement['type']; props?: unknown }): string => {
  const shape = element.type === 'shape' ? (element.props as { shape?: ShapeKind } | undefined)?.shape : undefined;
  return (shape && SHAPE_NAMES[shape]) || KIND_NAMES[element.type];
};

/** How the canvas draws a shape, as the Web SDK renders it: each value from the contract's `resolveShapeStyle`. */
export interface ShapeView {
  fill: string | null;
  border: string | null;
  radius: string | null;
  opacity: number;
  /** A line's bar: its thickness and colour; null for a rectangle or an ellipse. */
  line: { height: string; color: string | null } | null;
}

/** The canvas look of a shape's props. */
export function shapeView(props: unknown): ShapeView {
  const look = resolveShapeStyle(props);
  if (!look) return { fill: null, border: null, radius: null, opacity: 1, line: null };
  const stroked = look.stroke !== null && look.strokeWidth > 0;
  if (look.shape === 'line') {
    return {
      fill: null,
      border: null,
      radius: null,
      opacity: look.opacity,
      line: { height: `${look.strokeWidth * 100}cqh`, color: stroked ? look.stroke : null },
    };
  }
  return {
    fill: look.fill,
    border: stroked ? `${look.strokeWidth * 100}cqh solid ${look.stroke}` : null,
    radius: look.shape === 'ellipse' ? '50%' : look.radius > 0 ? `${look.radius * 100}cqh` : null,
    opacity: look.opacity,
    line: null,
  };
}

/** The media picker while it is open: what it picks for, and of which kind. */
interface OpenPicker {
  purpose: 'add' | 'replace' | 'background';
  kind: MediaKind;
  /** Picks an image sticker: PNG, WebP and GIF images only (R6). */
  sticker: boolean;
  heading: string;
  /** The element whose media `replace` changes. */
  elementId: string | null;
  currentKey: string | null;
  returnFocus: HTMLElement | null;
}

/** How the canvas draws a text, as the Web SDK renders it: each value from the contract's `resolveTextStyle`. */
export interface TextView {
  dir: string;
  family: string;
  size: string;
  weight: number;
  fontStyle: string;
  color: string;
  lineHeight: number;
  align: string;
  /** A solid box's colour and inline padding, or null. */
  boxColor: string | null;
  boxPadding: string | null;
  /** A per-line highlight's colour and inline padding, or null. */
  lineColor: string | null;
  linePadding: string | null;
}

/** The canvas look of a text's props; `themeFont` is the project theme's font-family list, or null. */
export function textView(props: unknown, themeFont: string | null): TextView {
  const look = resolveTextStyle(props);
  const box = look.background === 'box';
  const line = look.background === 'highlight';
  return {
    dir: look.direction,
    family: textFontFamily(look, themeFont),
    size: `${look.size * 100}cqh`,
    weight: textCssWeight(look.weight),
    fontStyle: look.italic ? 'italic' : 'normal',
    color: look.color,
    lineHeight: look.lineHeight,
    align: look.align,
    boxColor: box ? look.backgroundColor : null,
    boxPadding: box ? `${TEXT_BOX_PADDING_EM}em` : null,
    lineColor: line ? look.backgroundColor : null,
    linePadding: line ? `${TEXT_HIGHLIGHT_PADDING_EM}em` : null,
  };
}

/**
 * The props of a new text: its text and every style setting stored explicitly (story 7.4), the
 * direction `auto` included, so what it looks like does not depend on defaults.
 */
export function newTextProps(text: string): TextElementProps {
  const { font, ...style } = DEFAULT_TEXT_STYLE;
  return { text, font: { ...font }, ...style };
}

// The props of a media element given other media: other media is not the tale's own (R16), so the
// mark goes, and the server keeps the tale's media apart from it.
function replacedMedia<P extends object>(props: P, mediaKey: string): P {
  const next: Record<string, unknown> = { ...props, mediaKey };
  delete next['taleMedia'];
  return next as P;
}

/**
 * Tale Studio (epic Tale Studio stories 1 to 3): a tale on a 9:16 canvas with its media over the
 * canvas colour, where a content manager adds text elements, types their text in place, moves
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
    DuplicateTale,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .studio {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-6);
      align-items: flex-start;
    }
    .canvas {
      position: relative;
      flex: none;
      width: min(100%, 300px);
      aspect-ratio: 9 / 16;
      overflow: hidden;
      border-radius: var(--radius-control);
      container-type: size;
      touch-action: none;
    }
    .canvas__media {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
    }
    .el,
    .el-edit {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 0;
      border: 1px dashed #fff;
      outline: 1px solid rgb(0 0 0 / 70%);
      background: transparent;
      text-align: center;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .el {
      flex-direction: column;
      align-items: stretch;
      cursor: move;
      touch-action: none;
    }
    .el__line {
      display: block;
    }
    .el__media {
      display: block;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .el__shape {
      position: relative;
      display: block;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .el__stroke {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
    }
    .el__emoji {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      line-height: 1;
      white-space: nowrap;
      pointer-events: none;
    }
    .el__glyphs.is-highlight {
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }
    .el.is-selected {
      border: 2px solid var(--ember);
      box-shadow: inset 0 0 0 1px #fff;
      outline: 2px solid #000;
    }
    .el.is-locked {
      cursor: default;
    }
    .guides,
    .snap-line {
      position: absolute;
      z-index: 100;
      pointer-events: none;
    }
    .guides {
      outline: 1px dashed #fff;
      box-shadow:
        0 0 0 1px rgb(0 0 0 / 60%),
        0 0 0 999px rgb(0 0 0 / 25%);
    }
    .snap-line {
      background: var(--ember);
      box-shadow:
        0 0 0 1px #fff,
        0 0 0 2px #000;
    }
    .snap-line--x {
      top: 0;
      bottom: 0;
      width: 1px;
    }
    .snap-line--y {
      left: 0;
      right: 0;
      height: 1px;
    }
    .el:focus-visible {
      outline: 3px solid #fff;
      outline-offset: 1px;
      box-shadow: 0 0 0 5px var(--ink);
    }
    .el-edit {
      resize: none;
      border: 2px solid var(--ember);
      background: rgb(0 0 0 / 35%);
    }
    .panel {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--space-4);
      min-width: 240px;
      max-width: 420px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .row .field {
      flex: 1;
      min-width: 100px;
    }
    .selected {
      margin: 0;
      padding: 0;
      border: 0;
    }
    textarea.input {
      min-height: 96px;
      padding: var(--space-2) var(--space-3);
      resize: vertical;
    }
  `,
  template: `
    <div class="page">
      <header class="page-header">
        <a class="back-link" [routerLink]="backLink()"><app-icon name="back" /> Back</a>
        <h2 class="page-header__title">Tale Studio</h2>
        @if (tale(); as t) {
          <p class="page-header__meta">{{ t.title }}</p>
        }
      </header>
      @if (doc(); as d) {
        <section class="card section" aria-labelledby="studio-title">
          <h3 class="section__title visually-hidden" id="studio-title">Edit {{ tale()?.title ?? 'tale' }}</h3>
          <div class="studio-bar">
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              id="studio-undo"
              [attr.aria-disabled]="historyState().undo === null ? 'true' : null"
              [attr.aria-keyshortcuts]="undoKeys"
              [title]="
                historyState().undo === null ? 'Nothing to undo' : 'Undo ' + historyState().undo + ' (' + undoKey + ')'
              "
              (click)="runHistory('undo')"
            >
              <app-icon name="undo" /> Undo
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              id="studio-redo"
              [attr.aria-disabled]="historyState().redo === null ? 'true' : null"
              [attr.aria-keyshortcuts]="redoKeys"
              [title]="
                historyState().redo === null ? 'Nothing to redo' : 'Redo ' + historyState().redo + ' (' + redoKey + ')'
              "
              (click)="runHistory('redo')"
            >
              <app-icon name="redo" /> Redo
            </button>
            <p class="studio-save" id="studio-save" [class.is-failed]="saveFailed()">{{ saveText() }}</p>
          </div>
          <div class="studio-update" [class.is-pending]="unpublished()">
            <p class="studio-update__state" id="studio-update-state">
              @if (siteVisibility(); as v) {
                <span class="studio-update__dot" [class.is-visible]="v.visible" aria-hidden="true"></span>
              }
              {{ statusLine() }}
            </p>
            <button
              type="button"
              class="btn btn--primary btn--sm"
              id="studio-update"
              aria-describedby="studio-update-state"
              [attr.aria-disabled]="!canUpdate() || updating() ? 'true' : null"
              (click)="updateTale()"
            >
              Update tale
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              id="studio-discard"
              aria-describedby="studio-update-state"
              [attr.aria-disabled]="!unpublished() || published().document === null || updating() ? 'true' : null"
              (click)="discardChanges()"
            >
              Discard changes
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--sm"
              id="studio-duplicate"
              [attr.aria-disabled]="updating() || !tale() ? 'true' : null"
              (click)="openDuplicate($event)"
            >
              Duplicate
            </button>
          </div>
          @if (duplicateResult(); as dup) {
            <p class="studio-notice" id="studio-duplicated">
              {{ dup.message }}
              <a [routerLink]="['/tales', dup.id, 'studio']">Open the copy</a>
            </p>
          }
          @if (duplicating() && tale(); as t) {
            <app-duplicate-tale
              [tale]="t"
              [returnFocus]="duplicateOpener"
              (duplicated)="duplicatedTale($event)"
              (closed)="duplicating.set(false)"
            />
          }
          @if (saveState(); as s) {
            @if (s.kind === 'conflict') {
              <div class="form-error studio-alert" role="alert">
                <p>
                  Someone saved this tale after you opened it, so your latest changes are not saved. They are still
                  here. Reload the latest version, which discards your changes, or keep your version as a new draft tale
                  in the same group.
                </p>
                <div class="row">
                  <button type="button" class="btn btn--secondary btn--sm" (click)="reload()">
                    Reload latest version
                  </button>
                  <button
                    type="button"
                    class="btn btn--primary btn--sm"
                    [attr.aria-disabled]="keeping() ? 'true' : null"
                    (click)="keepAsNewTale()"
                  >
                    Keep my version as a new tale
                  </button>
                </div>
              </div>
            } @else if (recovering()) {
              <!-- Stays while saving is failing, through each retry, so "Retry now" keeps its focus. -->
              <div class="form-error studio-alert" id="studio-save-problem">
                <p>{{ saveError() }}</p>
                <p class="studio-retry">{{ retryText() }}</p>
                <button
                  type="button"
                  class="btn btn--secondary btn--sm"
                  id="studio-retry"
                  [attr.aria-disabled]="s.kind === 'saving' ? 'true' : null"
                  (click)="retrySave()"
                >
                  Retry now
                </button>
              </div>
            }
          }
          <!-- One live region for save failures: the first failure and nothing per retry. -->
          <p class="visually-hidden" role="alert">{{ saveAlert() }}</p>
          @if (error()) {
            <p class="form-error studio-alert" role="alert">{{ error() }}</p>
          }
          @if (notice()) {
            <p class="studio-notice" role="status">{{ notice() }}</p>
          }
          <div class="studio">
            <div
              class="canvas"
              id="studio-canvas"
              tabindex="-1"
              role="group"
              aria-label="Canvas, 9:16"
              aria-describedby="studio-keys"
              [style.background-color]="d.canvas.background.color"
            >
              @if (d.canvas.background.type === 'media') {
                <!-- The background image (R2), over its band colour, as the Web SDK paints it. Over the tale's
                     own media drawn full-bleed (R16) it lies above that media, bands included, as before. -->
                <img
                  class="canvas__media"
                  [src]="mediaSrc(d.canvas.background.mediaKey)"
                  alt=""
                  [style.object-fit]="d.canvas.background.fit"
                  [style.z-index]="stageMedia() ? 2 : null"
                  [style.background-color]="stageMedia() ? d.canvas.background.color : null"
                />
              }
              @for (el of d.elements; track el.id; let i = $index) {
                @let v = view(el);
                @if (el.hidden) {
                  <!-- A hidden layer is not drawn; it stays in the layers list. -->
                } @else if (editingId() === el.id && el.type === 'text') {
                  <textarea
                    class="el-edit"
                    [id]="'studio-edit-' + el.id"
                    aria-label="Text"
                    [style.left.%]="el.box.x * 100"
                    [style.top.%]="el.box.y * 100"
                    [style.width.%]="el.box.w * 100"
                    [style.height.%]="el.box.h * 100"
                    [style.transform]="el.box.rotation ? 'rotate(' + el.box.rotation + 'deg)' : null"
                    [style.z-index]="i + 1"
                    [attr.dir]="v.dir"
                    [style.font-family]="v.family"
                    [style.font-size]="v.size"
                    [style.line-height]="v.lineHeight"
                    [style.font-weight]="v.weight"
                    [style.font-style]="v.fontStyle"
                    [style.color]="v.color"
                    [style.text-align]="v.align"
                    [style.background-color]="v.boxColor ?? v.lineColor"
                    [style.padding-inline]="v.boxPadding ?? v.linePadding"
                    [value]="el.props.text"
                    (input)="typeText(el.id, $any($event.target))"
                    (blur)="stopEditing()"
                    (keydown.escape)="stopEditing(true)"
                  ></textarea>
                } @else if (el.type !== 'text') {
                  <!-- An image, video, shape, emoji or sticker (R5, R6), as the Web SDK renders it. -->
                  <button
                    type="button"
                    class="el"
                    [id]="'studio-el-' + el.id"
                    [class.is-selected]="isSelected(el.id)"
                    [class.is-locked]="el.locked"
                    [attr.aria-pressed]="isSelected(el.id)"
                    [attr.aria-invalid]="invalidId() === el.id ? 'true' : null"
                    [attr.aria-label]="kind(el) + ': ' + name(el)"
                    [attr.aria-describedby]="'layer-state-' + el.id"
                    [attr.aria-keyshortcuts]="keyShortcuts"
                    [style.left.%]="el.box.x * 100"
                    [style.top.%]="el.box.y * 100"
                    [style.width.%]="el.box.w * 100"
                    [style.height.%]="el.box.h * 100"
                    [style.transform]="el.box.rotation ? 'rotate(' + el.box.rotation + 'deg)' : null"
                    [style.z-index]="i + 1"
                    (click)="pick($event, el.id)"
                    (contextmenu)="openMenuAt($event, el, 'canvas')"
                    (keydown)="onKey($event, el)"
                    (pointerdown)="dragStart($event, el)"
                    (pointermove)="dragMove($event)"
                    (pointerup)="dragEnd($event)"
                    (pointercancel)="dragEnd($event)"
                  >
                    @if (el.type === 'video') {
                      <video
                        class="el__media"
                        [src]="mediaSrc(el.props.mediaKey)"
                        [muted]="true"
                        muted
                        playsinline
                        preload="metadata"
                        aria-hidden="true"
                        [style.object-fit]="el.props.fit"
                        [style.border-radius]="(el.props.radius ?? 0) * 100 + 'cqh'"
                        [style.opacity]="el.props.opacity ?? 1"
                        (loadedmetadata)="videoLoaded(el.props.mediaKey, $any($event.target))"
                      ></video>
                    } @else if (el.type === 'image') {
                      <img
                        class="el__media"
                        [src]="mediaSrc(el.props.mediaKey)"
                        alt=""
                        draggable="false"
                        [style.object-fit]="el.props.fit"
                        [style.border-radius]="(el.props.radius ?? 0) * 100 + 'cqh'"
                        [style.opacity]="el.props.opacity ?? 1"
                      />
                    } @else if (el.type === 'sticker') {
                      <!-- An image sticker shows the whole image (R6). -->
                      <img
                        class="el__media"
                        [src]="mediaSrc(el.props.mediaKey)"
                        alt=""
                        draggable="false"
                        style="object-fit: contain"
                        [style.opacity]="el.props.opacity ?? 1"
                      />
                    } @else if (el.type === 'shape') {
                      @let s = shape(el);
                      <span
                        class="el__shape"
                        [style.background-color]="s.fill"
                        [style.border]="s.border"
                        [style.border-radius]="s.radius"
                        [style.opacity]="s.opacity"
                      >
                        @if (s.line; as line) {
                          <span
                            class="el__stroke"
                            [style.height]="line.height"
                            [style.background-color]="line.color"
                          ></span>
                        }
                      </span>
                    } @else {
                      <!-- An emoji is text in the platform's emoji fonts, sized to its box (R6). -->
                      <span
                        class="el__emoji"
                        aria-hidden="true"
                        [style.font-family]="emojiFont"
                        [style.font-size]="emojiSize(el.box)"
                        [textContent]="el.props.emoji"
                      ></span>
                    }
                  </button>
                } @else {
                  <button
                    type="button"
                    class="el"
                    [id]="'studio-el-' + el.id"
                    [class.is-selected]="isSelected(el.id)"
                    [class.is-locked]="el.locked"
                    [attr.aria-pressed]="isSelected(el.id)"
                    [attr.aria-invalid]="invalidId() === el.id ? 'true' : null"
                    [attr.aria-label]="'Text: ' + name(el)"
                    [attr.aria-describedby]="'layer-state-' + el.id"
                    [attr.aria-keyshortcuts]="keyShortcuts"
                    [style.left.%]="el.box.x * 100"
                    [style.top.%]="el.box.y * 100"
                    [style.width.%]="el.box.w * 100"
                    [style.height.%]="el.box.h * 100"
                    [style.transform]="el.box.rotation ? 'rotate(' + el.box.rotation + 'deg)' : null"
                    [style.z-index]="i + 1"
                    [attr.dir]="v.dir"
                    [style.font-family]="v.family"
                    [style.font-size]="v.size"
                    [style.line-height]="v.lineHeight"
                    [style.font-weight]="v.weight"
                    [style.font-style]="v.fontStyle"
                    [style.color]="v.color"
                    [style.text-align]="v.align"
                    [style.background-color]="v.boxColor"
                    [style.padding-inline]="v.boxPadding"
                    (click)="pick($event, el.id)"
                    (dblclick)="edit(el.id)"
                    (contextmenu)="openMenuAt($event, el, 'canvas')"
                    (keydown)="onKey($event, el)"
                    (pointerdown)="dragStart($event, el)"
                    (pointermove)="dragMove($event)"
                    (pointerup)="dragEnd($event)"
                    (pointercancel)="dragEnd($event)"
                  >
                    <!-- As the Web SDK renders it: a block line holding the inline glyphs, highlighted per line. -->
                    <span class="el__line"
                      ><span
                        class="el__glyphs"
                        [class.is-highlight]="v.lineColor !== null"
                        [style.background-color]="v.lineColor"
                        [style.padding-inline]="v.linePadding"
                        [textContent]="el.props.text"
                      ></span
                    ></span>
                  </button>
                }
              }
              @if (guides()) {
                <div
                  class="guides"
                  aria-hidden="true"
                  [style.left.%]="safeArea.side * 100"
                  [style.right.%]="safeArea.side * 100"
                  [style.top.%]="safeArea.top * 100"
                  [style.bottom.%]="safeArea.bottom * 100"
                ></div>
              }
              @if (snapLines(); as lines) {
                @if (lines.x !== null) {
                  <div class="snap-line snap-line--x" aria-hidden="true" [style.left.%]="lines.x * 100"></div>
                }
                @if (lines.y !== null) {
                  <div class="snap-line snap-line--y" aria-hidden="true" [style.top.%]="lines.y * 100"></div>
                }
              }
            </div>
            <div class="panel">
              <div class="row">
                <button
                  type="button"
                  class="btn btn--secondary"
                  id="studio-add"
                  [disabled]="d.elements.length >= maxElements"
                  (click)="addText()"
                >
                  <app-icon name="plus" /> Add text
                </button>
                <button
                  type="button"
                  class="btn btn--secondary"
                  id="studio-add-image"
                  [disabled]="d.elements.length >= maxElements || !projectId()"
                  (click)="openPicker('add', 'image')"
                >
                  <app-icon name="image" /> Add image
                </button>
                <button
                  type="button"
                  class="btn btn--secondary"
                  id="studio-add-video"
                  [disabled]="d.elements.length >= maxElements || !projectId()"
                  [attr.aria-disabled]="videoLimitReached() ? 'true' : null"
                  [attr.aria-describedby]="videoLimitReached() ? 'studio-video-hint' : null"
                  (click)="openPicker('add', 'video')"
                >
                  <app-icon name="video" /> Add video
                </button>
              </div>
              <div class="row">
                @for (shape of shapeKinds; track shape) {
                  <button
                    type="button"
                    class="btn btn--secondary btn--sm"
                    [id]="'studio-add-' + shape"
                    [disabled]="d.elements.length >= maxElements"
                    (click)="addShape(shape)"
                  >
                    <app-icon name="shape" /> Add {{ shapeNames[shape].toLowerCase() }}
                  </button>
                }
                <button
                  type="button"
                  class="btn btn--secondary btn--sm"
                  id="studio-add-emoji"
                  [disabled]="d.elements.length >= maxElements"
                  (click)="openEmojiPicker()"
                >
                  <app-icon name="emoji" /> Add emoji
                </button>
                <button
                  type="button"
                  class="btn btn--secondary btn--sm"
                  id="studio-add-sticker"
                  [disabled]="d.elements.length >= maxElements || !projectId()"
                  (click)="openPicker('add', 'image', null, true)"
                >
                  <app-icon name="sticker" /> Add sticker
                </button>
              </div>
              @if (videoLimitReached()) {
                <p class="field__hint" id="studio-video-hint">
                  A tale holds one video, and plays for its length. Delete it to add another.
                </p>
              }
              <p class="field__hint" id="studio-keys">
                Select a layer to move it with the arrow keys (Shift for larger steps). Enter edits its text, Escape
                stops editing. Dragging snaps to the centre, the safe areas and other layers; hold Alt to place freely.
                On the canvas and in the layers list: {{ keys.forward }} and {{ keys.backward }} reorder,
                {{ keys.front }} and {{ keys.back }} bring to the front or the back, H hides, L locks, D duplicates,
                {{ keys.delete }} deletes, {{ keys['select-all'] }} selects all, and the context-menu key or Shift+F10
                opens the actions. Outside text fields, {{ undoKey }} undoes and {{ redoKey }} redoes. Changes save
                automatically.
              </p>
              <section class="field" aria-labelledby="layers-title">
                <h4 class="field__label" id="layers-title">Layers</h4>
                <p class="field__hint" id="layers-hint">
                  Top layer first. The up and down arrows move between layers, left and right between a layer's
                  controls. {{ multiHint }} adds a layer to the selection.
                </p>
                @if (layerRows().length === 0) {
                  <p class="muted">No layers yet.</p>
                } @else {
                  <div
                    class="layers"
                    role="grid"
                    aria-labelledby="layers-title"
                    aria-describedby="layers-hint"
                    aria-multiselectable="true"
                  >
                    @for (row of layerRows(); track row.el.id) {
                      <div
                        class="layer"
                        role="row"
                        [class.is-selected]="isSelected(row.el.id)"
                        [class.is-hidden]="row.el.hidden"
                        [attr.aria-selected]="isSelected(row.el.id)"
                      >
                        <div
                          role="gridcell"
                          class="layer__select"
                          [id]="'layer-' + row.el.id"
                          [attr.tabindex]="tabIndex(row.el.id, 0)"
                          [attr.aria-keyshortcuts]="keyShortcuts"
                          (click)="pick($event, row.el.id)"
                          (focus)="activate(row.el.id, 0)"
                          (keydown)="onCellKey($event, row.el, 0)"
                          (contextmenu)="openMenuAt($event, row.el, 'list')"
                        >
                          <span class="layer__line">
                            <app-icon [name]="row.el.type" />
                            <span class="visually-hidden">{{ kind(row.el) }}: </span>
                            <span class="layer__name">{{ row.name }}</span>
                          </span>
                          <span class="layer__state" [id]="'layer-state-' + row.el.id">
                            @if (row.el.hidden) {
                              <span>Hidden</span>
                            }
                            @if (row.el.locked) {
                              <span>Locked</span>
                            }
                            @if (row.outside) {
                              <span class="layer__warning"><app-icon name="alert" /> Outside safe area</span>
                            }
                            @if (row.lowContrast) {
                              <span class="layer__warning"><app-icon name="alert" /> Low contrast</span>
                            }
                            @if (row.missingAlt) {
                              <span class="layer__warning"><app-icon name="alert" /> Needs alt text</span>
                            }
                            @if (row.longVideo) {
                              <span class="layer__warning"><app-icon name="alert" /> Longer than 15 s</span>
                            }
                          </span>
                        </div>
                        <div role="gridcell">
                          <button
                            type="button"
                            class="btn btn--ghost layer__toggle"
                            [id]="'layer-hide-' + row.el.id"
                            [attr.tabindex]="tabIndex(row.el.id, 1)"
                            [attr.aria-label]="'Hide ' + row.name"
                            [attr.aria-pressed]="row.el.hidden"
                            aria-keyshortcuts="H"
                            (click)="run('hide', 'list', 'layer-hide-' + row.el.id, row.el.id)"
                            (focus)="activate(row.el.id, 1)"
                            (keydown)="onCellKey($event, row.el, 1)"
                            (contextmenu)="openMenuAt($event, row.el, 'list')"
                          >
                            <app-icon [name]="row.el.hidden ? 'eye-off' : 'eye'" />
                          </button>
                        </div>
                        <div role="gridcell">
                          <button
                            type="button"
                            class="btn btn--ghost layer__toggle"
                            [id]="'layer-lock-' + row.el.id"
                            [attr.tabindex]="tabIndex(row.el.id, 2)"
                            [attr.aria-label]="'Lock ' + row.name"
                            [attr.aria-pressed]="row.el.locked"
                            aria-keyshortcuts="L"
                            (click)="run('lock', 'list', 'layer-lock-' + row.el.id, row.el.id)"
                            (focus)="activate(row.el.id, 2)"
                            (keydown)="onCellKey($event, row.el, 2)"
                            (contextmenu)="openMenuAt($event, row.el, 'list')"
                          >
                            <app-icon [name]="row.el.locked ? 'lock' : 'unlock'" />
                          </button>
                        </div>
                        <div role="gridcell">
                          <button
                            type="button"
                            class="btn btn--ghost layer__toggle"
                            [id]="'layer-more-' + row.el.id"
                            [attr.tabindex]="tabIndex(row.el.id, 3)"
                            [attr.aria-label]="'More actions for ' + row.name"
                            aria-haspopup="menu"
                            [attr.aria-expanded]="menu()?.returnId === 'layer-more-' + row.el.id"
                            (click)="openMenuFrom($any($event.currentTarget), row.el)"
                            (focus)="activate(row.el.id, 3)"
                            (keydown)="onCellKey($event, row.el, 3)"
                            (contextmenu)="openMenuAt($event, row.el, 'list')"
                          >
                            <app-icon name="more" />
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </section>
              @if (selected(); as el) {
                <fieldset class="field selected">
                  <legend class="field__label">Selected {{ kind(el).toLowerCase() }}</legend>
                  @if (el.locked) {
                    <p class="field__hint">{{ lockedHint }}</p>
                  }
                  @if (el.type === 'text') {
                    <div class="field">
                      <label class="field__label" for="studio-text">Text</label>
                      <textarea
                        id="studio-text"
                        class="input"
                        aria-describedby="studio-text-hint"
                        [readOnly]="el.locked"
                        [attr.aria-invalid]="invalidId() === el.id ? 'true' : null"
                        [value]="el.props.text"
                        (input)="typeText(el.id, $any($event.target))"
                        (blur)="sealHistory()"
                      ></textarea>
                      <span class="field__hint" id="studio-text-hint">
                        {{ textNotice() || 'Up to ' + maxText.toLocaleString('en') + ' characters.' }}
                      </span>
                    </div>
                  }
                  <div class="row">
                    <div class="field">
                      <label class="field__label" for="studio-x">Left (%)</label>
                      <input
                        id="studio-x"
                        class="input"
                        type="number"
                        min="0"
                        [attr.max]="maxPercent(el.box.w)"
                        step="1"
                        [readOnly]="el.locked"
                        [value]="percent(el.box.x)"
                        (change)="setPosition(el.id, 'x', $any($event.target))"
                      />
                    </div>
                    <div class="field">
                      <label class="field__label" for="studio-y">Top (%)</label>
                      <input
                        id="studio-y"
                        class="input"
                        type="number"
                        min="0"
                        [attr.max]="maxPercent(el.box.h)"
                        step="1"
                        [readOnly]="el.locked"
                        [value]="percent(el.box.y)"
                        (change)="setPosition(el.id, 'y', $any($event.target))"
                      />
                    </div>
                  </div>
                  <div class="row">
                    <div class="field">
                      <label class="field__label" for="studio-w">Width (%)</label>
                      <input
                        id="studio-w"
                        class="input"
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        [readOnly]="el.locked"
                        [value]="percent(el.box.w)"
                        (change)="setSize(el.id, 'w', $any($event.target))"
                      />
                    </div>
                    <div class="field">
                      <label class="field__label" for="studio-h">Height (%)</label>
                      <input
                        id="studio-h"
                        class="input"
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        [readOnly]="el.locked"
                        [value]="percent(el.box.h)"
                        (change)="setSize(el.id, 'h', $any($event.target))"
                      />
                    </div>
                    <div class="field">
                      <label class="field__label" for="studio-rotation">Rotation (°)</label>
                      <input
                        id="studio-rotation"
                        class="input"
                        type="number"
                        min="-180"
                        max="180"
                        step="1"
                        [readOnly]="el.locked"
                        [value]="el.box.rotation"
                        (change)="setRotation(el.id, $any($event.target))"
                      />
                    </div>
                  </div>
                  @if (el.type === 'shape') {
                    <app-tale-shape-style
                      [element]="el"
                      [locked]="el.locked"
                      (changed)="restyleElement(el.id, $event)"
                      (notice)="say($event)"
                    />
                  } @else if (el.type === 'emoji') {
                    <app-tale-emoji-style
                      [element]="el"
                      [locked]="el.locked"
                      [lockedHint]="lockedHint"
                      (changed)="restyleElement(el.id, $event)"
                      (notice)="say($event)"
                      (replace)="openEmojiPicker(el.id)"
                    />
                  } @else if (el.type !== 'text') {
                    <app-tale-media-style
                      [element]="el"
                      [videoSeconds]="
                        el.type === 'video' && el !== stageMedia()
                          ? (videoSeconds().get(el.props.mediaKey) ?? null)
                          : null
                      "
                      [locked]="el.locked"
                      [lockedHint]="lockedHint"
                      (changed)="restyleElement(el.id, $event)"
                      (notice)="say($event)"
                      (replace)="
                        openPicker('replace', el.type === 'video' ? 'video' : 'image', el.id, el.type === 'sticker')
                      "
                    />
                    @if (isTaleMedia(el)) {
                      <p class="field__hint" id="studio-tale-media-hint">
                        @if (el === stageMedia()) {
                          This is the tale's media: it fills the stage and plays as before{{
                            el.type === 'video' ? ', with sound and for its whole length' : ''
                          }}. Moving, resizing, rotating, rounding or fading it makes it a layer like any other{{
                            el.type === 'video' ? ' (muted, at most 15 seconds)' : ''
                          }}.
                        } @else {
                          This is the tale's media, now a layer like any other. At the bottom, filling the canvas, it
                          plays as the tale's media again.
                        }
                      </p>
                    }
                  } @else {
                    <app-tale-text-style
                      [elementId]="el.id"
                      [props]="el.props"
                      [locked]="el.locked"
                      [themeFont]="themeFont()"
                      [backdrop]="selectedBackdrop()"
                      [projectFonts]="projectFonts()"
                      [projectId]="projectId() ?? null"
                      (changed)="restyle(el.id, $event)"
                      (notice)="say($event)"
                    />
                  }
                  <div class="row">
                    <button type="button" class="btn btn--ghost btn--sm" (click)="remove(el.id)">
                      Delete {{ kind(el).toLowerCase() }}
                    </button>
                  </div>
                </fieldset>
              } @else if (selection().length > 1) {
                <fieldset class="field selected">
                  <legend class="field__label">{{ selection().length }} layers selected</legend>
                  <p class="field__hint">
                    Move them together with the arrow keys or by dragging one of them; reorder them from the layers
                    list.
                  </p>
                  <div class="row">
                    <button type="button" class="btn btn--ghost btn--sm" (click)="run('delete', 'list', 'studio-add')">
                      Delete {{ selection().length }} layers
                    </button>
                  </div>
                </fieldset>
              }
              <fieldset class="field selected">
                <legend class="field__label">Canvas</legend>
                <div class="row">
                  <div class="field">
                    <label class="field__label" for="studio-bg">Background colour</label>
                    <input
                      id="studio-bg"
                      class="input"
                      type="color"
                      aria-describedby="studio-bg-hint"
                      [value]="d.canvas.background.color.slice(0, 7).toLowerCase()"
                      (change)="setBackground($any($event.target).value)"
                    />
                  </div>
                  <div class="field">
                    <label class="field__label" for="studio-bg-hex">Hex value</label>
                    <input
                      id="studio-bg-hex"
                      class="input input--mono"
                      type="text"
                      spellcheck="false"
                      autocomplete="off"
                      [attr.aria-describedby]="hexError() ? 'studio-bg-hint studio-bg-error' : 'studio-bg-hint'"
                      [attr.aria-invalid]="hexError() ? 'true' : null"
                      [value]="d.canvas.background.color"
                      (change)="setBackgroundHex($any($event.target))"
                    />
                  </div>
                </div>
                <span class="field__hint" id="studio-bg-hint">
                  @if (d.canvas.background.type === 'media') {
                    As #RRGGBB, or #RRGGBBAA with transparency. It fills the bands the background image leaves, and
                    shows until the image does.
                  } @else {
                    As #RRGGBB, or #RRGGBBAA with transparency. It fills the canvas behind the tale's media.
                  }
                </span>
                @if (hexError()) {
                  <span class="field__error" id="studio-bg-error">{{ hexError() }}</span>
                }
                <div class="row">
                  <button
                    type="button"
                    class="btn btn--secondary btn--sm"
                    id="studio-bg-media"
                    [disabled]="!projectId()"
                    (click)="openPicker('background', 'image')"
                  >
                    @if (d.canvas.background.type === 'media') {
                      Choose another background image…
                    } @else {
                      Background image…
                    }
                  </button>
                  @if (d.canvas.background.type === 'media') {
                    <button
                      type="button"
                      class="btn btn--ghost btn--sm"
                      id="studio-bg-media-remove"
                      (click)="removeBackgroundMedia()"
                    >
                      Remove background image
                    </button>
                  }
                </div>
                @if (d.canvas.background.type === 'media') {
                  <div class="field">
                    <label class="field__label" for="studio-bg-fit">Background image fit</label>
                    <select id="studio-bg-fit" class="input" (change)="setBackgroundFit($any($event.target).value)">
                      @for (fit of fits; track fit) {
                        <option [value]="fit" [selected]="fit === d.canvas.background.fit">{{ fitNames[fit] }}</option>
                      }
                    </select>
                  </div>
                }
                <div class="field">
                  <label class="field__label" for="studio-duration">Duration (seconds)</label>
                  <input
                    id="studio-duration"
                    class="input"
                    type="number"
                    [min]="minDuration"
                    [max]="maxDuration"
                    step="0.5"
                    aria-describedby="studio-duration-hint"
                    [readOnly]="hasVideo()"
                    [value]="durationSeconds()"
                    (change)="setDuration($any($event.target))"
                  />
                  <span class="field__hint" id="studio-duration-hint">
                    @if (hasVideo()) {
                      The tale plays for its video's length.
                    } @else {
                      How long the tale shows, from {{ minDuration }} to {{ maxDuration }} seconds.
                    }
                  </span>
                </div>
                <label class="checkbox">
                  <input type="checkbox" [checked]="guides()" (change)="showGuides($any($event.target).checked)" />
                  Show safe areas
                </label>
              </fieldset>
            </div>
          </div>
          <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>
          @if (picker(); as p) {
            @if (projectId(); as projectId) {
              <app-tale-media-picker
                [projectId]="projectId"
                [kind]="p.kind"
                [heading]="p.heading"
                [stickers]="p.sticker"
                [currentKey]="p.currentKey"
                [returnFocus]="p.returnFocus"
                (chosen)="pickedMedia($event)"
                (closed)="closePicker()"
              />
            }
          }
          @if (emojiPicker(); as e) {
            <app-tale-emoji-picker
              [heading]="e.heading"
              [current]="e.current"
              [returnFocus]="e.returnFocus"
              (chosen)="pickedEmoji($event)"
              (closed)="emojiPicker.set(null)"
            />
          }
          @if (menu(); as m) {
            <app-tale-layer-menu
              [items]="m.items"
              [x]="m.x"
              [y]="m.y"
              [anchorId]="m.returnId"
              (chosen)="menuChosen($event)"
              (closed)="closeMenu($event)"
            />
          }
        </section>
      } @else if (error()) {
        <p class="form-error" role="alert">{{ error() }}</p>
      } @else {
        <p class="muted">Loading the tale…</p>
      }
    </div>
  `,
})
export class TaleStudioPage implements OnChanges {
  protected readonly store = inject(DashboardStore);
  private readonly documents = inject(TaleDocumentService);
  private readonly router = inject(Router);
  /** The tale being edited, bound from the route's `:taleId`. */
  readonly taleId = input.required<string>();

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
  protected readonly shapeKinds = SHAPE_KINDS;
  protected readonly shapeNames = SHAPE_NAMES;
  protected readonly emojiFont = EMOJI_FONT_STACK;
  /** True when the tale holds its one video: it then plays for the video's length (R5). */
  protected readonly hasVideo = computed(() => hasVideoElement(this.doc()));
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
  /** The one selected layer's id, or null when none or several are selected. */
  protected readonly selectedId = computed(() => (this.selection().length === 1 ? this.selection()[0] : null));
  protected readonly selected = computed(() => this.doc()?.elements.find((e) => e.id === this.selectedId()) ?? null);
  private readonly selectedSet = computed(() => new Set(this.selection()));
  /** The layers list: top of the z-order first, each with its name and whether it reaches outside the safe area. */
  protected readonly layerRows = computed(() =>
    (this.doc()?.elements ?? [])
      .map((el, i, elements) => ({
        el,
        name: layerName(el, this.doc()?.elements ?? [el]),
        // The tale's own media, drawn full-bleed as before (R16), fills the canvas by design.
        outside: el !== this.stageMedia() && isOutsideSafeArea(el.box),
        lowContrast:
          el.type === 'text' &&
          textContrast(resolveTextStyle(el.props), textBackdropAt(elements, i, this.backdrop())).kind === 'low',
        // An image, video or sticker without alt text or the decorative mark keeps the tale from being updated (R12).
        missingAlt: isMediaElement({ type: el.type }) && !el.hidden && !hasAltText(el),
        // A video over 15 s plays only its first 15 s (R5); the tale's own media video plays in full (R16).
        longVideo:
          el.type === 'video' &&
          el !== this.stageMedia() &&
          (this.videoSeconds().get(el.props.mediaKey) ?? 0) > MAX_TALE_VIDEO_MS / 1000,
      }))
      .reverse(),
  );
  /** The zone page the tale was opened from, or the zones list. */
  protected readonly backLink = computed(() => {
    const id = this.taleId();
    const zone = Object.entries(this.store.taleGroups()).find(([, groups]) =>
      groups.some((g) => g.tales.some((t) => t.id === id)),
    );
    return zone ? ['/zones', zone[0]] : ['/zones'];
  });

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

  constructor() {
    inject(DestroyRef).onDestroy(() => {
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
  // page stays and its tale changes): start over with that tale's document.
  ngOnChanges(): void {
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
            element && /\/a11y\/label$/.test(result.pointer)
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
    const opened = await this.router.navigate(['/tales', tale.id, 'studio']).catch(() => false);
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

  protected kind(element: { type: TaleElement['type'] }): string {
    return kindName(element);
  }

  /** What lies behind the text with this id: the canvas, or a shape or media below it (R6, R12). */
  protected backdropOf(id: string): TextBackdrop {
    const elements = this.doc()?.elements ?? [];
    return textBackdropAt(
      elements,
      elements.findIndex((e) => e.id === id),
      this.backdrop(),
    );
  }

  /** How the canvas draws a shape, kept per props object. */
  protected shape(element: ShapeElement): ShapeView {
    const kept = this.shapes.get(element.props);
    if (kept) return kept;
    const view = shapeView(element.props);
    this.shapes.set(element.props, view);
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

  protected percent(value: number): number {
    return Math.round(value * 1000) / 10;
  }

  protected maxPercent(size: number): number {
    return this.percent(1 - size);
  }

  /**
   * Opens the Duplicate drawer (epic Tale Studio R11). The copy is made from what is saved, so the
   * latest changes are saved first; while they cannot be, nothing opens and the reason is shown.
   */
  protected async openDuplicate(event: Event): Promise<void> {
    const opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (this.updating() || this.duplicating() || !this.tale()) return;
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
    const said = note ? `${text} ${note}`.trim() : text;
    // Cleared first, so the same message twice is announced twice.
    this.announcement.set('');
    setTimeout(() => this.announcement.set(said), 0);
  }

  /** The ids of the texts of `doc` with low contrast against what lies behind each (R12). */
  private lowContrastIds(doc: TaleDocument): Set<string> {
    const base: TextBackdrop = {
      canvasColor: doc.canvas.background.color,
      // The tale's own media (R16) is an element, which `textBackdropAt` meets on its way down.
      overMedia: doc.canvas.background.type === 'media',
    };
    const low = new Set<string>();
    doc.elements.forEach((e, i) => {
      if (e.type !== 'text' || e.hidden) return;
      if (textContrast(resolveTextStyle(e.props), textBackdropAt(doc.elements, i, base)).kind === 'low') low.add(e.id);
    });
    return low;
  }

  // What a change did to the contrast of texts other than the one being restyled (which says it
  // itself): a move, reorder, hide or restyle of another layer can turn a text's verdict (R12).
  private contrastChange(before: TaleDocument, next: TaleDocument): string {
    const was = this.lowContrastIds(before);
    const now = this.lowContrastIds(next);
    const notes: string[] = [];
    next.elements.forEach((e, i) => {
      if (e.type !== 'text' || e.id === this.restylingId || was.has(e.id) === now.has(e.id)) return;
      if (!now.has(e.id) && !before.elements.some((b) => b.id === e.id)) return;
      const name = elementName(next.elements, i);
      notes.push(now.has(e.id) ? `"${name}" now has low contrast.` : `"${name}" has enough contrast now.`);
    });
    return notes.join(' ');
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
    const before = this.doc();
    if (!before || next === before || JSON.stringify(next) === JSON.stringify(before)) return false;
    if (this.held()) {
      // The change does not go through; the canvas shows the document as it is.
      this.doc.set({ ...before });
      this.say(this.held());
      return false;
    }
    this.history.record(label, before, next, mergeKey);
    this.contrastNote = [this.contrastChange(before, next), this.stageMediaChange(before, next)]
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
    if (event.key !== ' ' || !(event.shiftKey || event.ctrlKey || event.metaKey)) return false;
    event.preventDefault();
    this.keyToggled = true;
    this.toggleSelected(id);
    return true;
  }

  protected onKey(event: KeyboardEvent, element: TaleElement): void {
    if (this.shortcut(event, element, 'canvas') || this.selectionKey(event, element.id)) return;
    const step = event.shiftKey ? MOVE_STEP * 10 : MOVE_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move && !event.altKey && !event.ctrlKey && !event.metaKey) {
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
    if (this.shortcut(event, element, 'list')) return;
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
    const movable = selected.filter((e) => !e.locked);
    if (movable.length === 0) {
      this.say(selected.length ? LOCKED : 'Hidden layers do not move. Show them first.');
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
    const moving = (this.doc()?.elements ?? []).filter((e) => this.isSelected(e.id) && !e.locked && !e.hidden);
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
      this.say(LOCKED);
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
        : sticker
          ? purpose === 'replace'
            ? 'Choose another sticker image'
            : 'Add an image sticker'
          : purpose === 'replace'
            ? `Choose another ${kind}`
            : `Add ${kind === 'image' ? 'an image' : 'a video'}`;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.picker.set({ purpose, kind, sticker, heading, elementId, currentKey, returnFocus });
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
    this.addMedia(media, open.sticker);
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
      if (element) {
        this.invalidId.set(element.id);
        this.selectOnly(element.id);
        if (element.type !== 'text') {
          const kind = kindName(element).toLowerCase();
          return `This ${kind} could not be saved: ${result.message}. It is selected on the canvas.`;
        }
        return 'A text could not be saved: it is too long or holds something a text cannot. It is selected on the canvas.';
      }
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
