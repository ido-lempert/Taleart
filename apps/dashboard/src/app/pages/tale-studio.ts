import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  emptyTaleDocument,
  MAX_TALE_ELEMENTS,
  MAX_TEXT_LENGTH,
  NEW_TEXT_BOX,
  TEXT_ELEMENT_STYLE,
  type TaleDocument,
  type TaleElement,
  type TaleElementBox,
} from '@taleart/contract';
import { DashboardStore } from '../dashboard.store';
import { Icon } from '../icon';
import { TaleDocumentService } from '../tale-document.service';

/** How far an arrow key moves an element, as a fraction of the canvas; Shift moves ten times as far. */
export const MOVE_STEP = 0.01;

// Box values are kept to 4 decimals, so moves do not pile up floating-point noise.
const round = (value: number): number => Math.round(value * 10000) / 10000;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// A short name for an element, from its text.
function nameOf(element: TaleElement): string {
  const text = element.props.text.trim().replace(/\s+/g, ' ');
  return text ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : 'Empty text';
}

interface Drag {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  box: TaleElementBox;
  width: number;
  height: number;
  moved: boolean;
}

/**
 * Tale Studio, first slice (epic Tale Studio story 1): a tale on a 9:16 canvas with its media as
 * a read-only background, where a content manager adds text elements, types their text in place,
 * moves them by dragging, by the arrow keys (Shift for larger steps) or by position fields, and
 * saves the tale document (AD-15). A save based on an older revision is refused by the API, and
 * the page offers to reload the latest version.
 */
