// Where a new element lands (epic Tale Studio 2 R3, EXPERIENCE Component Patterns, Palette tile, and
// Interaction Primitives): the size a tile's element has, the next free spot a click or a key adds it
// at, and the box a drag drops it in, snapped and clamped into the safe area. Pure, so the studio's
// drag stays thin and this is unit tested on its own.
import {
  NEW_BUTTON_BOX,
  NEW_EMOJI_BOX,
  NEW_IMAGE_BUTTON_BOX,
  NEW_LINE_BOX,
  NEW_MEDIA_BOX,
  NEW_SHAPE_BOX,
  NEW_STICKER_BOX,
  NEW_TEXT_BOX,
  SWIPE_UP_BOX,
  TALE_SAFE_AREA,
  type TaleElementBox,
} from '@taleart/contract/tale-document';
import { clamp, percent, round, snap, type SnapTargets } from './tale-layers';
import type { PaletteTile } from './tale-palette';

/** How far each next spot moves down and right from the one before (EXPERIENCE: "offset by 4%"). */
export const NEXT_SPOT_STEP = 0.04;
/** How close an element's centre comes to a spot, on both axes, for the spot to be taken. */
export const SPOT_TAKEN_WITHIN = 0.02;

/** A guide a drop snapped to on each axis, as canvas fractions (null for none). */
export interface DropLines {
  x: number | null;
  y: number | null;
}

/** The box a tile's element is added with, before it is placed: its type's (or preset's) new box. */
export function tileBox(tile: PaletteTile): TaleElementBox {
  const action = tile.action;
  switch (action.kind) {
    case 'text':
      return { ...(tile.preset?.box ?? NEW_TEXT_BOX) };
    case 'media':
      return { ...NEW_MEDIA_BOX };
    case 'sticker':
      return { ...NEW_STICKER_BOX };
    case 'image-button':
      return { ...NEW_IMAGE_BUTTON_BOX };
    case 'shape':
      return { ...(action.shape === 'line' ? NEW_LINE_BOX : NEW_SHAPE_BOX) };
    case 'emoji':
      return { ...NEW_EMOJI_BOX };
    case 'button':
      return { ...NEW_BUTTON_BOX };
    case 'swipe-up':
      return { ...SWIPE_UP_BOX };
    case 'configured':
      return { ...(tile.preset?.box ?? tile.type.create?.box ?? NEW_SHAPE_BOX) };
  }
}

/** The safe area as a rectangle of the canvas. */
export const SAFE_RECT = {
  x: TALE_SAFE_AREA.side,
  y: TALE_SAFE_AREA.top,
  w: 1 - 2 * TALE_SAFE_AREA.side,
  h: 1 - TALE_SAFE_AREA.top - TALE_SAFE_AREA.bottom,
} as const;

// One axis kept inside [min, max] for a box of `size`, or inside the canvas when it is larger.
function clampAxis(at: number, size: number, min: number, max: number): number {
  return size <= max - min ? clamp(at, min, max - size) : clamp(at, 0, Math.max(0, 1 - size));
}

/**
 * The box moved, as little as it takes, into the safe area; on an axis where it is larger than the
 * safe area, into the canvas instead. Rounded as the document keeps boxes.
 */
export function safeClamp(box: TaleElementBox): TaleElementBox {
  return {
    ...box,
    x: round(clampAxis(box.x, box.w, SAFE_RECT.x, SAFE_RECT.x + SAFE_RECT.w)),
    y: round(clampAxis(box.y, box.h, SAFE_RECT.y, SAFE_RECT.y + SAFE_RECT.h)),
  };
}

/** The box kept on the canvas only (Alt places freely). */
export function stageClamp(box: TaleElementBox): TaleElementBox {
  return {
    ...box,
    x: round(clamp(box.x, 0, Math.max(0, 1 - box.w))),
    y: round(clamp(box.y, 0, Math.max(0, 1 - box.h))),
  };
}

const centre = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * Where a click or a key adds an element of `size` (EXPERIENCE Palette tile): the centre of the safe
 * area, else 4% further down and right for each spot an element already holds (its centre within 2%
 * on both axes). When that runs into the safe area's corner, the spots go up and left of the centre
 * instead. When every spot is taken, the centre.
 */
export function nextFreeSpot(
  size: TaleElementBox,
  elements: readonly { box: { x: number; y: number; w: number; h: number } }[],
): TaleElementBox {
  const middle = centre(SAFE_RECT);
  const at = (k: number) =>
    safeClamp({
      ...size,
      x: middle.x - size.w / 2 + k * NEXT_SPOT_STEP,
      y: middle.y - size.h / 2 + k * NEXT_SPOT_STEP,
    });
  const centres = elements.map((e) => centre(e.box));
  const free = (box: TaleElementBox) => {
    const c = centre(box);
    return !centres.some((o) => Math.abs(o.x - c.x) < SPOT_TAKEN_WITHIN && Math.abs(o.y - c.y) < SPOT_TAKEN_WITHIN);
  };
  for (const direction of [1, -1]) {
    let last: TaleElementBox | null = null;
    for (let k = direction === 1 ? 0 : -1; Math.abs(k) <= 60; k += direction) {
      const spot = at(k);
      // Clamped at the corner: the spots stop moving, so the rest of this direction is the same spot.
      if (last && spot.x === last.x && spot.y === last.y) break;
      if (free(spot)) return spot;
      last = spot;
    }
  }
  return at(0);
}

/** How near the safe area's centre, on both axes, an element's centre is said to be "near the centre". */
export const NEAR_CENTRE = 0.05;

/**
 * Where an added element landed, as the live region says it (EXPERIENCE Accessibility Floor): "near
 * the centre of the safe area", else "at left 10%, top 56% of the tale" (its box's top left corner).
 */
export function landedSaid(box: TaleElementBox): string {
  const at = centre(box);
  const middle = centre(SAFE_RECT);
  if (Math.abs(at.x - middle.x) <= NEAR_CENTRE && Math.abs(at.y - middle.y) <= NEAR_CENTRE) {
    return 'near the centre of the safe area';
  }
  return `at left ${percent(box.x)}%, top ${percent(box.y)}% of the tale`;
}

/**
 * The box a drag drops an element of `size` in: centred on the pointer (`point`, a canvas fraction),
 * snapped to the nearest guide within `distance` unless placed freely, then clamped into the safe area
 * (into the canvas only when placed freely). Each guide is kept only where the clamped box still
 * touches it.
 */
export function dropBox(
  size: TaleElementBox,
  point: { x: number; y: number },
  targets: SnapTargets,
  distance: { x: number; y: number },
  free = false,
): { box: TaleElementBox; lines: DropLines } {
  let box: TaleElementBox = { ...size, x: point.x - size.w / 2, y: point.y - size.h / 2 };
  let lines: DropLines = { x: null, y: null };
  if (!free) {
    const snapped = snap(box, targets, distance);
    box = { ...box, x: box.x + snapped.dx, y: box.y + snapped.dy };
    lines = { x: snapped.x, y: snapped.y };
  }
  box = free ? stageClamp(box) : safeClamp(box);
  const touches = (line: number | null, at: number, length: number) =>
    line !== null && [at, at + length / 2, at + length].some((edge) => Math.abs(edge - line) < 0.0005) ? line : null;
  return { box, lines: { x: touches(lines.x, box.x, box.w), y: touches(lines.y, box.y, box.h) } };
}
