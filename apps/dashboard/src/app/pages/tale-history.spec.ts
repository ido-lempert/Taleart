import type { TaleDocument } from '@taleart/contract/tale-document';
import { changeCount, HISTORY_LIMIT, MERGE_WINDOW_MS, sameDocument, TaleHistory } from './tale-history';

// A document told apart by its background colour; each call makes a new object.
function doc(n: number): TaleDocument {
  return {
    version: 1,
    canvas: { background: { type: 'color', color: `#${String(n).padStart(6, '0')}` } },
    elements: [],
  };
}

describe('TaleHistory', () => {
  it('undoes and redoes ten steps in order, returning the very documents it was given', () => {
    const history = new TaleHistory();
    const docs = Array.from({ length: 11 }, (_, i) => doc(i));
    for (let i = 1; i <= 10; i++) history.record(`Step ${i}`, docs[i - 1], docs[i]);
    expect(history.undoLabel).toBe('Step 10');
    for (let i = 10; i >= 1; i--) expect(history.undo()).toEqual({ document: docs[i - 1], label: `Step ${i}` });
    expect(history.undo()).toBeNull();
    expect(history.redoLabel).toBe('Step 1');
    for (let i = 1; i <= 10; i++) expect(history.redo()?.document).toBe(docs[i]);
    expect(history.redo()).toBeNull();
  });

  it(`keeps the last ${HISTORY_LIMIT} steps, at least 100, dropping the oldest`, () => {
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(100);
    const history = new TaleHistory();
    const docs = Array.from({ length: HISTORY_LIMIT + 11 }, (_, i) => doc(i));
    for (let i = 1; i < docs.length; i++) history.record(`Step ${i}`, docs[i - 1], docs[i]);
    expect(history.depth).toBe(HISTORY_LIMIT);
    let last = null;
    for (let i = 0; i < HISTORY_LIMIT; i++) last = history.undo();
    expect(last?.document).toBe(docs[10]);
    expect(history.undo()).toBeNull();
  });

  it('merges changes with the same key that follow on within the window, as typing a word', () => {
    const history = new TaleHistory();
    const [a, b, c, d, e] = [0, 1, 2, 3, 4].map(doc);
    history.record('Text edited', a, b, 'text:1', 0);
    history.record('Text edited', b, c, 'text:1', 400);
    history.record('Text edited', c, d, 'text:1', 400 + MERGE_WINDOW_MS);
    // A pause past the window starts a new step.
    history.record('Text edited', d, e, 'text:1', 401 + 2 * MERGE_WINDOW_MS);
    expect(history.depth).toBe(2);
    expect(history.undo()?.document).toBe(d);
    expect(history.undo()?.document).toBe(a);
  });

  it('does not merge another key, a step that does not follow on, or after an undo or a seal', () => {
    const history = new TaleHistory();
    const [a, b, c, d, e, f] = [0, 1, 2, 3, 4, 5].map(doc);
    history.record('Text edited', a, b, 'text:1', 0);
    history.record('Text edited', b, c, 'text:2', 10);
    history.record('Text edited', d, e, 'text:2', 20);
    expect(history.depth).toBe(3);
    history.seal();
    history.record('Text edited', e, f, 'text:2', 30);
    expect(history.depth).toBe(4);
    history.undo();
    history.record('Text edited', e, f, 'text:2', 40);
    expect(history.depth).toBe(4);
    expect(history.undo()?.document).toBe(e);
    expect(history.undo()?.document).toBe(d);
  });

  it('clears what could be redone on a new step, ignores no-op changes, and forgets everything on clear', () => {
    const history = new TaleHistory();
    const [a, b, c] = [0, 1, 2].map(doc);
    history.record('One', a, b);
    history.undo();
    history.record('Two', a, c);
    expect(history.redo()).toBeNull();
    history.record('Nothing', c, c);
    expect(history.depth).toBe(1);
    history.clear();
    expect([history.depth, history.undoLabel, history.redoLabel]).toEqual([0, null, null]);
  });
});

describe('sameDocument', () => {
  it('compares by content, whatever the order of keys, and tells null apart', () => {
    const a = doc(1);
    const b = { elements: [], canvas: { background: { color: '#000001', type: 'color' } }, version: 1 } as TaleDocument;
    expect(sameDocument(a, b)).toBe(true);
    expect(sameDocument(a, doc(2))).toBe(false);
    expect(sameDocument(a, null)).toBe(false);
    expect(sameDocument(null, null)).toBe(true);
  });
});

describe('changeCount (epic UX rework R15)', () => {
  const layer = (id: string, text: string) =>
    ({
      id,
      type: 'text',
      box: { x: 0, y: 0, w: 1, h: 0.1, rotation: 0 },
      hidden: false,
      locked: false,
      a11y: {},
      props: { text },
    }) as unknown as TaleDocument['elements'][number];
  const site: TaleDocument = { ...doc(1), elements: [layer('a', 'A'), layer('b', 'B'), layer('c', 'C')] };

  it('is 0 for the same document and counts each layer when nothing is on the site', () => {
    expect(changeCount(site, { ...site, elements: [...site.elements] })).toBe(0);
    expect(changeCount(site, null)).toBe(3);
    expect(changeCount(doc(1), null)).toBe(1);
  });

  it('counts layers added, removed and changed, a new order, and a change to the tale itself', () => {
    expect(changeCount({ ...site, elements: [layer('a', 'A2'), layer('b', 'B'), layer('c', 'C')] }, site)).toBe(1);
    expect(changeCount({ ...site, elements: [layer('a', 'A'), layer('c', 'C'), layer('d', 'D')] }, site)).toBe(2);
    expect(changeCount({ ...site, elements: [layer('c', 'C'), layer('a', 'A'), layer('b', 'B')] }, site)).toBe(1);
    expect(changeCount({ ...doc(2), elements: site.elements }, site)).toBe(1);
    expect(changeCount({ ...doc(2), elements: [layer('a', 'A2'), layer('b', 'B'), layer('c', 'C')] }, site)).toBe(2);
  });
});
