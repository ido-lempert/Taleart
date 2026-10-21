import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  cleanText,
  ELEMENT_TEXT_RULE,
  emptyTaleDocument,
  ErrorCodes,
  elementBounds,
  isOutsideSafeArea,
  MAX_TALE_ELEMENTS,
  MAX_TEXT_LENGTH,
  NEW_TEXT_BOX,
  TALE_SAFE_AREA,
  TEXT_ELEMENT_STYLE,
  type TaleDocument,
  type TaleElement,
  type TaleElementBox,
} from '@taleart/contract';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { TaleDocumentService } from '../tale-document.service';
import { TaleLayerMenu, type LayerMenuItem } from './tale-layer-menu';
import {
  boundsOf,
  clamp,
  clampMove,
  duplicateElement,
  isApple,
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
  type LayerCommand,
  type ReorderCommand,
  type SnapTargets,
} from './tale-layers';

/** How far an arrow key moves an element, as a fraction of the canvas; Shift moves ten times as far. */
export const MOVE_STEP = 0.01;

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

/**
 * Tale Studio (epic Tale Studio stories 1 and 2): a tale on a 9:16 canvas with its media over the
 * canvas colour, where a content manager adds text elements, types their text in place, moves
 * them by dragging (snapping to the centre, the safe-area edges and other elements), by the arrow
 * keys (Shift for larger steps) or by position fields, arranges them in a layers list (select,
 * reorder, hide, lock, duplicate, delete, from the row, an actions menu or the keyboard), sets
 * the background colour and shows the safe areas, and saves the tale document (AD-15). A save
 * based on an older revision is refused by the API, and the page offers to reload the latest
 * version.
 */
