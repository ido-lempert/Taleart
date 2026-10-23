import type { TaleElement, TextElement } from '@taleart/contract/tale-document';
import {
  clampMove,
  duplicateElement,
  historyKeyShortcuts,
  historyLabel,
  historyShortcut,
  isTextEntry,
  layerName,
  layerShortcut,
  layerSpokenName,
  moveBox,
  reorder,
  shortcutLabel,
  snap,
  snapTargets,
} from './tale-layers';

function text(id: string, value = id, extra: Partial<TextElement> = {}): TextElement {
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

describe('layerSpokenName (story 7.15)', () => {
  const emoji = (label?: string) =>
    ({
      ...text('e'),
      type: 'emoji',
      a11y: label === undefined ? {} : { label },
      props: { emoji: '🎉' },
    }) as unknown as TaleElement;

  it('says an emoji by its name only, with the glyph shown apart', () => {
    expect(layerName(emoji('party popper'))).toBe('🎉 party popper');
    expect(layerSpokenName(emoji('party popper'))).toEqual({ glyph: '🎉', spoken: 'party popper' });
  });

  it('keeps the glyph as the name of an emoji without a label, and every other layer whole', () => {
    expect(layerSpokenName(emoji())).toEqual({ glyph: '', spoken: '🎉' });
    expect(layerSpokenName(emoji('  '))).toEqual({ glyph: '', spoken: '🎉' });
    expect(layerSpokenName(text('t', '🎉 Launch'))).toEqual({ glyph: '', spoken: '🎉 Launch' });
  });
});

describe('layer helpers', () => {
  it('names a layer from its text, on one line and at most 40 characters', () => {
    expect(layerName(text('a', '  Hello\n  world '))).toBe('Hello world');
    expect(layerName(text('a', ' \n '))).toBe('Empty text');
    expect(layerName(text('a', '😀'.repeat(41)))).toBe(`${'😀'.repeat(40)}…`);
    // An image or video is named by its alt text, else by its type and place among its kind (R5).
    const media = (id: string, type: 'image' | 'video', label?: string) =>
      ({
        ...text(id),
        type,
        a11y: label ? { label } : {},
        props: { mediaKey: 'media/a.png', fit: 'cover' },
      }) as unknown as TaleElement;
    const elements = [
      media('i1', 'image'),
      text('t'),
      media('v1', 'video'),
      media('i2', 'image'),
      media('i3', 'image', 'Cat'),
    ];
    expect(layerName(elements[3], elements)).toBe('Image 2');
    expect(layerName(elements[2], elements)).toBe('Video 1');
    expect(layerName(elements[4], elements)).toBe('Cat');
    expect(layerName(elements[0])).toBe('Image 1');
  });

  it('duplicates with a new id, offset and kept on the canvas, without sharing objects', () => {
    const original = text('a', 'Hi', { locked: true, a11y: { decorative: true } });
    const copy = duplicateElement(original, 'b');
    expect(copy).toEqual({ ...original, id: 'b', box: { ...original.box, x: 0.12, y: 0.42 } });
    expect(copy.props).not.toBe(original.props);
    const edge = duplicateElement(text('a', 'x', { box: { x: 0.5, y: 0.9, w: 0.5, h: 0.1, rotation: 10 } }), 'b');
    // No room past the edge: the copy goes up and to the left instead, so it is seen.
    expect(edge.box).toEqual({ x: 0.48, y: 0.88, w: 0.5, h: 0.1, rotation: 10 });
    const full = duplicateElement(text('a', 'x', { box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 } }), 'b');
    expect(full.box).toEqual({ x: 0, y: 0, w: 1, h: 1, rotation: 0 });
    // A copy of the tale's own media (R16) is an ordinary image: a tale has one media.
    const own = {
      ...text('a', 'x'),
      type: 'image',
      props: { mediaKey: 'tales/0a.png', fit: 'contain', taleMedia: true },
    } as unknown as Parameters<typeof duplicateElement>[0];
    expect(duplicateElement(own, 'b').props).toEqual({ mediaKey: 'tales/0a.png', fit: 'contain' });
    expect(own.props).toHaveProperty('taleMedia', true);
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
    // A turned layer offers its visible edges: a quarter turn of a 0.45 × 0.1 box at the centre.
    const turned = text('t', 't', { box: { x: 0.275, y: 0.45, w: 0.45, h: 0.1, rotation: 90 } });
    const visible = snapTargets([text('m'), turned], new Set(['m']));
    expect(visible.x[3]).toBeCloseTo(0.5 - 1.6 / 9 / 2);
    expect(visible.y[3]).toBeCloseTo(0.5 - 4.05 / 16 / 2);
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
  const press = (key: string, init: KeyboardEventInit = {}, apple = false) =>
    layerShortcut(new KeyboardEvent('keydown', { key, ...init }), apple);

  it('reorders with Alt and the up and down arrows, with Shift to the front and the back', () => {
    expect(press('ArrowUp', { altKey: true })).toBe('forward');
    expect(press('ArrowDown', { altKey: true })).toBe('backward');
    expect(press('ArrowUp', { altKey: true, shiftKey: true })).toBe('front');
    expect(press('ArrowDown', { altKey: true, shiftKey: true })).toBe('back');
    expect(press('ArrowLeft', { altKey: true })).toBeNull();
    // The old browser-clashing combinations do nothing.
    expect(press(']', { ctrlKey: true })).toBeNull();
    expect(press('d', { ctrlKey: true })).toBeNull();
  });

  it('reads H, L and D by physical key, so a Hebrew layout works too', () => {
    expect(press('h')).toBe('hide');
    expect(press('L')).toBe('lock');
    expect(press('d')).toBe('duplicate');
    expect(press('י', { code: 'KeyH' })).toBe('hide');
    expect(press('ך', { code: 'KeyL' })).toBe('lock');
    expect(press('ג', { code: 'KeyD' })).toBe('duplicate');
    expect(press('ש', { code: 'KeyA', ctrlKey: true })).toBe('select-all');
    expect(press('a', { metaKey: true })).toBe('select-all');
    expect(press('H', { shiftKey: true })).toBeNull();
    expect(press('h', { ctrlKey: true })).toBeNull();
  });

  it('reads a Latin letter as typed, so AZERTY’s A and Z keys match their labels', () => {
    expect(press('a', { code: 'KeyQ', ctrlKey: true })).toBe('select-all');
    expect(press('q', { code: 'KeyA', ctrlKey: true })).toBeNull();
  });

  it('deletes with Delete, and with Backspace on a Mac only', () => {
    expect(press('Delete')).toBe('delete');
    expect(press('Backspace')).toBeNull();
    expect(press('Backspace', {}, true)).toBe('delete');
    expect(press('Delete', { ctrlKey: true })).toBeNull();
  });

  it('leaves other keys alone, the context-menu keys included (the contextmenu event opens the menu)', () => {
    expect(press('F10', { shiftKey: true })).toBeNull();
    expect(press('ContextMenu')).toBeNull();
    expect(press('ArrowUp')).toBeNull();
    expect(press('x')).toBeNull();
  });

  it('labels the shortcuts with the Mac symbols on a Mac', () => {
    expect(shortcutLabel('front', true)).toBe('⌥⇧↑');
    expect(shortcutLabel('front', false)).toBe('Alt+Shift+↑');
    expect(shortcutLabel('delete', true)).toBe('⌫');
    expect(shortcutLabel('select-all', false)).toBe('Ctrl+A');
  });
});

describe('historyShortcut', () => {
  const press = (key: string, init: KeyboardEventInit = {}, apple = false) =>
    historyShortcut(new KeyboardEvent('keydown', { key, ...init }), apple);

  it('undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y off a Mac', () => {
    expect(press('z', { ctrlKey: true })).toBe('undo');
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(press('y', { ctrlKey: true })).toBe('redo');
    expect(press('z', { metaKey: true })).toBeNull();
    expect(press('z')).toBeNull();
    expect(press('z', { ctrlKey: true, altKey: true })).toBeNull();
  });

  it('undoes with Cmd+Z and redoes with Shift+Cmd+Z on a Mac, where Ctrl+Z and Cmd+Y do nothing', () => {
    expect(press('z', { metaKey: true }, true)).toBe('undo');
    expect(press('z', { metaKey: true, shiftKey: true }, true)).toBe('redo');
    expect(press('z', { ctrlKey: true }, true)).toBeNull();
    expect(press('y', { metaKey: true }, true)).toBeNull();
  });

  it('works on non-Latin and AZERTY layouts', () => {
    expect(press('ז', { code: 'KeyZ', ctrlKey: true })).toBe('undo');
    expect(press('z', { code: 'KeyW', ctrlKey: true })).toBe('undo');
    expect(press('w', { code: 'KeyZ', ctrlKey: true })).toBeNull();
  });

  it('labels and names the shortcuts per platform', () => {
    expect([historyLabel('undo', true), historyLabel('redo', true)]).toEqual(['⌘Z', '⇧⌘Z']);
    expect([historyLabel('undo', false), historyLabel('redo', false)]).toEqual(['Ctrl+Z', 'Ctrl+Shift+Z']);
    expect(historyKeyShortcuts('redo', false)).toBe('Control+Shift+Z Control+Y');
    expect(historyKeyShortcuts('undo', true)).toBe('Meta+Z');
  });
});

describe('isTextEntry', () => {
  const input = (type: string) => Object.assign(document.createElement('input'), { type });

  it('is true where typing goes, whose undo is the browser’s', () => {
    expect(isTextEntry(document.createElement('textarea'))).toBe(true);
    expect(isTextEntry(input('text'))).toBe(true);
    expect(isTextEntry(input('number'))).toBe(true);
    expect(isTextEntry(input('checkbox'))).toBe(false);
    expect(isTextEntry(input('color'))).toBe(false);
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