@Component({
  selector: 'app-tale-studio-page',
  imports: [RouterLink, Icon],
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
      border: 1px dashed rgb(255 255 255 / 60%);
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
                @if (editingId() === el.id) {
                  <textarea
                    class="el-edit"
                    [id]="'studio-edit-' + el.id"
                    aria-label="Text"
                    [attr.maxlength]="maxText"
                    [style.left.%]="el.box.x * 100"
                    [style.top.%]="el.box.y * 100"
                    [style.width.%]="el.box.w * 100"
                    [style.height.%]="el.box.h * 100"
                    [style.z-index]="i + 1"
                    [style.font-size]="fontSize"
                    [style.line-height]="textStyle.lineHeight"
                    [style.font-weight]="textStyle.fontWeight"
                    [style.color]="textStyle.color"
                    [style.font-family]="textStyle.fontFamily"
                    [value]="el.props.text"
                    (input)="setText(el.id, $any($event.target).value)"
                    (blur)="stopEditing()"
                    (keydown.escape)="stopEditing(true)"
                  ></textarea>
                } @else {
                  <button
                    type="button"
                    class="el"
                    [id]="'studio-el-' + el.id"
                    [class.is-selected]="selectedId() === el.id"
                    [attr.aria-pressed]="selectedId() === el.id"
                    [attr.aria-label]="'Text: ' + name(el)"
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
                    (click)="select(el.id)"
                    (dblclick)="edit(el.id)"
                    (keydown)="onKey($event, el)"
                    (pointerdown)="dragStart($event, el)"
                    (pointermove)="dragMove($event)"
                    (pointerup)="dragEnd($event)"
                    (pointercancel)="dragEnd($event)"
                  >
                    {{ el.props.text }}
                  </button>
                }
              }
            </div>
            <div class="panel">
              <div class="row">
                <button
                  type="button"
                  class="btn btn--secondary"
                  [disabled]="d.elements.length >= maxElements"
                  (click)="addText()"
                >
                  <app-icon name="plus" /> Add text
                </button>
              </div>
              <p class="field__hint" id="studio-keys">
                Select a text to move it with the arrow keys (Shift for larger steps). Enter edits its text, Escape
                stops editing, Delete removes it.
              </p>
              @if (selected(); as el) {
                <fieldset class="field selected">
                  <legend class="field__label">Selected text</legend>
                  <div class="field">
                    <label class="field__label" for="studio-text">Text</label>
                    <textarea
                      id="studio-text"
                      class="input"
                      [attr.maxlength]="maxText"
                      [value]="el.props.text"
                      (input)="setText(el.id, $any($event.target).value)"
                    ></textarea>
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
                        [value]="percent(el.box.x)"
                        (change)="setPosition(el.id, 'x', $any($event.target).value)"
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
                        [value]="percent(el.box.y)"
                        (change)="setPosition(el.id, 'y', $any($event.target).value)"
                      />
                    </div>
                  </div>
                  <div class="row">
                    <button type="button" class="btn btn--ghost btn--sm" (click)="remove(el.id)">Delete text</button>
                  </div>
                </fieldset>
              }
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
  protected readonly selectedId = signal<string | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  /** True when the last save was refused because another save came first (409). */
  protected readonly stale = signal(false);
  protected readonly saveStatus = signal('');
  protected readonly announcement = signal('');
  private drag: Drag | null = null;

  protected readonly maxElements = MAX_TALE_ELEMENTS;
  protected readonly maxText = MAX_TEXT_LENGTH;
  protected readonly textStyle = TEXT_ELEMENT_STYLE;
  protected readonly fontSize = `${TEXT_ELEMENT_STYLE.fontSize * 100}cqh`;

  protected readonly tale = computed(() => this.store.tale(this.taleId()));
  protected readonly selected = computed(() => this.doc()?.elements.find((e) => e.id === this.selectedId()) ?? null);
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
    return nameOf(element);
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

  private change(update: (elements: TaleElement[]) => TaleElement[]): void {
    const doc = this.doc();
    if (!doc) return;
    this.doc.set({ ...doc, elements: update(doc.elements) });
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

  protected select(id: string): void {
    this.selectedId.set(id);
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
    this.selectedId.set(element.id);
    this.say('Text added');
    this.edit(element.id);
  }

  /** Types in place: the element becomes a text field at its place on the canvas. */
  protected edit(id: string): void {
    this.selectedId.set(id);
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

  protected setText(id: string, text: string): void {
    this.change((elements) => elements.map((e) => (e.id === id ? { ...e, props: { ...e.props, text } } : e)));
  }

  protected setPosition(id: string, axis: 'x' | 'y', value: string): void {
    const number = Number(value);
    if (value.trim() === '' || !Number.isFinite(number)) return;
    this.setBox(id, { [axis]: number / 100 });
    this.say('Text moved');
  }

  protected remove(id: string): void {
    this.change((elements) => elements.filter((e) => e.id !== id));
    if (this.selectedId() === id) this.selectedId.set(null);
    if (this.editingId() === id) this.editingId.set(null);
    this.say('Text deleted');
  }

  protected onKey(event: KeyboardEvent, element: TaleElement): void {
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
      this.selectedId.set(element.id);
      // The element as it is now: key repeats can arrive before the view shows the last move.
      const box = this.doc()?.elements.find((e) => e.id === element.id)?.box ?? element.box;
      this.setBox(element.id, { x: box.x + move[0], y: box.y + move[1] });
      const moved = this.doc()?.elements.find((e) => e.id === element.id);
      if (moved) this.say(`Text moved to left ${this.percent(moved.box.x)}%, top ${this.percent(moved.box.y)}%`);
    } else if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      this.edit(element.id);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.remove(element.id);
    }
  }

  protected dragStart(event: PointerEvent, element: TaleElement): void {
    if (event.button !== 0) return;
    const canvas = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    this.selectedId.set(element.id);
    this.drag = {
      id: element.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      box: element.box,
      width: canvas.width,
      height: canvas.height,
      moved: false,
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
    const dx = (event.clientX - drag.x) / drag.width;
    const dy = (event.clientY - drag.y) / drag.height;
    if (!drag.moved && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 3) return;
    drag.moved = true;
    this.setBox(drag.id, { x: drag.box.x + dx, y: drag.box.y + dy });
  }

  protected dragEnd(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    if (drag.moved) this.say('Text moved');
  }

  protected async save(): Promise<void> {
    const doc = this.doc();
    if (!doc || this.saving()) return;
    this.saving.set(true);
    this.saveStatus.set('Saving…');
    const result = await this.documents.save(this.taleId(), doc, this.revision());
    this.saving.set(false);
    if (result.value === null) {
      this.error.set(
        result.stale
          ? 'Someone saved this tale after you opened it. Reload the latest version; your changes here are not saved.'
          : result.message,
      );
      this.stale.set(result.stale);
      this.saveStatus.set('Not saved');
      return;
    }
    this.revision.set(result.value.revision);
    // Edits made while the save was on its way stay unsaved.
    this.saveStatus.set(this.doc() === doc ? 'Saved' : 'Unsaved changes');
    this.error.set('');
    this.stale.set(false);
  }

  protected async reload(): Promise<void> {
    this.selectedId.set(null);
    this.editingId.set(null);
    await this.load();
    if (!this.error()) {
      this.saveStatus.set('');
      this.say('Latest version loaded');
    }
  }
}
