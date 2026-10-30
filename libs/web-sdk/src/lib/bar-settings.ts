import type { BarSettings } from '@taleart/contract';

/** The frame type this renderer draws (AD-5). */
export const BAR_FRAME_TYPE = 'bar';

/** The layouts a bar can take (epic end-user redesign P4), as the contract's frame schema lists them. */
export const BAR_LAYOUTS = ['ring', 'chip', 'poster', 'stack'] as const;

/** One of {@link BAR_LAYOUTS}. */
export type BarLayout = (typeof BAR_LAYOUTS)[number];

/** The bar's defaults, as `libs/contract/frame-types/bar.schema.json` defines them (R2, P4). */
export const BAR_DEFAULTS: Readonly<BarSettings> = {
  layout: 'ring',
  shape: 'circle',
  size: 'medium',
  showTitles: true,
  alignment: 'start',
  gap: 12,
};

/** The values each enum setting accepts, as the schema lists them. */
export const BAR_CHOICES = {
  layout: BAR_LAYOUTS,
  shape: ['circle', 'rounded-square'],
  size: ['small', 'medium', 'large'],
  alignment: ['start', 'center'],
} as const;

/** The gap's range in px, as the schema sets it. */
export const BAR_GAP_RANGE = { min: 4, max: 24 } as const;

/**
 * The settings each layout does not use (the dashboard's display options say the same, for its drawer):
 * a chip ignores the shape; a poster the shape and the size; a stack the shape, the titles, the alignment
 * and the gap (its size still applies). A ring uses them all.
 */
export const BAR_IGNORED: Readonly<Record<BarLayout, readonly (keyof BarSettings)[]>> = {
  ring: [],
  chip: ['shape'],
  poster: ['shape', 'size'],
  stack: ['shape', 'showTitles', 'alignment', 'gap'],
};

/** Each size's cover edge in px, for the ring. */
export const BAR_SIZE_PX: Readonly<Record<BarSettings['size'], number>> = { small: 48, medium: 64, large: 80 };

/** Each size's cover edge in px, for a chip (its round cover beside the title). */
export const CHIP_COVER_PX: Readonly<Record<BarSettings['size'], number>> = { small: 24, medium: 32, large: 40 };

/** Each size's avatar edge in px, for the collapsed stack. */
export const STACK_COVER_PX: Readonly<Record<BarSettings['size'], number>> = { small: 32, medium: 40, large: 48 };

/** The most tale segments a poster card draws; a longer group shows this many. */
export const POSTER_MAX_SEGMENTS = 12;

/** The most covers a collapsed stack overlaps; the rest count in its "+N" bubble. */
export const STACK_MAX_COVERS = 4;

function oneOf<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

/** The layout a value names, or null when it names none (an attribute, for the loading skeleton). */
export function barLayoutOf(value: unknown): BarLayout | null {
  return BAR_LAYOUTS.find((layout) => layout === value) ?? null;
}

/**
 * The bar settings to render: each field the Delivery API sent when it is
 * valid, else its default. The API validates on write and fills defaults, so
 * this only guards against an older or broken response; it never logs. A
 * missing layout (a response from before P4) is the ring.
 */
export function readBarSettings(raw: unknown): BarSettings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const gap = s['gap'];
  return {
    layout: oneOf(BAR_CHOICES.layout, s['layout'], BAR_DEFAULTS.layout as BarLayout),
    shape: oneOf(BAR_CHOICES.shape, s['shape'], BAR_DEFAULTS.shape),
    size: oneOf(BAR_CHOICES.size, s['size'], BAR_DEFAULTS.size),
    showTitles: typeof s['showTitles'] === 'boolean' ? s['showTitles'] : BAR_DEFAULTS.showTitles,
    alignment: oneOf(BAR_CHOICES.alignment, s['alignment'], BAR_DEFAULTS.alignment),
    gap:
      Number.isInteger(gap) && (gap as number) >= BAR_GAP_RANGE.min && (gap as number) <= BAR_GAP_RANGE.max
        ? (gap as number)
        : BAR_DEFAULTS.gap,
  };
}
