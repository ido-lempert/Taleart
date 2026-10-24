import {
  NEW_TEXT_BOX,
  TALE_ELEMENT_TYPE_REGISTRY,
  TALE_SAFE_AREA,
  TALE_TEST_ELEMENT_TYPES,
} from '@taleart/contract/tale-document';
import { resolveTextStyle } from '@taleart/contract/text-style';
import { STUDIO_TYPE_DESCRIPTORS, studioElementTypes, TEXT_PRESETS } from './tale-element-types';
import { newTextProps } from './tale-canvas-view';
import {
  elementCount,
  foldSearch,
  PALETTE_GROUPS,
  paletteGroups,
  paletteTiles,
  tileKeyTarget,
  tileMatches,
} from './tale-palette';

// Tale Studio 2 story 11.3 (epic R2): the palette from the registry and each descriptor's entry.
const tiles = paletteTiles(studioElementTypes());
const ids = (query = '') => paletteGroups(tiles, query).map((g) => [g.name, g.tiles.map((t) => t.id)]);

describe('the element palette (epic Tale Studio 2 R2)', () => {
  it('has a tile for every registry key, and every tile comes from a registered type', () => {
    const keys = TALE_ELEMENT_TYPE_REGISTRY.map((t) => t.key);
    for (const key of keys) expect(tiles.some((t) => t.type.key === key), key).toBe(true);
    expect(tiles.every((t) => keys.includes(t.type.key))).toBe(true);
    // Every registered type has migrated to a palette entry: nothing falls back to More in production.
    expect(Object.entries(STUDIO_TYPE_DESCRIPTORS).filter(([, d]) => !d.palette).map(([k]) => k)).toEqual([]);
    expect(new Set(tiles.map((t) => t.id)).size).toBe(tiles.length);
  });

  it('groups the tiles in the designed categories and order', () => {
    expect(ids()).toEqual([
      [
        'Text',
        ['studio-add-heading', 'studio-add-subheading', 'studio-add-text', 'studio-add-caption', 'studio-add-label'],
      ],
      ['Media', ['studio-add-image', 'studio-add-video']],
      ['Shapes', ['studio-add-rectangle', 'studio-add-ellipse', 'studio-add-line']],
      ['Stickers & emoji', ['studio-add-emoji', 'studio-add-sticker']],
      ['Buttons & links', ['studio-add-button', 'studio-add-image-button', 'studio-add-swipe-up']],
      ['Interactive', ['studio-add-poll', 'studio-add-rating', 'studio-add-quiz']],
    ]);
    expect(PALETTE_GROUPS.map((g) => g.name)).toEqual([
      'Text',
      'Media',
      'Shapes',
      'Stickers & emoji',
      'Buttons & links',
      'Interactive',
      'More',
    ]);
  });

  it('names each tile "Add …" with its word shown, one icon per shape kind', () => {
    const byId = new Map(tiles.map((t) => [t.id, t]));
    expect(byId.get('studio-add-heading')).toMatchObject({ word: 'heading', name: 'Add heading' });
    expect(byId.get('studio-add-text')).toMatchObject({ word: 'body text', name: 'Add body text' });
    expect(byId.get('studio-add-swipe-up')).toMatchObject({ word: 'swipe-up link', name: 'Add swipe-up link' });
    expect(['rectangle', 'ellipse', 'line'].map((k) => byId.get(`studio-add-${k}`)?.icon)).toEqual([
      'rectangle',
      'ellipse',
      'line',
    ]);
    expect(byId.get('studio-add-line')?.action).toEqual({ kind: 'shape', shape: 'line' });
    expect(byId.get('studio-add-image')).toMatchObject({ needsProject: true, action: { kind: 'media', media: 'image' } });
    expect(byId.get('studio-add-poll')?.limit?.hintId).toBe('studio-poll-hint');
  });

  it('draws text presets in their style, largest for the heading', () => {
    const sample = (id: string) => tiles.find((t) => t.id === `studio-add-${id}`)?.sample;
    // In its size, and never wider than the tile: a long word shrinks with the tile's width (cqi).
    expect(sample('heading')).toEqual({ fontSize: 'clamp(9px, 23cqi, 18px)', fontWeight: 700, fontStyle: 'normal', boxed: false });
    expect(sample('subheading')).toMatchObject({ fontSize: 'clamp(9px, 16cqi, 15px)', fontWeight: 500 });
    expect(sample('text')).toMatchObject({ fontSize: 'clamp(9px, 17cqi, 13px)', fontWeight: 400 });
    expect(sample('caption')).toMatchObject({ fontSize: 'clamp(9px, 23cqi, 11px)', fontStyle: 'italic' });
    expect(sample('label')).toMatchObject({ boxed: true });
    expect(sample('poll')).toBeUndefined();
  });

  it('adds body text exactly as the studio added text before presets, bold, though its tile is lighter', () => {
    const body = TEXT_PRESETS.find((p) => p.id === 'text');
    expect({ ...newTextProps('Text'), ...body?.props }).toEqual(newTextProps('Text'));
    expect(body?.box).toBeUndefined();
  });

  it('finds tiles by everyday synonyms', () => {
    expect(ids('votes')).toEqual([['Interactive', ['studio-add-poll']]]);
    expect(ids('survey')).toEqual([['Interactive', ['studio-add-poll']]]);
    expect(ids('call to action')).toEqual([
      ['Buttons & links', ['studio-add-button', 'studio-add-image-button', 'studio-add-swipe-up']],
    ]);
    expect(ids('cta').map(([name]) => name)).toEqual(['Buttons & links']);
    expect(ids('link').map(([name]) => name)).toEqual(['Buttons & links']);
  });

  it('gives text presets valid style props and boxes inside the safe area', () => {
    for (const preset of TEXT_PRESETS) {
      const props = { ...newTextProps('Text'), ...preset.props };
      // Every value passes its rule: reading the style back changes nothing.
      const { text, ...style } = props;
      expect(text, preset.id).toBeTruthy();
      expect(resolveTextStyle(props), preset.id).toEqual(style);
      const box = preset.box ?? NEW_TEXT_BOX;
      expect(box.y, preset.id).toBeGreaterThanOrEqual(TALE_SAFE_AREA.top);
      expect(box.y + box.h, preset.id).toBeLessThanOrEqual(1 - TALE_SAFE_AREA.bottom);
      expect(box.x, preset.id).toBeGreaterThanOrEqual(TALE_SAFE_AREA.side);
      expect(box.x + box.w, preset.id).toBeLessThanOrEqual(1 - TALE_SAFE_AREA.side);
    }
  });

  it('finds tiles by label, keyword and category, ignoring case and accents', () => {
    expect(ids('vote')).toEqual([['Interactive', ['studio-add-poll']]]);
    expect(ids('POLL')).toEqual([['Interactive', ['studio-add-poll']]]);
    expect(ids('text')[0]).toEqual([
      'Text',
      ['studio-add-heading', 'studio-add-subheading', 'studio-add-text', 'studio-add-caption', 'studio-add-label'],
    ]);
    expect(ids('circle')).toEqual([['Shapes', ['studio-add-ellipse']]]);
    expect(ids('media').map(([name]) => name)).toEqual(['Media']);
    expect(ids('emoji slider')).toEqual([['Interactive', ['studio-add-rating']]]);
    expect(ids('  cta   link ').map(([name]) => name)).toEqual(['Buttons & links']);
    expect(ids('zzz')).toEqual([]);
    expect(foldSearch('  Café  Noir ')).toBe('cafe noir');
    const heading = tiles.find((t) => t.id === 'studio-add-heading');
    expect(heading && tileMatches(heading, 'Héad')).toBe(true);
  });

  it('counts what it finds', () => {
    expect([0, 1, 3].map(elementCount)).toEqual(['No elements', '1 element', '3 elements']);
  });

  it('shows a type without a palette entry under More, added by its create', () => {
    const more = paletteTiles(studioElementTypes({ testTypes: true })).filter((t) => t.group === 'more');
    expect(more.map((t) => [t.id, t.name, t.icon, t.action.kind])).toEqual([
      ['studio-add-test-badge', 'Add test badge', 'puzzle', 'configured'],
    ]);
    expect(TALE_TEST_ELEMENT_TYPES.map((t) => t.key)).toEqual(['test-badge']);
    const groups = paletteGroups(paletteTiles(studioElementTypes({ testTypes: true })));
    expect(groups.at(-1)?.name).toBe('More');
    expect(paletteGroups(paletteTiles(studioElementTypes({ testTypes: true })), 'test badge').map((g) => g.name)).toEqual([
      'More',
    ]);
  });
});

