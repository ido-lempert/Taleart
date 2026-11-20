/**
 * How the dashboard moves between its pages: the main pages in the rail's order, the way a page slides in, and the
 * swipe that moves to the next or the previous main page on a phone. The decisions are pure, so the spec checks them
 * without a browser.
 */

/** The main pages in the rail's order: a swipe and the slide direction follow it. */
export const MAIN_PAGES: readonly string[] = ['/zones', '/tale-groups', '/audience', '/projects', '/settings/api-tokens'];

/** Which way a page slides in: forward (to the right, as in a list) or back. */
export type NavDirection = 'forward' | 'back';

/** A swipe's step along the main pages: +1 to the next page, -1 to the previous, 0 for none. */
export type SwipeStep = -1 | 0 | 1;

/** A swipe must cover at least this many pixels, and be at most this slow (ms), to count. */
export const SWIPE_MIN_DISTANCE = 60;
export const SWIPE_MAX_MS = 500;

/** The path without its query or fragment. */
export function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

/** The index of a main page in the rail's order, or -1 for a page that is not one of them. */
export function mainPageIndex(path: string): number {
  const base = pathOf(path);
  return MAIN_PAGES.findIndex((page) => base === page || base.startsWith(`${page}/`));
}

/**
 * Between two main pages the slide follows the rail: moving down the rail slides forward. Any other navigation slides
 * forward, except a browser Back, which slides back.
 */
export function navDirection(fromUrl: string, toUrl: string, popped: boolean): NavDirection {
  const from = mainPageIndex(fromUrl);
  const to = mainPageIndex(toUrl);
  if (from >= 0 && to >= 0 && from !== to) return to > from ? 'forward' : 'back';
  return popped ? 'back' : 'forward';
}

/** A horizontal swipe to the left (the finger moves left) goes to the next page; to the right, to the previous. */
export function swipeStep(dx: number, dy: number, ms: number): SwipeStep {
  if (ms > SWIPE_MAX_MS) return 0;
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** The main page a swipe from `url` goes to, or null when there is none (not a main page, no swipe, or the edge). */
export function pageAfterSwipe(url: string, step: SwipeStep): string | null {
  const index = mainPageIndex(url);
  if (index < 0 || step === 0) return null;
  const next = index + step;
  return next >= 0 && next < MAIN_PAGES.length ? MAIN_PAGES[next] : null;
}

// The last page the router reported, and the direction of the navigation in progress. The router's events set them;
// the view transition reads the direction when it starts.
let currentUrl = '';
let pendingDirection: NavDirection = 'forward';

/** Called when a navigation starts: works out which way its page slides. */
export function noteNavigation(toUrl: string, popped: boolean): void {
  pendingDirection = navDirection(currentUrl || toUrl, toUrl, popped);
}

/** Called when a navigation ends: the page shown is now the current one. */
export function settleNavigation(url: string): void {
  currentUrl = pathOf(url);
}

/** The direction of the navigation in progress, for the view transition that shows its page. */
export function currentDirection(): NavDirection {
  return pendingDirection;
}
