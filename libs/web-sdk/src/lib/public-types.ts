// The types of the SDK's public API, spelled out here so the published declarations stand on their own:
// `@taleart/contract` is not a dependency of the published package. `public-types.spec-d.ts` keeps them
// equal to the contract's schema types.

/** How a group's ring is drawn (R9). */
export type RingStyle = 'gradient' | 'solid' | 'none';

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
}
