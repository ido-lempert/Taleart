import type { TaleElement } from '@taleart/contract';
import {
  clampMove,
  duplicateElement,
  layerName,
  layerShortcut,
  moveBox,
  reorder,
  snap,
  snapTargets,
} from './tale-layers';

function text(id: string, value = id, extra: Partial<TaleElement> = {}): TaleElement {
  return {
    id,
    type: 'text',
    box: { x: 0.1, y: 0.4, w: 0.5, h: 0.1, rotation: 0 },
    hidden: false,
    locked: false,
    a11y: {},
    props: { text: value },
    ...extra,
  };
}

const ids = (elements: readonly { id: string }[]) => elements.map((e) => e.id).join('');

describe('reorder', () => {
  const abcd = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const pick = (...picked: string[]) => new Set(picked);

  it('brings one layer forward and sends it backward by one place', () => {
    expect(ids(reorder(abcd, pick('b'), 'forward'))).toBe('acbd');
    expect(ids(reorder(abcd, pick('c'), 'backward'))).toBe('acbd');
  });

  it('moves a layer to the front or the back', () => {
    expect(ids(reorder(abcd, pick('a'), 'front'))).toBe('bcda');
    expect(ids(reorder(abcd, pick('d'), 'back'))).toBe('dabc');
  });

  it('moves several layers at once, keeping their own order', () => {
    expect(ids(reorder(abcd, pick('a', 'c'), 'forward'))).toBe('badc');
    expect(ids(reorder(abcd, pick('b', 'd'), 'backward'))).toBe('badc');
    expect(ids(reorder(abcd, pick('a', 'c'), 'front'))).toBe('bdac');
    expect(ids(reorder(abcd, pick('b', 'd'), 'back'))).toBe('bdac');
    // A run of selected layers moves together past its neighbour.
    expect(ids(reorder(abcd, pick('b', 'c'), 'forward'))).toBe('adbc');
  });

  it('returns the same array when nothing moves', () => {
    expect(reorder(abcd, pick('d'), 'forward')).toBe(abcd);
    expect(reorder(abcd, pick('c', 'd'), 'front')).toBe(abcd);
    expect(reorder(abcd, pick('a'), 'backward')).toBe(abcd);
    expect(reorder(abcd, pick('a', 'b'), 'back')).toBe(abcd);
    expect(reorder(abcd, pick(), 'front')).toBe(abcd);
  });
});

