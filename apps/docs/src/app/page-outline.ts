import { DOCUMENT, Location } from '@angular/common';
import { afterNextRender, inject, Injectable, Injector, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** One heading of the page the reader is on, for "On this page". */
export interface OutlineHeading {
  id: string;
  text: string;
  level: 2 | 3;
  /** The page's own address and the heading's id, so the link works with the base href (`/Taleart/` on GitHub Pages). */
  href: string;
}

/** A heading whose top is this many pixels from the top of the window (or higher) is the current one: the sticky header's height. */
const CURRENT_LINE = 120;

/**
 * The outline of the page the reader is on, built in the browser after each navigation: the h2 and h3
 * headings that have an id, a "#" link on each for the section's address, and a scroll-spy that marks the
 * heading the reader is in. The prerendered HTML has none of this; it reads the same without JavaScript.
 */
@Injectable({ providedIn: 'root' })
export class PageOutline {
  readonly headings = signal<readonly OutlineHeading[]>([]);
  /** The id of the heading the reader is in, or null. */
  readonly current = signal<string | null>(null);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private observer: IntersectionObserver | null = null;

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.reset());
  }

  private reset(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.headings.set([]);
    this.current.set(null);
    // The new page renders after this navigation; its DOM is there once the next render has run.
    afterNextRender(() => this.collect(), { injector: this.injector });
  }

  private collect(): void {
    const main = this.doc.getElementById('main');
    if (!main) return;
    const base = this.location.prepareExternalUrl(this.router.url.split(/[?#]/)[0]);
    // The Swagger UI's own headings (the API reference) are not part of the page's outline.
    const elements = [...main.querySelectorAll<HTMLElement>('h2[id], h3[id]')].filter(
      (el) => !el.closest('.api-reference'),
    );
    const headings: OutlineHeading[] = elements.map((el) => {
      const text = [...el.childNodes]
        .filter((node) => !(node instanceof Element && node.classList.contains('heading-anchor')))
        .map((node) => node.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (!el.querySelector(':scope > .heading-anchor')) {
        const link = this.doc.createElement('a');
        link.className = 'heading-anchor';
        link.href = `${base}#${el.id}`;
        link.setAttribute('aria-label', 'Link to this section');
        link.textContent = '#';
        el.append(link);
      }
      return { id: el.id, text, level: el.tagName === 'H2' ? 2 : 3, href: `${base}#${el.id}` };
    });
    this.headings.set(headings);
    this.current.set(currentHeading(elements));

    const view = this.doc.defaultView;
    if (!view || !('IntersectionObserver' in view) || elements.length === 0) return;
    // The observer says when a heading crosses the reading line; the position is then read from the layout.
    this.observer = new view.IntersectionObserver(() => this.current.set(currentHeading(elements)), {
      rootMargin: `-${CURRENT_LINE}px 0px -50% 0px`,
    });
    for (const el of elements) this.observer.observe(el);
  }
}

/** The last heading that has reached the reading line, or the first heading above it. */
function currentHeading(elements: readonly HTMLElement[]): string | null {
  let current = elements[0]?.id ?? null;
  for (const el of elements) {
    if (el.getBoundingClientRect().top <= CURRENT_LINE) current = el.id;
  }
  return current;
}
