import { NEW_MEDIA_BOX, NEW_SHAPE_BOX, SWIPE_UP_BOX } from '@taleart/contract/tale-document';
import { studioElementTypes } from './tale-element-types';
import { snapTargets } from './tale-layers';
import { paletteTiles } from './tale-palette';
import { dropBox, nextFreeSpot, safeClamp, stageClamp, tileBox } from './tale-placement';

// Story 11.4: where a new element lands, by a click or a key (the next free spot) or by a drop.
const box = (x: number, y: number, w = 0.4, h = 0.2) => ({ x, y, w, h, rotation: 0 });
const NONE = { x: [], y: [] };
const NEAR = { x: 0.02, y: 0.01 };

describe('tileBox', () => {
  const tiles = paletteTiles(studioElementTypes());
  const tile = (id: string) => {
    const found = tiles.find((t) => t.id === `studio-add-${id}`);
    if (!found) throw new Error(id);
    return found;
  };

  it('is the size each tile adds: its type or preset box', () => {
    expect(tileBox(tile('image'))).toEqual(NEW_MEDIA_BOX);
    expect(tileBox(tile('rectangle'))).toEqual(NEW_SHAPE_BOX);
    expect(tileBox(tile('swipe-up'))).toEqual(SWIPE_UP_BOX);
    expect(tileBox(tile('heading'))).toEqual(tile('heading').preset?.box);
    expect(tileBox(tile('poll'))).toEqual(tile('poll').type.create?.box);
  });

  it('has a box for every tile, inside the canvas', () => {
    for (const t of tiles) {
      const b = tileBox(t);
      expect(b.w, t.id).toBeGreaterThan(0);
      expect(b.w, t.id).toBeLessThanOrEqual(1);
      expect(b.h, t.id).toBeLessThanOrEqual(1);
    }
  });
});

describe('safeClamp and stageClamp', () => {
  it('moves a box into the safe area, or into the canvas on an axis where it is larger', () => {
    expect(safeClamp(box(-0.2, 0.95))).toEqual(box(0.04, 0.64));
    expect(safeClamp(box(0.5, 0.5, 1, 0.9))).toEqual(box(0, 0.1, 1, 0.9));
    expect(stageClamp(box(-0.2, 0.95))).toEqual(box(0, 0.8));
  });
});

describe('nextFreeSpot', () => {
  it('is the centre of the safe area on an empty tale', () => {
    expect(nextFreeSpot(box(0, 0), [])).toEqual(box(0.3, 0.38));
  });

  it('moves 4% down and right past each spot an element holds', () => {
    const first = nextFreeSpot(box(0, 0), []);
    const second = nextFreeSpot(box(0, 0), [{ box: first }]);
    expect(second).toEqual(box(0.34, 0.42));
    expect(nextFreeSpot(box(0, 0), [{ box: first }, { box: second }])).toEqual(box(0.38, 0.46));
  });

  it('counts an element by its centre, whatever its size, and frees a spot an element left', () => {
    // A full-width image centred in the safe area takes the centre.
    expect(nextFreeSpot(box(0, 0), [{ box: box(0.1, 0.28, 0.8, 0.4) }])).toEqual(box(0.34, 0.42));
    // An element moved away leaves the centre free.
    expect(nextFreeSpot(box(0, 0), [{ box: box(0.04, 0.12) }])).toEqual(box(0.3, 0.38));
  });

  it('goes up and left from the centre once the spots run into the corner, and falls back to the centre', () => {
    const taken = Array.from({ length: 12 }, (_, k) => ({ box: safeClamp(box(0.3 + k * 0.04, 0.38 + k * 0.04)) }));
    expect(nextFreeSpot(box(0, 0), taken)).toEqual(box(0.26, 0.34));
    const all = Array.from({ length: 30 }, (_, k) => ({ box: safeClamp(box(0.3 + (k - 15) * 0.04, 0.38 + (k - 15) * 0.04)) }));
    expect(nextFreeSpot(box(0, 0), all)).toEqual(box(0.3, 0.38));
  });
});

describe('dropBox', () => {
  it('centres the box on the pointer', () => {
    expect(dropBox(box(0, 0), { x: 0.4, y: 0.4 }, NONE, NEAR)).toEqual({ box: box(0.2, 0.3), lines: { x: null, y: null } });
  });

  it('snaps to a guide within the distance and keeps the guide', () => {
    const { box: at, lines } = dropBox(box(0, 0), { x: 0.51, y: 0.4 }, snapTargets([], new Set()), NEAR);
    expect(at.x).toBe(0.3);
    expect(lines.x).toBe(0.5);
  });

  it('clamps into the safe area and drops a guide the clamp moved it off', () => {
    const { box: at, lines } = dropBox(box(0, 0), { x: 0.5, y: 0.99 }, { x: [0.5], y: [0.99] }, NEAR);
    expect(at).toEqual(box(0.3, 0.64));
    expect(lines).toEqual({ x: 0.5, y: null });
  });

  it('shows the centre guide when an element edge lines up with it too', () => {
    // A heading across the safe area (left edge at 0.1) and a poll as wide dropped near the centre.
    const heading = { id: 'h', type: 'text', box: box(0.1, 0.2, 0.8, 0.14), hidden: false, locked: false, a11y: {}, props: {} };
    const targets = snapTargets([heading as never], new Set());
    const { box: at, lines } = dropBox(box(0, 0, 0.8, 0.28), { x: 0.505, y: 0.6 }, targets, NEAR);
    expect(at.x).toBe(0.1);
    expect(lines.x).toBe(0.5);
  });

  it('places freely with Alt: no snapping, clamped into the canvas only', () => {
    const { box: at, lines } = dropBox(box(0, 0), { x: 0.51, y: 0.99 }, snapTargets([], new Set()), NEAR, true);
    expect(at).toEqual(box(0.31, 0.8));
    expect(lines).toEqual({ x: null, y: null });
  });
});
