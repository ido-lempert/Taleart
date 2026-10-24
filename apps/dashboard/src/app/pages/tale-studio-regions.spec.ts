import { LEFT_TABS, menuKeyTarget, nextRegionIndex, STUDIO_REGIONS, tabKeyTarget } from './tale-studio-regions';

describe('Tale Studio 2 regions and tabs (story 11.1)', () => {
  it('lists the five regions in focus order', () => {
    expect([...STUDIO_REGIONS]).toEqual(['top', 'left', 'canvas', 'inspector', 'strip']);
  });

  it('moves F6 forward and Shift+F6 back, wrapping at both ends', () => {
    expect(nextRegionIndex(0, 5, false)).toBe(1);
    expect(nextRegionIndex(4, 5, false)).toBe(0);
    expect(nextRegionIndex(0, 5, true)).toBe(4);
    expect(nextRegionIndex(3, 5, true)).toBe(2);
  });

  it('starts at the first region, or the last going back, from outside them all', () => {
    expect(nextRegionIndex(-1, 5, false)).toBe(0);
    expect(nextRegionIndex(-1, 5, true)).toBe(4);
    expect(nextRegionIndex(7, 5, false)).toBe(0);
    expect(nextRegionIndex(0, 0, false)).toBe(-1);
  });

  it('offers Elements, Templates, Media and Layers, Elements first', () => {
    expect(LEFT_TABS.map((t) => t.label)).toEqual(['Elements', 'Templates', 'Media', 'Layers']);
  });

  it('moves between tabs with the arrows either way, wrapping, and Home and End', () => {
    expect(tabKeyTarget('ArrowDown', 0, 4)).toBe(1);
    expect(tabKeyTarget('ArrowRight', 3, 4)).toBe(0);
    expect(tabKeyTarget('ArrowUp', 0, 4)).toBe(3);
    expect(tabKeyTarget('ArrowLeft', 2, 4)).toBe(1);
    expect(tabKeyTarget('Home', 2, 4)).toBe(0);
    expect(tabKeyTarget('End', 0, 4)).toBe(3);
    expect(tabKeyTarget('Enter', 0, 4)).toBeNull();
  });

  it('moves in a menu with Up and Down, wrapping, and Home and End; Left and Right do nothing', () => {
    expect(menuKeyTarget('ArrowDown', 2, 3)).toBe(0);
    expect(menuKeyTarget('ArrowUp', 0, 3)).toBe(2);
    expect(menuKeyTarget('Home', 2, 3)).toBe(0);
    expect(menuKeyTarget('End', 0, 3)).toBe(2);
    expect(menuKeyTarget('ArrowRight', 0, 3)).toBeNull();
  });
});
