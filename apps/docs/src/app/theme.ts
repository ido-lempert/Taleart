import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

/** The localStorage key of the reader's choice. `public/theme-init.js` reads it before the first paint. */
export const THEME_KEY = 'taleart-docs-theme';

/**
 * The docs' colour theme: the reader's saved choice, or the system's when there is none. The choice is the
 * `data-theme` attribute on <html>, which the tokens in styles.css follow; with no choice the attribute is
 * absent and `prefers-color-scheme` decides.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  /** The theme in use. On the server (the prerendered HTML) it is light; the browser corrects it at start. */
  readonly theme = signal<Theme>('light');
  readonly dark = computed(() => this.theme() === 'dark');

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const scheme = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    this.theme.set(this.saved() ?? (scheme?.matches ? 'dark' : 'light'));
    // Without a saved choice the page follows the system, including when it changes while the page is open.
    scheme?.addEventListener('change', () => {
      if (!this.saved()) this.theme.set(scheme.matches ? 'dark' : 'light');
    });
  }

  /** Switches the theme and saves the choice in this browser (not kept if storage is blocked). */
  toggle(): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.doc.documentElement.dataset['theme'] = next;
    try {
      this.doc.defaultView?.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage can be unavailable (private windows, blocked site data): the theme still changes for this page.
    }
  }

  private saved(): Theme | null {
    try {
      const value = this.doc.defaultView?.localStorage.getItem(THEME_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }
}