describe('layer helpers', () => {
  it('names a layer from its text, on one line and at most 40 characters', () => {
    expect(layerName(text('a', '  Hello\n  world '))).toBe('Hello world');
    expect(layerName(text('a', ' \n '))).toBe('Empty text');
    expect(layerName(text('a', '😀'.repeat(41)))).toBe(`${'😀'.repeat(40)}…`);
  });

  it('duplicates with a new id, offset and kept on the canvas, without sharing objects', () => {
    const original = text('a', 'Hi', { locked: true, a11y: { decorative: true } });
    const copy = duplicateElement(original, 'b');
    expect(copy).toEqual({ ...original, id: 'b', box: { ...original.box, x: 0.12, y: 0.42 } });
    expect(copy.props).not.toBe(original.props);
    const edge = duplicateElement(text('a', 'x', { box: { x: 0.5, y: 0.9, w: 0.5, h: 0.1, rotation: 10 } }), 'b');
    expect(edge.box).toEqual({ x: 0.5, y: 0.9, w: 0.5, h: 0.1, rotation: 10 });
  });

  it('keeps a moving group on the canvas as a whole', () => {
    const boxes = [
      { x: 0.1, y: 0.1, w: 0.2, h: 0.1, rotation: 0 },
      { x: 0.5, y: 0.5, w: 0.3, h: 0.1, rotation: 0 },
    ];
    expect(clampMove(boxes, -0.5, 0.05)).toEqual({ dx: -0.1, dy: 0.05 });
    expect(clampMove(boxes, 0.5, 0.9).dx).toBeCloseTo(0.2);
    expect(clampMove(boxes, 0.5, 0.9).dy).toBeCloseTo(0.4);
    expect(clampMove([], 1, 1)).toEqual({ dx: 0, dy: 0 });
    expect(moveBox(boxes[0], 0.01, 0.02)).toEqual({ ...boxes[0], x: 0.11, y: 0.12 });
  });

  it('snaps to the canvas centre, the safe-area edges and the other shown layers', () => {
    const other = text('o', 'o', { box: { x: 0.3, y: 0.7, w: 0.2, h: 0.05, rotation: 0 } });
    const hidden = text('h', 'h', { hidden: true, box: { x: 0.33, y: 0.33, w: 0.1, h: 0.1, rotation: 0 } });
    const targets = snapTargets([text('m'), other, hidden], new Set(['m']));
    expect(targets.x).toEqual([0.5, 0.04, 0.96, 0.3, 0.4, 0.5]);
    expect(targets.y.map((y) => Math.round(y * 1000) / 1000)).toEqual([0.5, 0.12, 0.84, 0.7, 0.725, 0.75]);
    const near = { x: 0.01, y: 0.01 };
    // Its centre lands on the canvas centre.
    expect(snap({ x: 0.246, y: 0.2, w: 0.5, h: 0.1 }, targets, near)).toMatchObject({ x: 0.5, y: null });
    // Its bottom lands on the bottom safe-area edge.
    const bottom = snap({ x: 0.2, y: 0.735, w: 0.2, h: 0.1 }, targets, near);
    expect(bottom.y).toBe(0.84);
    expect(bottom.dy).toBeCloseTo(0.005);
    // Its left edge lands on another layer's right edge.
    expect(snap({ x: 0.505, y: 0.2, w: 0.1, h: 0.1 }, targets, near)).toMatchObject({ x: 0.5 });
    expect(snap({ x: 0.2, y: 0.2, w: 0.01, h: 0.01 }, targets, near)).toEqual({ dx: 0, dy: 0, x: null, y: null });
  });
});

describe('layerShortcut', () => {
  const press = (key: string, init: KeyboardEventInit = {}) =>
    layerShortcut(new KeyboardEvent('keydown', { key, ...init }));

  it('reads the reorder shortcuts with Ctrl or Cmd, and Alt with the up and down arrows', () => {
    expect(press(']', { ctrlKey: true })).toBe('forward');
    expect(press('[', { metaKey: true })).toBe('backward');
    expect(press('}', { ctrlKey: true, shiftKey: true, code: 'BracketRight' })).toBe('front');
    expect(press('{', { ctrlKey: true, shiftKey: true, code: 'BracketLeft' })).toBe('back');
    expect(press('ArrowUp', { altKey: true })).toBe('forward');
    expect(press('ArrowDown', { altKey: true })).toBe('backward');
    expect(press('ArrowLeft', { altKey: true })).toBeNull();
  });

  it('reads hide, lock, duplicate, select all, delete and the menu', () => {
    expect(press('H', { ctrlKey: true, shiftKey: true })).toBe('hide');
    expect(press('l', { metaKey: true, shiftKey: true })).toBe('lock');
    expect(press('d', { ctrlKey: true })).toBe('duplicate');
    expect(press('a', { metaKey: true })).toBe('select-all');
    expect(press('Delete')).toBe('delete');
    expect(press('F10', { shiftKey: true })).toBe('menu');
    expect(press('ContextMenu')).toBe('menu');
  });

  it('leaves other keys alone, Backspace and plain letters included', () => {
    expect(press('Backspace')).toBeNull();
    expect(press('h')).toBeNull();
    expect(press('d', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('ArrowUp')).toBeNull();
    expect(press('F10')).toBeNull();
    expect(press('Delete', { ctrlKey: true })).toBeNull();
  });
});
