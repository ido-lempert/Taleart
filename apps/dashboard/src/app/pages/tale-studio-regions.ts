// Tale Studio 2's shell (story 11.1): the five regions F6 moves between, and the left panel's tabs.
// Pure, so the keyboard rules are tested without a page.
import type { IconName } from '../icon';

/** The studio's regions in focus order (EXPERIENCE Information Architecture): F6 visits them in turn. */
export const STUDIO_REGIONS = ['top', 'left', 'canvas', 'inspector', 'strip'] as const;
export type StudioRegion = (typeof STUDIO_REGIONS)[number];

/**
 * The region F6 (forward) or Shift+F6 (back) moves to from region `at` among `count` regions,
 * wrapping at both ends. From outside every region (`at` is -1), F6 goes to the first and
 * Shift+F6 to the last.
 */
export function nextRegionIndex(at: number, count: number, back: boolean): number {
  if (count <= 0) return -1;
  if (at < 0 || at >= count) return back ? count - 1 : 0;
  return (at + (back ? count - 1 : 1)) % count;
}

/** The left panel's tabs, in order: Elements opens first. */
export const LEFT_TABS = [
  { id: 'elements', label: 'Elements', icon: 'plus' },
  { id: 'templates', label: 'Templates', icon: 'templates' },
  { id: 'media', label: 'Media', icon: 'image' },
  { id: 'layers', label: 'Layers', icon: 'layers' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
export type LeftTab = (typeof LEFT_TABS)[number]['id'];

/**
 * The tab a key moves to in the tab rail (WAI-ARIA tabs, automatic activation): the arrows move to
 * the next or previous tab, wrapping (Up and Down as the rail stands, Left and Right when it lies
 * along the top of a narrow window), Home and End to the first and the last. Null for any other key.
 */
export function tabKeyTarget(key: string, at: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (at + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (at + count - 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * The item a key moves to in an open menu (WAI-ARIA menu): Down and Up move, wrapping; Home and
 * End go to the ends. Null for any other key.
 */
export function menuKeyTarget(key: string, at: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return (at + 1) % count;
    case 'ArrowUp':
      return (at + count - 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
