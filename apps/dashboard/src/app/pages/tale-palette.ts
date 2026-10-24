// The Elements tab's palette (epic Tale Studio 2 R2, EXPERIENCE Left panel tabs and Registry fit):
// every studio element type as tiles, from each descriptor's `palette` entry, in categories, found
// by a search over labels and keywords. Pure, so the studio's template stays simple and this is
// unit tested on its own.
import { TEXT_WEIGHTS, type TextWeight } from '@taleart/contract/text-style';
import type { IconName } from '../icon';
import type { AddAction, AddLimit, PaletteCategory, PalettePreset, StudioElementType } from './tale-element-types';

/** A palette group: one of the descriptors' categories, or More for a type without a palette entry. */
export type PaletteGroupKey = PaletteCategory | 'more';

/** The palette's groups, in the order the Elements tab shows them, with their headings. */
export const PALETTE_GROUPS: readonly { key: PaletteGroupKey; name: string }[] = [
  { key: 'text', name: 'Text' },
  { key: 'media', name: 'Media' },
  { key: 'shapes', name: 'Shapes' },
  { key: 'stickers', name: 'Stickers & emoji' },
  { key: 'actions', name: 'Buttons & links' },
  { key: 'interactive', name: 'Interactive' },
  { key: 'more', name: 'More' },
];

/** How a text preset's tile draws its word: in the preset's size, weight and slant, boxed for a label. */
export interface TileSample {
  fontSize: string;
  fontWeight: number;
  fontStyle: 'italic' | 'normal';
  boxed: boolean;
}

/** One tile of the palette: a way to add an element of a type. */
export interface PaletteTile {
  /** The button's id: `studio-add-<preset id>`, else `studio-add-<type key>`. */
  id: string;
  /** What the tile shows, its first letter raised by the tile's style: "heading", "swipe-up link". */
  word: string;
  /** Its accessible name: "Add heading" (the shown word is in it, WCAG 2.5.3). */
  name: string;
  icon: IconName;
  group: PaletteGroupKey;
  action: AddAction;
  needsProject: boolean;
  limit?: AddLimit;
  /** The preset it adds, if the type offers several. */
  preset?: PalettePreset;
  type: StudioElementType;
  /** The words it is found by, folded for matching: its label, its type's, its group's, the keywords. */
  terms: readonly string[];
  /** For a text preset: how the tile draws its word. */
  sample?: TileSample;
}

/** A group of tiles as the Elements tab shows it. */
export interface PaletteGroup {
  key: PaletteGroupKey;
  name: string;
  tiles: readonly PaletteTile[];
}

/** Lower case without accents, so "Café" finds "cafe" and "VOTE" finds "vote". */
export function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// The tile size a text preset is drawn at: its size on the canvas (a fraction of its height) on a
// ladder from 11 px (Caption) to 18 px (Heading), 2 to 3 px between presets, in the Text group's
// two columns. A narrow tile (the stacked panels under 1024 px) caps it by the tile's width (cqi,
// about 0.6 em a letter, 9 px at least), so a long word ("Subheading") never breaks.
function sampleOf(word: string, props: Readonly<Record<string, unknown>> | undefined): TileSample {
  const size = typeof props?.['size'] === 'number' ? props['size'] : 0.04;
  const weight = props?.['weight'];
  const px = Math.min(18, Math.max(11, Math.round(4.3 + size * 228.6)));
  return {
    fontSize: `clamp(9px, ${Math.floor(100 / (Math.max(word.length, 1) * 0.62))}cqi, ${px}px)`,
    fontWeight: typeof weight === 'string' && weight in TEXT_WEIGHTS ? TEXT_WEIGHTS[weight as TextWeight] : 700,
    fontStyle: props?.['italic'] === true ? 'italic' : 'normal',
    boxed: props?.['background'] === 'box',
  };
}

/**
 * The palette's tiles, one per preset of each type (or one for the type), in registry order. A
 * type without a palette entry gets one tile under More, added by its descriptor's `create`, so a
 * registered type never disappears (R2).
 */
