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

  it('ignores a saved value that is not a theme', () => {
    localStorage.setItem(THEME_KEY, 'purple');
    const theme = TestBed.inject(ThemeService);
    expect(['light', 'dark']).toContain(theme.theme());
  });
});
