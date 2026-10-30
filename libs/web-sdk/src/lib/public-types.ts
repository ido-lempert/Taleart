// The types of the SDK's public API, spelled out here so the published declarations stand on their own:
// `@taleart/contract` is not a dependency of the published package. `public-types.spec-d.ts` keeps them
// equal to the contract's schema types.

/** How a group's ring is drawn (R9). */
export type RingStyle = 'gradient' | 'solid' | 'none';

/** Which colour scheme the display draws: `auto` follows the host page's `prefers-color-scheme`. */
export type ColorScheme = 'auto' | 'light' | 'dark';

/** The reading direction: `auto` (the default) takes the host page's, `ltr` and `rtl` set it (`dir` on `<taleart-view>`, or `init({ dir })`). */
export type DirOption = 'auto' | 'ltr' | 'rtl';

/** A viewer property's value: text, a number, a yes or no, or a list of texts (see `setProperties`). */
export type ViewerPropertyValue = string | number | boolean | readonly string[];

/** The viewer's properties, as {@link init} and `setProperties` take them. */
export type ViewerProperties = Readonly<Record<string, ViewerPropertyValue>>;

/** A full theme (R9): the project's theme as the Delivery API sends it, every field filled. */
export interface Theme {
  ringStyle: RingStyle;
  /** One to three `#rrggbb` colours. */
  ringColors: string[];
  /** `#rrggbb`. */
  seenRingColor: string;
  /** Pixels, 1 to 4. */
  ringWidth: number;
  /** Pixels, 0 to 32; `null` keeps the frame's own radius. */
  cornerRadius: number | null;
  /** A font list; `null` takes the host page's font. */
  fontFamily: string | null;
  /** `#rrggbb`; `null` takes the host page's title colour. */
  titleColor: string | null;
  /** `transparent` or `#rrggbb`. */
  backgroundColor: string;
  /** `#rrggbb`. */
  accentColor: string;
  /** `auto` (the default) follows the host page's colour scheme. */
  colorScheme: ColorScheme;
  /** `#rrggbb`; `null` takes the last ring colour (the live badge). */
  liveColor: string | null;
  /** `#rrggbb`: a right quiz answer. */
  successColor: string;
  /** `#rrggbb`: a wrong quiz answer. */
  errorColor: string;
}
