import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { THEME_KEY, ThemeService } from './theme';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.removeItem(THEME_KEY);
    TestBed.inject(DOCUMENT).documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.removeItem(THEME_KEY);
    TestBed.inject(DOCUMENT).documentElement.removeAttribute('data-theme');
  });

  it('switches the theme, marks the page with it, and saves the choice', () => {
    const theme = TestBed.inject(ThemeService);
    const html = TestBed.inject(DOCUMENT).documentElement;
    theme.toggle();
    expect(theme.dark()).toBe(true);
    expect(html.dataset['theme']).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    theme.toggle();
    expect(theme.dark()).toBe(false);
    expect(html.dataset['theme']).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('starts with the saved choice', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    expect(TestBed.inject(ThemeService).dark()).toBe(true);
  });

  it('starts with the system theme when nothing is saved, and sets no attribute', () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('dark'), media: q, addEventListener: () => {} })) as never;
    try {
      const theme = TestBed.inject(ThemeService);
      expect(theme.dark()).toBe(true);
      expect(TestBed.inject(DOCUMENT).documentElement.hasAttribute('data-theme')).toBe(false);
    } finally {
      window.matchMedia = real;
    }
  });

  it('ignores a saved value that is not a theme', () => {
    localStorage.setItem(THEME_KEY, 'purple');
    const theme = TestBed.inject(ThemeService);
    expect(['light', 'dark']).toContain(theme.theme());
  });
});