describe('moving between tiles with keys (EXPERIENCE Accessibility)', () => {
  // Two groups: three tiles on a row and one below, then (another group) two tiles.
  const rects = [
    { top: 0, left: 0 },
    { top: 0, left: 80 },
    { top: 0, left: 160 },
    { top: 74, left: 0 },
    { top: 180, left: 0 },
    { top: 180, left: 80 },
  ];

  it('goes left and right in reading order, stopping at the ends', () => {
    expect(tileKeyTarget(rects, 2, 'ArrowRight')).toBe(3);
    expect(tileKeyTarget(rects, 3, 'ArrowLeft')).toBe(2);
    expect(tileKeyTarget(rects, 0, 'ArrowLeft')).toBeNull();
    expect(tileKeyTarget(rects, 5, 'ArrowRight')).toBeNull();
  });

  it('goes up and down by rows, to the nearest tile, across groups, and up to the search', () => {
    expect(tileKeyTarget(rects, 1, 'ArrowDown')).toBe(3);
    expect(tileKeyTarget(rects, 3, 'ArrowDown')).toBe(4);
    expect(tileKeyTarget(rects, 5, 'ArrowUp')).toBe(3);
    expect(tileKeyTarget(rects, 4, 'ArrowDown')).toBeNull();
    expect(tileKeyTarget(rects, 1, 'ArrowUp')).toBe('search');
  });

  it('goes to the first and last with Home and End, and ignores other keys', () => {
    expect(tileKeyTarget(rects, 3, 'Home')).toBe(0);
    expect(tileKeyTarget(rects, 3, 'End')).toBe(5);
    expect(tileKeyTarget(rects, 0, 'Home')).toBeNull();
    expect(tileKeyTarget(rects, 3, 'a')).toBeNull();
    expect(tileKeyTarget([], 0, 'ArrowDown')).toBeNull();
  });
});
