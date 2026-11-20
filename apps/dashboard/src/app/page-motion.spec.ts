import {
  currentDirection,
  mainPageIndex,
  MAIN_PAGES,
  navDirection,
  noteNavigation,
  pageAfterSwipe,
  settleNavigation,
  swipeStep,
} from './page-motion';

describe('page motion', () => {
  it('orders the main pages as the rail shows them, and finds a page under its sub-paths', () => {
    expect(MAIN_PAGES).toEqual(['/zones', '/tale-groups', '/audience', '/projects', '/settings/api-tokens']);
    expect(mainPageIndex('/zones')).toBe(0);
    expect(mainPageIndex('/zones/abc123?tab=zone')).toBe(0);
    expect(mainPageIndex('/settings/api-tokens')).toBe(4);
    expect(mainPageIndex('/settings/team')).toBe(-1);
    expect(mainPageIndex('/tales/t1/studio')).toBe(-1);
  });

  it('slides forward down the rail, back up it, and back for a browser Back', () => {
    expect(navDirection('/zones', '/tale-groups', false)).toBe('forward');
    expect(navDirection('/audience', '/zones', false)).toBe('back');
    expect(navDirection('/zones', '/zones/abc', false)).toBe('forward');
    expect(navDirection('/zones/abc', '/zones', true)).toBe('back');
    expect(navDirection('/zones', '/zones', false)).toBe('forward');
  });

  it('reads a swipe: a fast, long, mostly horizontal move; left goes to the next page', () => {
    expect(swipeStep(-120, 10, 200)).toBe(1);
    expect(swipeStep(120, -10, 200)).toBe(-1);
    expect(swipeStep(-40, 0, 200)).toBe(0); // too short
    expect(swipeStep(-120, 90, 200)).toBe(0); // mostly vertical
    expect(swipeStep(-120, 0, 900)).toBe(0); // too slow
  });

  it('moves a swipe to the neighbouring main page, and stops at the ends', () => {
    expect(pageAfterSwipe('/tale-groups', 1)).toBe('/audience');
    expect(pageAfterSwipe('/tale-groups', -1)).toBe('/zones');
    expect(pageAfterSwipe('/zones', -1)).toBeNull();
    expect(pageAfterSwipe('/settings/api-tokens', 1)).toBeNull();
    expect(pageAfterSwipe('/tale-groups', 0)).toBeNull();
    expect(pageAfterSwipe('/zones/abc', 1)).toBe('/tale-groups');
    expect(pageAfterSwipe('/tales/t1/studio', 1)).toBeNull();
  });

  it('tracks the current page through the router events, so the next slide knows where it comes from', () => {
    settleNavigation('/zones?x=1');
    noteNavigation('/tale-groups', false);
    expect(currentDirection()).toBe('forward');
    settleNavigation('/tale-groups');
    noteNavigation('/zones', false);
    expect(currentDirection()).toBe('back');
    noteNavigation('/zones', true);
    expect(currentDirection()).toBe('back');
  });
});