export function paletteTiles(types: readonly StudioElementType[]): PaletteTile[] {
  const groupName = new Map(PALETTE_GROUPS.map((g) => [g.key, g.name]));
  return types.flatMap((type) => {
    const palette = type.palette;
    const group: PaletteGroupKey = palette?.category ?? 'more';
    const shared = [type.label, groupName.get(group) ?? '', ...(palette?.keywords ?? [])];
    const presets: readonly (PalettePreset | undefined)[] = palette?.presets?.length ? palette.presets : [undefined];
    return presets.map((preset): PaletteTile => {
      const label = preset?.label ?? type.label;
      const action = preset?.action ?? palette?.action ?? { kind: 'configured' };
      return {
        id: `studio-add-${preset?.id ?? type.key}`,
        word: lowerFirst(label),
        name: `Add ${lowerFirst(label)}`,
        icon: preset?.icon ?? palette?.icon ?? 'puzzle',
        group,
        action,
        needsProject: palette?.needsProject ?? false,
        limit: palette?.limit,
        preset,
        type,
        terms: [label, ...shared, ...(preset?.keywords ?? [])].map(foldSearch),
        sample: action.kind === 'text' ? sampleOf(label, { ...preset?.props, ...preset?.tileProps }) : undefined,
      };
    });
  });
}

/**
 * True when every word of the query starts a word of the tile's terms ("rect" finds Rectangle, but
 * "cta" does not find it inside "rectangle", nor "rect" inside "correct"); an empty query matches all.
 */
export function tileMatches(tile: PaletteTile, query: string): boolean {
  const words = foldSearch(query).split(' ').filter(Boolean);
  const starts = tile.terms.flatMap((term) => [term, ...term.split(/[\s-]+/)]);
  return words.every((word) => starts.some((start) => start.startsWith(word)));
}

/**
 * The tiles matching the query in their groups, in the palette's order: by group, then the type's
 * `order` (registry order between equals), then the preset's place. Empty groups are left out.
 */
export function paletteGroups(tiles: readonly PaletteTile[], query = ''): PaletteGroup[] {
  const order = (tile: PaletteTile) => tile.type.palette?.order ?? 0;
  return PALETTE_GROUPS.flatMap(({ key, name }) => {
    const found = tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.group === key && tileMatches(tile, query))
      .sort((a, b) => order(a.tile) - order(b.tile) || a.index - b.index)
      .map(({ tile }) => tile);
    return found.length ? [{ key, name, tiles: found }] : [];
  });
}

/** "1 element", "3 elements", or "No elements" for none. */
export function elementCount(count: number): string {
  return count === 0 ? 'No elements' : count === 1 ? '1 element' : `${count} elements`;
}

/** Where a tile sits on screen: enough to move between tiles by rows. */
export interface TileRect {
  top: number;
  left: number;
}

/**
 * Where an arrow key, Home or End moves from the tile at `index` among `rects` (in reading order):
 * Left and Right to the tile before or after; Up and Down to the nearest tile in the row above or
 * below, across groups; Home and End to the first and last tile; Up from the top row to the
 * search field. Null when it stays (an end, or another key).
 */
export function tileKeyTarget(rects: readonly TileRect[], index: number, key: string): number | 'search' | null {
  const last = rects.length - 1;
  const here = rects[index];
  if (!here) return null;
  switch (key) {
    case 'ArrowRight':
      return index < last ? index + 1 : null;
    case 'ArrowLeft':
      return index > 0 ? index - 1 : null;
    case 'Home':
      return index === 0 ? null : 0;
    case 'End':
      return index === last ? null : last;
    case 'ArrowDown':
    case 'ArrowUp': {
      const down = key === 'ArrowDown';
      const rows = rects.filter((r) => (down ? r.top > here.top + 1 : r.top < here.top - 1)).map((r) => r.top);
      if (rows.length === 0) return down ? null : 'search';
      const row = down ? Math.min(...rows) : Math.max(...rows);
      let best: number | null = null;
      rects.forEach((r, i) => {
        if (Math.abs(r.top - row) > 1) return;
        if (best === null || Math.abs(r.left - here.left) < Math.abs(rects[best].left - here.left)) best = i;
      });
      return best;
    }
    default:
      return null;
  }
}
