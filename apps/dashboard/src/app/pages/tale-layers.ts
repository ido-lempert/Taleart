// Tale Studio's layer operations (epic Tale Studio R2, R3): pure functions over the document's
// elements, whose array order is the z-order, first at the bottom (AD-15).
import {
  elementBounds,
  elementName,
  TALE_SAFE_AREA,
  type CanvasRect,
  type TaleElement,
  type TaleElementBox,
} from '@taleart/contract/tale-document';

/** A layer action, from the layers list, the actions menu or a keyboard shortcut. */
export type LayerCommand =
  | 'forward'
  | 'backward'
  | 'front'
  | 'back'
  | 'hide'
  | 'lock'
  | 'duplicate'
  | 'delete'
  | 'select-all';

/** The reorder commands; each one works on several layers at once. */
export type ReorderCommand = 'forward' | 'backward' | 'front' | 'back';

// Box values are kept to 4 decimals, so moves do not pile up floating-point noise.
export const round = (value: number): number => Math.round(value * 10000) / 10000;
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * A short name for a layer, from its content, as the contract's `elementName` gives it (shared with
 * the server's refusals): a text's first 40 characters on one line; an image's, video's or image
 * sticker's alt text, else its type and place among its kind ("Image 2"); an emoji with its name
 * ("🎉 party popper"); a shape's label, else its shape and place ("Rectangle 1"). Without the
 * document's `elements` it is the first of its kind.
 */
export function layerName(element: TaleElement, elements: readonly TaleElement[] = [element]): string {
  const index = elements.indexOf(element);
  return index < 0 ? elementName([element], 0) : elementName(elements, index);
}

/**
 * A layer's name split for screen readers (story 7.15): an emoji named by its label shows its glyph
 * before the name ("🎉 party popper"), and a screen reader reads the glyph as its own name, so the
 * name would be said twice. `glyph` is that leading glyph, shown but hidden from screen readers;
 * `spoken` the rest. Every other layer's `spoken` is its whole name, with no glyph.
 */
export function layerSpokenName(
  element: TaleElement,
  elements: readonly TaleElement[] = [element],
): { glyph: string; spoken: string } {
  const name = layerName(element, elements);
  if (element.type !== 'emoji') return { glyph: '', spoken: name };
  const glyph = element.props.emoji;
  return glyph && name.startsWith(`${glyph} `) && name.length > glyph.length + 1
    ? { glyph, spoken: name.slice(glyph.length + 1) }
    : { glyph: '', spoken: name };
}

/**
 * The elements with the selected ones moved in the z-order. Forward and backward move each run
 * of selected elements one place past its unselected neighbour; front and back move them all to
 * the top or the bottom. Selected elements keep their order among themselves. The same array
 * comes back when nothing moves.
 */
