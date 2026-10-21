// Tale Studio's layer operations (epic Tale Studio R2, R3): pure functions over the document's
// elements, whose array order is the z-order, first at the bottom (AD-15).
import { TALE_SAFE_AREA, type CanvasRect, type TaleElement, type TaleElementBox } from '@taleart/contract';

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
  | 'select-all'
  | 'menu';

/** The reorder commands; each one works on several layers at once. */
export type ReorderCommand = 'forward' | 'backward' | 'front' | 'back';

// Box values are kept to 4 decimals, so moves do not pile up floating-point noise.
export const round = (value: number): number => Math.round(value * 10000) / 10000;
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A short name for a layer, from its content: a text's first 40 characters on one line. */
export function layerName(element: TaleElement): string {
  const characters = [...element.props.text.trim().replace(/\s+/g, ' ')];
  if (characters.length === 0) return 'Empty text';
  return characters.length > 40 ? `${characters.slice(0, 40).join('')}…` : characters.join('');
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

/** A copy of the element with a new id, placed a little down and to the right of it, on the canvas. */
export function duplicateElement(element: TaleElement, id: string): TaleElement {
  const { box } = element;
  return {
    ...element,
    id,
    box: {
      ...box,
      x: round(clamp(box.x + DUPLICATE_OFFSET, 0, 1 - box.w)),
      y: round(clamp(box.y + DUPLICATE_OFFSET, 0, 1 - box.h)),
    },
    a11y: { ...element.a11y },
    props: { ...element.props },
  };
}

/** The smallest rectangle around the boxes. */
export function boundsOf(boxes: readonly TaleElementBox[]): CanvasRect {
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
 * What a dragged selection snaps to: the canvas centre, the safe-area edges, and the edges and
 * centres of every other element that is shown.
 */
export function snapTargets(elements: readonly TaleElement[], moving: ReadonlySet<string>): SnapTargets {
  const { top, bottom, side } = TALE_SAFE_AREA;
  const x = [0.5, side, 1 - side];
  const y = [0.5, top, 1 - bottom];
  for (const e of elements) {
    if (moving.has(e.id) || e.hidden) continue;
    x.push(e.box.x, e.box.x + e.box.w / 2, e.box.x + e.box.w);
    y.push(e.box.y, e.box.y + e.box.h / 2, e.box.y + e.box.h);
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

/**
 * The layer command a key press asks for, on a focused canvas element or layer row, or null.
 * Ctrl (Cmd on a Mac) with ] or [ brings forward or sends backward, with Shift to the front or
 * back; Alt with the up or down arrow does the same as ] and [. Ctrl+Shift+H hides or shows,
 * Ctrl+Shift+L locks or unlocks, Ctrl+D duplicates, Ctrl+A selects every layer, Delete deletes,
 * and Shift+F10 or the context-menu key opens the actions menu.
 */
export function layerShortcut(event: KeyboardEvent): LayerCommand | null {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && !event.altKey) {
    if (event.code === 'BracketRight' || key === ']' || key === '}') return event.shiftKey ? 'front' : 'forward';
    if (event.code === 'BracketLeft' || key === '[' || key === '{') return event.shiftKey ? 'back' : 'backward';
    if (event.shiftKey && key === 'h') return 'hide';
    if (event.shiftKey && key === 'l') return 'lock';
    if (!event.shiftKey && key === 'd') return 'duplicate';
    if (!event.shiftKey && key === 'a') return 'select-all';
    return null;
  }
  if (event.altKey && !mod && !event.shiftKey) {
    if (event.key === 'ArrowUp') return 'forward';
    if (event.key === 'ArrowDown') return 'backward';
    return null;
  }
  if (event.altKey || mod) return null;
  if (event.key === 'Delete' && !event.shiftKey) return 'delete';
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) return 'menu';
  return null;
}

/** The shortcut of each command as people read it, and as `aria-keyshortcuts` names it. */
export const LAYER_SHORTCUTS: Readonly<Partial<Record<LayerCommand, { label: string; aria: string }>>> = {
  forward: { label: 'Ctrl+]', aria: 'Control+BracketRight Alt+ArrowUp' },
  backward: { label: 'Ctrl+[', aria: 'Control+BracketLeft Alt+ArrowDown' },
  front: { label: 'Ctrl+Shift+]', aria: 'Control+Shift+BracketRight' },
  back: { label: 'Ctrl+Shift+[', aria: 'Control+Shift+BracketLeft' },
  hide: { label: 'Ctrl+Shift+H', aria: 'Control+Shift+H' },
  lock: { label: 'Ctrl+Shift+L', aria: 'Control+Shift+L' },
  duplicate: { label: 'Ctrl+D', aria: 'Control+D' },
  delete: { label: 'Delete', aria: 'Delete' },
};