@Component({
  selector: 'app-tale-studio-page',
  imports: [RouterLink, Icon, TaleLayerMenu],
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
      cursor: move;
      touch-action: none;
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
              @if (tale(); as t) {
                @if (t.media?.kind === 'video') {
                  <video
                    class="canvas__media"
                    [src]="store.mediaSrc(t)"
                    muted
                    playsinline
                    preload="metadata"
                    aria-hidden="true"
                  ></video>
                } @else if (t.media) {
                  <img class="canvas__media" [src]="store.mediaSrc(t)" alt="" />
                }
              }
              @for (el of d.elements; track el.id; let i = $index) {
                @if (el.hidden) {
                  <!-- A hidden layer is not drawn; it stays in the layers list. -->
                } @else if (editingId() === el.id) {
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
                    [style.font-size]="fontSize"
                    [style.line-height]="textStyle.lineHeight"
                    [style.font-weight]="textStyle.fontWeight"
                    [style.color]="textStyle.color"
                    [style.font-family]="textStyle.fontFamily"
                    [value]="el.props.text"
                    (input)="typeText(el.id, $any($event.target))"
                    (blur)="stopEditing()"
                    (keydown.escape)="stopEditing(true)"
                  ></textarea>
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
                    [textContent]="el.props.text"
                    [style.left.%]="el.box.x * 100"
                    [style.top.%]="el.box.y * 100"
                    [style.width.%]="el.box.w * 100"
                    [style.height.%]="el.box.h * 100"
                    [style.transform]="el.box.rotation ? 'rotate(' + el.box.rotation + 'deg)' : null"
                    [style.z-index]="i + 1"
                    [style.font-size]="fontSize"
                    [style.line-height]="textStyle.lineHeight"
                    [style.font-weight]="textStyle.fontWeight"
                    [style.color]="textStyle.color"
                    [style.font-family]="textStyle.fontFamily"
                    (click)="pick($event, el.id)"
                    (dblclick)="edit(el.id)"
                    (contextmenu)="openMenuAt($event, el, 'canvas')"
                    (keydown)="onKey($event, el)"
                    (pointerdown)="dragStart($event, el)"
                    (pointermove)="dragMove($event)"
                    (pointerup)="dragEnd($event)"
                    (pointercancel)="dragEnd($event)"
                  ></button>
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
              </div>
              <p class="field__hint" id="studio-keys">
                Select a text to move it with the arrow keys (Shift for larger steps). Enter edits its text, Escape
                stops editing. Dragging snaps to the centre, the safe areas and other layers; hold Alt to place freely.
                On the canvas and in the layers list: {{ keys.forward }} and {{ keys.backward }} reorder,
                {{ keys.front }} and {{ keys.back }} bring to the front or the back, H hides, L locks, D duplicates,
                {{ keys.delete }} deletes, {{ keys['select-all'] }} selects all, and the context-menu key or Shift+F10
                opens the actions.
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
                            <app-icon name="text" />
                            <span class="visually-hidden">Text: </span>
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
                  <legend class="field__label">Selected text</legend>
                  @if (el.locked) {
                    <p class="field__hint">{{ lockedHint }}</p>
                  }
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
                    ></textarea>
                    <span class="field__hint" id="studio-text-hint">
                      {{ textNotice() || 'Up to ' + maxText.toLocaleString('en') + ' characters.' }}
                    </span>
                  </div>
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
                    <button type="button" class="btn btn--ghost btn--sm" (click)="remove(el.id)">Delete text</button>
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
                  As #RRGGBB, or #RRGGBBAA with transparency. It fills the canvas behind the tale's media.
                </span>
                @if (hexError()) {
                  <span class="field__error" id="studio-bg-error">{{ hexError() }}</span>
                }
                <label class="checkbox">
                  <input type="checkbox" [checked]="guides()" (change)="showGuides($any($event.target).checked)" />
                  Show safe areas
                </label>
              </fieldset>
              @if (error()) {
                <div class="form-error" role="alert">
                  <p>{{ error() }}</p>
                  @if (stale()) {
                    <button type="button" class="btn btn--secondary btn--sm" (click)="reload()">
                      Reload latest version
                    </button>
                  }
                </div>
              }
              <div class="row">
                <button type="button" class="btn btn--primary" [disabled]="saving()" (click)="save()">Save</button>
              </div>
              <p class="muted" role="status">{{ saveStatus() }}</p>
            </div>
          </div>
          <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>
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
export class TaleStudioPage implements OnInit {
  protected readonly store = inject(DashboardStore);
  private readonly documents = inject(TaleDocumentService);
  /** The tale being edited, bound from the route's `:taleId`. */
  readonly taleId = input.required<string>();

  /** The document being edited; null until read. */
  protected readonly doc = signal<TaleDocument | null>(null);
  /** The revision the document on screen is based on. */
  private readonly revision = signal(0);
  /** The ids of the selected layers, in the order they were selected. */
  protected readonly selection = signal<readonly string[]>([]);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  /** True when the last save was refused because another save came first (409). */
  protected readonly stale = signal(false);
  protected readonly saveStatus = signal('');
  protected readonly announcement = signal('');
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
  protected readonly maxText = MAX_TEXT_LENGTH;
  protected readonly textStyle = TEXT_ELEMENT_STYLE;
  protected readonly fontSize = `${TEXT_ELEMENT_STYLE.fontSize * 100}cqh`;
  protected readonly safeArea = TALE_SAFE_AREA;
  private readonly apple = isApple();
  /** Each layer shortcut as people read it on this platform. */
  protected readonly keys = Object.fromEntries(
    (['forward', 'backward', 'front', 'back', 'hide', 'lock', 'duplicate', 'delete', 'select-all'] as const).map(
      (command) => [command, shortcutLabel(command, this.apple)],
    ),
  ) as Record<LayerCommand, string>;
  protected readonly keyShortcuts = LAYER_KEYSHORTCUTS;
  protected readonly multiHint = this.apple
    ? 'Shift+click, ⌘+click, or Shift+Space'
    : 'Shift+click, Ctrl+click, or Shift+Space';
  /** Why the hex field's value was refused, shown under it; empty when it was not. */
  protected readonly hexError = signal('');
  /** The layers list's one tab stop (roving tabindex): a layer and its column. */
  private readonly active = signal<{ id: string; col: number } | null>(null);
  protected readonly lockedHint = LOCKED;

  protected readonly tale = computed(() => this.store.tale(this.taleId()));
  /** The one selected layer's id, or null when none or several are selected. */
  protected readonly selectedId = computed(() => (this.selection().length === 1 ? this.selection()[0] : null));
  protected readonly selected = computed(() => this.doc()?.elements.find((e) => e.id === this.selectedId()) ?? null);
  private readonly selectedSet = computed(() => new Set(this.selection()));
  /** The layers list: top of the z-order first, each with its name and whether it reaches outside the safe area. */
  protected readonly layerRows = computed(() =>
    (this.doc()?.elements ?? [])
      .map((el) => ({ el, name: layerName(el), outside: isOutsideSafeArea(el.box) }))
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

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.documents.load(this.taleId());
    if (result.value === null) {
      this.error.set(result.message);
      return;
    }
    this.doc.set(result.value.document ?? emptyTaleDocument());
    this.revision.set(result.value.revision);
    this.error.set('');
    this.stale.set(false);
  }

  protected name(element: TaleElement): string {
    return layerName(element);
  }

  protected percent(value: number): number {
    return Math.round(value * 1000) / 10;
  }

  protected maxPercent(size: number): number {
    return this.percent(1 - size);
  }

  private say(text: string): void {
    // Cleared first, so the same message twice is announced twice.
    this.announcement.set('');
    setTimeout(() => this.announcement.set(text), 0);
  }

  private element(id: string): TaleElement | undefined {
    return this.doc()?.elements.find((e) => e.id === id);
  }

  private change(update: (elements: TaleElement[]) => readonly TaleElement[]): void {
    const doc = this.doc();
    if (!doc) return;
    const elements = update(doc.elements);
    if (elements === doc.elements) return;
    this.doc.set({ ...doc, elements: [...elements] });
    this.saveStatus.set('Unsaved changes');
  }

  private setBox(id: string, box: Partial<TaleElementBox>): void {
    this.change((elements) =>
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

  protected addText(): void {
    const element: TaleElement = {
      id: crypto.randomUUID(),
      type: 'text',
      box: { ...NEW_TEXT_BOX },
      hidden: false,
      locked: false,
      a11y: {},
      props: { text: 'Text' },
    };
    this.change((elements) => [...elements, element]);
    this.selectOnly(element.id);
    this.say('Text added');
    this.edit(element.id);
  }

  /** Types in place: the element becomes a text field at its place on the canvas. A locked one is not edited. */
  protected edit(id: string): void {
    this.selectOnly(id);
    const element = this.element(id);
    if (!element || element.hidden) return;
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
    if (refocus) this.focusSoon(`studio-el-${id}`);
  }

  /**
   * Takes what was typed or pasted into a text field: characters text may not hold are removed
   * (line feeds stay), and text past the limit, counted in characters as the server counts them,
   * is cut. The field shows what was kept, and the notice says why. A locked layer keeps its text.
   */
  protected typeText(id: string, field: HTMLTextAreaElement): void {
    const element = this.element(id);
    if (!element) return;
    if (element.locked) {
      field.value = element.props.text;
      this.say(LOCKED);
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
    this.change((elements) => elements.map((e) => (e.id === id ? { ...e, props: { ...e.props, text } } : e)));
  }

  /** Applies a position field and writes back the value applied, which keeps the box on the canvas. */
  protected setPosition(id: string, axis: 'x' | 'y', field: HTMLInputElement): void {
    const element = this.element(id);
    if (!element) return;
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
        ? `Text moved to ${name} ${applied}%`
        : `Text moved to ${name} ${applied}%, as far as it goes`,
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
    this.change((list) => list.filter((e) => !gone.has(e.id)));
    this.selectOnly(next?.id ?? null);
    if (this.editingId() !== null && gone.has(this.editingId() as string)) this.editingId.set(null);
    if (this.invalidId() !== null && gone.has(this.invalidId() as string)) this.invalidId.set(null);
    const prefix = origin === 'canvas' ? 'studio-el-' : 'layer-';
    this.focusSoon(next ? `${prefix}${next.id}` : origin === 'canvas' ? 'studio-canvas' : 'studio-add');
    this.say(indexes.length === 1 ? 'Text deleted' : `${indexes.length} layers deleted`);
  }

  /**
   * Runs a layer command on the selection (reorder, delete, select all) or on one layer (`target`,
   * else the one selected: hide, lock, duplicate), announces it, and returns focus to `returnId`,
   * the control that asked, which the list may have moved.
   */
  protected run(command: LayerCommand, origin: Origin, returnId: string, target?: string): void {
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
          this.change(() => next);
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
        this.change((elements) => elements.map((e) => (e.id === element.id ? { ...e, [field]: on } : e)));
        if (on && this.editingId() === element.id) this.editingId.set(null);
        this.say(`Layer ${command === 'hide' ? (on ? 'hidden' : 'shown') : on ? 'locked' : 'unlocked'}`);
        // A hidden layer leaves the canvas, so focus goes to its row.
        if (on && command === 'hide' && origin === 'canvas') returnId = `layer-${element.id}`;
        break;
      }
      case 'duplicate': {
        const element = one === null ? undefined : this.element(one);
        if (!element) return;
        if (doc.elements.length >= MAX_TALE_ELEMENTS) {
          this.say(`A tale holds at most ${MAX_TALE_ELEMENTS} layers`);
          break;
        }
        const copy = duplicateElement(element, crypto.randomUUID());
        this.change((elements) => {
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
      this.moveSelection(move[0], move[1]);
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
  private moveSelection(dx: number, dy: number): void {
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
    this.change((elements) =>
      elements.map((e) => (ids.has(e.id) ? { ...e, box: moveBox(e.box, step.dx, step.dy) } : e)),
    );
    const locked = selected.length - movable.length;
    const stay = locked ? `; ${locked === 1 ? 'a locked layer stays' : `${locked} locked layers stay`}` : '';
    if (movable.length === 1) {
      const moved = this.element(movable[0].id);
      if (moved) this.say(`Text moved to left ${this.percent(moved.box.x)}%, top ${this.percent(moved.box.y)}%${stay}`);
    } else this.say(`${movable.length} layers moved${stay}`);
  }

  protected dragStart(event: PointerEvent, element: TaleElement): void {
    this.dragged = false;
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
    const canvas = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
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
    this.change((elements) =>
      elements.map((e) => {
        const origin = drag.boxes.get(e.id);
        return origin ? { ...e, box: moveBox(origin, step.dx, step.dy) } : e;
      }),
    );
  }

  protected dragEnd(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.snapLines.set(null);
    if (!drag.moved) return;
    this.dragged = true;
    // A click may not follow (the pointer was released elsewhere); it is only ignored straight after.
    setTimeout(() => (this.dragged = false), 0);
    const locked = [...this.selectedSet()].filter((id) => {
      const e = this.element(id);
      return e?.locked && !e.hidden;
    }).length;
    const stay = locked ? `; ${locked === 1 ? 'a locked layer stays' : `${locked} locked layers stay`}` : '';
    this.say(drag.boxes.size === 1 ? `Text moved${stay}` : `${drag.boxes.size} layers moved${stay}`);
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
    this.hexError.set('');
    const doc = this.doc();
    if (!doc || doc.canvas.background.color === color) return;
    this.doc.set({ ...doc, canvas: { ...doc.canvas, background: { type: 'color', color } } });
    this.saveStatus.set('Unsaved changes');
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

  protected showGuides(on: boolean): void {
    this.guides.set(on);
    this.say(on ? 'Safe areas shown' : 'Safe areas hidden');
  }

  protected async save(): Promise<void> {
    const doc = this.doc();
    if (!doc || this.saving()) return;
    this.saving.set(true);
    this.saveStatus.set('Saving…');
    const result = await this.documents.save(this.taleId(), doc, this.revision());
    this.saving.set(false);
    if (result.value === null) {
      this.error.set(this.refusal(result));
      this.stale.set(result.stale);
      this.saveStatus.set('Not saved');
      return;
    }
    this.invalidId.set(null);
    this.revision.set(result.value.revision);
    // Edits made while the save was on its way stay unsaved.
    this.saveStatus.set(this.doc() === doc ? 'Saved' : 'Unsaved changes');
    this.error.set('');
    this.stale.set(false);
  }

  // A refusal in words a person can act on. A refused element, named by the pointer, is selected and marked.
  private refusal(result: { message: string; stale: boolean; code: string; pointer: string }): string {
    if (result.stale) {
      return 'Someone saved this tale after you opened it. Reload the latest version; your changes here are not saved.';
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
        return 'A text could not be saved: it is too long or holds something a text cannot. It is selected on the canvas.';
      }
      return 'The tale could not be saved because something in it is not valid. Reload the page and try again.';
    }
    return result.message;
  }

  protected async reload(): Promise<void> {
    this.selectOnly(null);
    this.editingId.set(null);
    this.menu.set(null);
    await this.load();
    if (!this.error()) {
      this.saveStatus.set('');
      this.say('Latest version loaded');
    }
  }
}