export function reorder<T extends { id: string }>(
  elements: readonly T[],
  ids: ReadonlySet<string>,
  command: ReorderCommand,
): readonly T[] {
  const picked = (e: T) => ids.has(e.id);
  let next: T[];
  if (command === 'front') next = [...elements.filter((e) => !picked(e)), ...elements.filter(picked)];
  else if (command === 'back') next = [...elements.filter(picked), ...elements.filter((e) => !picked(e))];
  else {
    next = [...elements];
    if (command === 'forward') {
      for (let i = next.length - 2; i >= 0; i--) {
        if (picked(next[i]) && !picked(next[i + 1])) [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    } else {
      for (let i = 1; i < next.length; i++) {
        if (picked(next[i]) && !picked(next[i - 1])) [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
  }
  return next.every((e, i) => e === elements[i]) ? elements : next;
}

/** How far a duplicate sits from its original, as a fraction of the canvas, so both can be seen. */
export const DUPLICATE_OFFSET = 0.02;

// The offset start: `offset` further on, or back the other way when the canvas has no room for it.
function shifted(start: number, size: number, offset: number): number {
  const max = 1 - size;
  return round(start + offset <= max ? start + offset : clamp(start - offset, 0, max));
}

/**
 * A copy of the element with a new id, placed a little down and to the right of it, or up and to
 * the left where it meets the canvas edge, so the copy is always seen beside its original.
 */
export function duplicateElement(element: TaleElement, id: string): TaleElement {
  const { box } = element;
  return {
    ...element,
    id,
    box: {
      ...box,
      x: shifted(box.x, box.w, DUPLICATE_OFFSET),
      y: shifted(box.y, box.h, DUPLICATE_OFFSET),
    },
    a11y: { ...element.a11y },
    // A copy of the tale's own media (R16) is an ordinary element: a tale has one media.
    props: Object.fromEntries(Object.entries(element.props).filter(([key]) => key !== 'taleMedia')),
  } as TaleElement;
}

/** The smallest rectangle around the boxes or rectangles. */
export function boundsOf(boxes: readonly CanvasRect[]): CanvasRect {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** The move `dx`, `dy` cut so every box stays on the canvas; the boxes keep their places relative to each other. */
export function clampMove(boxes: readonly TaleElementBox[], dx: number, dy: number): { dx: number; dy: number } {
  if (boxes.length === 0) return { dx: 0, dy: 0 };
  const at = boundsOf(boxes);
  return { dx: clamp(dx, -at.x, 1 - at.w - at.x), dy: clamp(dy, -at.y, 1 - at.h - at.y) };
}

/** The box moved by `dx`, `dy`, rounded. */
export function moveBox(box: TaleElementBox, dx: number, dy: number): TaleElementBox {
  return { ...box, x: round(clamp(box.x + dx, 0, 1 - box.w)), y: round(clamp(box.y + dy, 0, 1 - box.h)) };
}

/** Lines a moving selection snaps to: vertical ones (`x`) and horizontal ones (`y`), as canvas fractions. */
export interface SnapTargets {
  x: number[];
  y: number[];
}

/**
 * What a dragged selection snaps to: the canvas centre, the safe-area edges, and the visible edges
 * and centres of every other element that is shown, rotation included ({@link elementBounds}).
 */
export function snapTargets(elements: readonly TaleElement[], moving: ReadonlySet<string>): SnapTargets {
  const { top, bottom, side } = TALE_SAFE_AREA;
  const x = [0.5, side, 1 - side];
  const y = [0.5, top, 1 - bottom];
  for (const e of elements) {
    if (moving.has(e.id) || e.hidden) continue;
    const at = elementBounds(e.box);
    x.push(at.x, at.x + at.w / 2, at.x + at.w);
    y.push(at.y, at.y + at.h / 2, at.y + at.h);
  }
  return { x, y };
}

/** A snapped move: the change to apply, and the guide line it snapped to on each axis (null for none). */
export interface Snap {
  dx: number;
  dy: number;
  x: number | null;
  y: number | null;
}

// The nearest target to any of the edges within `distance`: the shift that lands on it, and the target.
function nearest(edges: number[], targets: number[], distance: number): { shift: number; at: number | null } {
  let best = { shift: 0, at: null as number | null, gap: distance };
  for (const target of targets) {
    for (const edge of edges) {
      const gap = Math.abs(target - edge);
      if (gap <= best.gap) best = { shift: target - edge, at: target, gap };
    }
  }
  return { shift: best.shift, at: best.at };
}

/**
 * Snaps a rectangle being dragged: its left edge, centre and right edge to the nearest vertical
 * target, and its top, middle and bottom to the nearest horizontal one, each within `distance`
 * (a fraction of the canvas width and height).
 */
export function snap(rect: CanvasRect, targets: SnapTargets, distance: { x: number; y: number }): Snap {
  const sx = nearest([rect.x, rect.x + rect.w / 2, rect.x + rect.w], targets.x, distance.x);
  const sy = nearest([rect.y, rect.y + rect.h / 2, rect.y + rect.h], targets.y, distance.y);
  return { dx: sx.shift, dy: sy.shift, x: sx.at, y: sy.at };
}

/** How close, in screen pixels, a dragged edge comes to a target before it snaps. */
export const SNAP_DISTANCE_PX = 6;

/** True on macOS and iOS, where Cmd is the command key and Backspace is the delete key. */
export function isApple(): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const platform =
    (nav as { userAgentData?: { platform?: string } } | null)?.userAgentData?.platform ?? nav?.platform ?? '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// The letter a key press stands for: the Latin letter it types, so a layout that moves letters
// (AZERTY's A and Z) matches what its keys say; on a layout without Latin letters, such as Hebrew,
// the physical key (`KeyH`).
function letter(event: KeyboardEvent): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  const code = /^Key([A-Z])$/.exec(event.code ?? '')?.[1];
  return (code ?? event.key).toLowerCase();
}

/** A history command, from the keyboard or the toolbar. */
export type HistoryCommand = 'undo' | 'redo';

/**
 * The history command a key press asks for, or null: Cmd+Z and Shift+Cmd+Z on a Mac, Ctrl+Z,
 * Ctrl+Shift+Z and Ctrl+Y elsewhere. The studio asks only outside text fields, whose own undo
 * stays the browser's.
 */
export function historyShortcut(event: KeyboardEvent, apple = isApple()): HistoryCommand | null {
  const mod = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod || event.altKey) return null;
  const key = letter(event);
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !apple && !event.shiftKey) return 'redo';
  return null;
}

/** How the history shortcuts read, with the Mac symbols on a Mac. */
export function historyLabel(command: HistoryCommand, apple = isApple()): string {
  if (command === 'undo') return apple ? '⌘Z' : 'Ctrl+Z';
  return apple ? '⇧⌘Z' : 'Ctrl+Shift+Z';
}

/** The history shortcuts as `aria-keyshortcuts` names them on this platform. */
export function historyKeyShortcuts(command: HistoryCommand, apple = isApple()): string {
  if (command === 'undo') return apple ? 'Meta+Z' : 'Control+Z';
  return apple ? 'Meta+Shift+Z' : 'Control+Shift+Z Control+Y';
}

/** True for a field where typing goes, whose keys (its own undo included) belong to the browser. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
    return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file', 'image'].includes(target.type);
}

/**
 * The layer command a key press asks for, or null. Studio shortcuts work only while focus is on a
 * canvas element or in the layers list, never in a text field, so single keys are safe there
 * (WCAG 2.1.4) and nothing clashes with the browser: Alt+Up and Alt+Down bring forward and send
 * backward, with Shift to the front and the back; H hides or shows, L locks or unlocks, D
 * duplicates; Ctrl+A (Cmd+A on a Mac) selects every layer; Delete deletes, and so does Backspace
 * on a Mac. Letters are matched by the Latin letter typed, else by physical key, so they work on
 * any keyboard layout.
 */
export function layerShortcut(event: KeyboardEvent, apple = isApple()): LayerCommand | null {
  const mod = event.ctrlKey || event.metaKey;
  if (event.altKey && !mod) {
    if (event.key === 'ArrowUp') return event.shiftKey ? 'front' : 'forward';
    if (event.key === 'ArrowDown') return event.shiftKey ? 'back' : 'backward';
    return null;
  }
  if (event.altKey) return null;
  if (mod) return !event.shiftKey && letter(event) === 'a' ? 'select-all' : null;
  if (event.shiftKey) return null;
  if (event.key === 'Delete' || (apple && event.key === 'Backspace')) return 'delete';
  const key = letter(event);
  if (key === 'h') return 'hide';
  if (key === 'l') return 'lock';
  if (key === 'd') return 'duplicate';
  return null;
}

/** How each shortcut reads, with the Mac symbols on a Mac. */
export function shortcutLabel(command: LayerCommand, apple = isApple()): string {
  const alt = apple ? '⌥' : 'Alt+';
  const shift = apple ? '⇧' : 'Shift+';
  const labels: Record<LayerCommand, string> = {
    forward: `${alt}↑`,
    backward: `${alt}↓`,
    front: `${alt}${shift}↑`,
    back: `${alt}${shift}↓`,
    hide: 'H',
    lock: 'L',
    duplicate: 'D',
    delete: apple ? '⌫' : 'Delete',
    'select-all': apple ? '⌘A' : 'Ctrl+A',
  };
  return labels[command];
}

/**
 * The layer shortcuts as `aria-keyshortcuts` names them (ARIA key values), for the canvas elements
 * and the layer rows, where they work.
 */
export const LAYER_KEYSHORTCUTS =
  'Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown H L D Delete Control+A Meta+A';
