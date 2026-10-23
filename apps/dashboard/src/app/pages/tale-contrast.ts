// Tale Studio's contrast checks of labels (epic Tale Studio R7, R12, story 7.10): what lies behind
// each label, which labels have low contrast, and what a change did to them. Pure functions over the
// document; the colours read behind labels over media come from `samples` (see `BackdropReads`).
import { elementName, isOffCanvas, type TaleDocument } from '@taleart/contract/tale-document';
import { textBackdropAt, textContrast, type TextBackdrop } from '@taleart/contract/text-style';
import { backdropKey, hasLabel, type BackdropResults, type WantedRead } from './tale-backdrop';
import { labelStyleOf } from './tale-canvas-view';

/** The colours read behind a label, by its `backdropKey`: null when they cannot be read, undefined while being read. */
export type SampleLookup = (key: string) => ReturnType<BackdropResults['get']>;

/**
 * What lies behind the label at `index` of `doc` (R12): the contract's colour when it can work
 * one out, else the colours read from the layers below it (see `TaleBackdropSampler`).
 */
export function labelBackdrop(doc: TaleDocument, index: number, base: TextBackdrop, samples: SampleLookup): TextBackdrop {
  const backdrop = textBackdropAt(doc.elements, index, base);
  const label = doc.elements[index];
  // Wholly off the canvas, no one sees it: nothing to judge.
  if (label && isOffCanvas(label.box)) return { ...backdrop, offCanvas: true };
  return backdrop.overMedia ? { ...backdrop, samples: samples(backdropKey(doc, index)) } : backdrop;
}

/** The labels of `doc` whose colours behind must be read: shown, on the canvas and over media. */
export function wantedReads(doc: TaleDocument, base: TextBackdrop): WantedRead[] {
  const wanted: WantedRead[] = [];
  doc.elements.forEach((element, index) => {
    if (element.hidden || !hasLabel(element) || isOffCanvas(element.box)) return;
    if (!textBackdropAt(doc.elements, index, base).overMedia) return;
    wanted.push({ key: backdropKey(doc, index), index });
  });
  return wanted;
}

/** True when the label of the element at `index` (a text, a button or the swipe-up link) has low contrast (R7, R12). */
export function isLowContrast(doc: TaleDocument | null, index: number, base: TextBackdrop, samples: SampleLookup): boolean {
  const element = doc?.elements[index];
  const style = element ? labelStyleOf(element) : null;
  return !!doc && style !== null && textContrast(style, labelBackdrop(doc, index, base, samples)).kind === 'low';
}

/** The ids of the texts and links of `doc` with low contrast against what lies behind each (R7, R12). */
export function lowContrastIds(doc: TaleDocument, samples: SampleLookup): Set<string> {
  const base: TextBackdrop = {
    canvasColor: doc.canvas.background.color,
    // The tale's own media (R16) is an element, which `textBackdropAt` meets on its way down.
    overMedia: doc.canvas.background.type === 'media',
  };
  const low = new Set<string>();
  doc.elements.forEach((e, i) => {
    if (!e.hidden && isLowContrast(doc, i, base, samples)) low.add(e.id);
  });
  return low;
}

/**
 * What a change did to the contrast of texts other than `restylingId`, the one being restyled
 * (which says it itself): a move, reorder, hide or restyle of another layer can turn a text's
 * verdict (R12).
 */
export function contrastChange(
  before: TaleDocument,
  next: TaleDocument,
  restylingId: string | null,
  samples: SampleLookup,
): string {
  const was = lowContrastIds(before, samples);
  const now = lowContrastIds(next, samples);
  const notes: string[] = [];
  next.elements.forEach((e, i) => {
    if (labelStyleOf(e) === null || e.id === restylingId || was.has(e.id) === now.has(e.id)) return;
    if (!now.has(e.id) && !before.elements.some((b) => b.id === e.id)) return;
    const name = elementName(next.elements, i);
    notes.push(now.has(e.id) ? `"${name}" now has low contrast.` : `"${name}" has enough contrast now.`);
  });
  return notes.join(' ');
}
