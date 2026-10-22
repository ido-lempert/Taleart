import { IMPORTED_BUTTON_BOX, TALE_SAFE_AREA, type TaleDocument } from '@taleart/contract';
import { findImportedButton, importedButtonElement, withImportedButton } from './imported-button';
import { checkPublishableDocument } from './tale-document';

const ID = '00000000-0000-4000-8000-0000000000b1';
const SALE = { label: 'Shop now', href: 'https://shop.example/sale' };

const media = {
  id: '00000000-0000-4000-8000-0000000000a1',
  type: 'image',
  box: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
  hidden: false,
  locked: false,
  a11y: { decorative: true },
  props: { mediaKey: 'tales/0a.png', fit: 'contain', taleMedia: true },
};

const withMedia = (): TaleDocument =>
  ({ version: 1, canvas: { background: { type: 'color', color: '#000000' } }, elements: [media] }) as TaleDocument;

describe('the button an import carries (epic Tale Studio R17)', () => {
  it('sits centred at the bottom of the safe area, looking like a new button, opening in the same tab', () => {
    const element = importedButtonElement(ID, SALE);
    expect(IMPORTED_BUTTON_BOX.y + IMPORTED_BUTTON_BOX.h).toBeCloseTo(1 - TALE_SAFE_AREA.bottom, 10);
    expect(IMPORTED_BUTTON_BOX.x + IMPORTED_BUTTON_BOX.w / 2).toBeCloseTo(0.5, 10);
    expect(element).toMatchObject({ type: 'button', box: IMPORTED_BUTTON_BOX, props: { ...SALE, variant: 'filled' } });
    expect(element.props).not.toHaveProperty('newTab');
  });

  it('makes a publishable 5 s document for a tale with none, and adds on top of an existing one', () => {
    const made = withImportedButton(null, ID, null, SALE) as TaleDocument;
    expect(made.durationMs).toBe(5000);
    expect(() => checkPublishableDocument(made)).not.toThrow();
    expect(findImportedButton(made, ID)).toEqual(SALE);
    const doc = withMedia();
    const added = withImportedButton(doc, ID, null, SALE) as TaleDocument;
    expect(added.elements.map((e) => e.type)).toEqual(['image', 'button']);
    expect(doc.elements).toHaveLength(1);
    // Already there: nothing changes.
    expect(withImportedButton(added, ID, null, SALE)).toBe(added);
    // A new button needs both values.
    expect(withImportedButton(doc, ID, null, { label: 'x' })).toBe(doc);
  });

  it('sets a value only where the document still holds the value merged, keeping the rest of the button', () => {
    const doc = withImportedButton(withMedia(), ID, null, SALE) as TaleDocument;
    const relabelled = withImportedButton(doc, ID, SALE, { label: 'Buy now' }) as TaleDocument;
    expect(findImportedButton(relabelled, ID)).toEqual({ ...SALE, label: 'Buy now' });
    expect(relabelled.elements[1]).toMatchObject({ box: IMPORTED_BUTTON_BOX, props: { fill: '#FFFFFF' } });
    // A document whose label a person changed keeps it.
    expect(withImportedButton(relabelled, ID, SALE, { label: 'Other' })).toBe(relabelled);
    // The same value: the same object.
    expect(withImportedButton(doc, ID, SALE, SALE)).toBe(doc);
    expect(withImportedButton(null, ID, SALE, SALE)).toBeNull();
  });

  it('finds only a button with that id', () => {
    const doc = withImportedButton(withMedia(), ID, null, SALE) as TaleDocument;
    expect(findImportedButton(doc, media.id)).toBeNull();
    expect(findImportedButton(doc, '00000000-0000-4000-8000-0000000000ff')).toBeNull();
    expect(findImportedButton(null, ID)).toBeNull();
  });
});
