import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { AppearanceService, shownAppearance } from './appearance';

// A device whose dark setting the test controls; the listener gets the change as the browser sends it.
function device(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: dark,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  };
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
  return {
    switchTo(nextDark: boolean) {
      query.matches = nextDark;
      for (const listener of listeners) listener({ matches: nextDark } as MediaQueryListEvent);
    },
  };
}

describe('shownAppearance', () => {
  it('shows an explicit choice as chosen, and System as the device setting', () => {
    expect(shownAppearance('light', true)).toBe('light');
    expect(shownAppearance('dark', false)).toBe('dark');
    expect(shownAppearance('system', true)).toBe('dark');
    expect(shownAppearance('system', false)).toBe('light');
  });
});

describe('AppearanceService', () => {
  const html = () => TestBed.inject(DOCUMENT).documentElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('paints the device setting under System, the default', () => {
    device(true);
    TestBed.inject(AppearanceService);
    expect(html().dataset['theme']).toBe('dark');
  });

  it('follows the device live under System, without a reload', () => {
    const phone = device(true);
    const service = TestBed.inject(AppearanceService);
    phone.switchTo(false);
    expect(html().dataset['theme']).toBe('light');
    expect(service.shown()).toBe('light');
    phone.switchTo(true);
    expect(html().dataset['theme']).toBe('dark');
  });

  it('keeps an explicit choice whatever the device says', () => {
    const phone = device(false);
    const service = TestBed.inject(AppearanceService);
    service.set('dark');
    expect(html().dataset['theme']).toBe('dark');
    phone.switchTo(true);
    expect(html().dataset['theme']).toBe('dark');

    service.set('light');
    phone.switchTo(false);
    expect(html().dataset['theme']).toBe('light');
    phone.switchTo(true);
    expect(html().dataset['theme']).toBe('light');
    expect(service.appearance()).toBe('light');
  });

  it('goes back to following the device when the choice is System again', () => {
    device(true);
    const service = TestBed.inject(AppearanceService);
    service.set('light');
    service.set('system');
    expect(html().dataset['theme']).toBe('dark');
  });

  it('still paints when the browser has no media queries', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const service = TestBed.inject(AppearanceService);
    service.set('dark');
    expect(html().dataset['theme']).toBe('dark');
  });
});
