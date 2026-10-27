import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DOCS_GROUPS, DOCS_PAGES } from './app.routes';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'docs-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly pages = DOCS_PAGES;
  /** The navigation: each subject is a collapsible section, in order. */
  protected readonly groups = DOCS_GROUPS.map((name) => ({ name, pages: DOCS_PAGES.filter((page) => page.group === name) }));
  /** The open sections. The current page's section is always open (prerendered too), the rest follow the reader's clicks. */
  private readonly openGroups = signal<ReadonlySet<string>>(new Set());
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  /**
   * The skip link's target: this page's own URL and `#main`. A bare `#main` resolves against the
   * `<base href>`, so it would open the home page instead (the docs' base is `/`, or `/Taleart/` on
   * GitHub Pages). Prerendered with each page, so it works without JavaScript too.
   */
  protected readonly skipHref = signal(this.mainHref());

  constructor() {
    this.openGroups.set(new Set([this.activeGroup()]));
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const ends = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(),
    );
    ends.subscribe((event) => {
      this.skipHref.set(this.mainHref());
      // The first load (id 1) opens only the page's section; later navigations keep what the reader opened.
      this.openGroups.update((open) => new Set([...(event.id > 1 ? open : []), this.activeGroup()]));
    });
    // After a navigation inside the docs (not the first load, id 1), focus the new page's heading, so
    // a screen reader announces it and the keyboard continues from it.
    ends
      .pipe(filter((event) => event.id > 1))
      .subscribe(() => setTimeout(() => host.querySelector<HTMLElement>('main h1')?.focus()));
  }

  private mainHref(): string {
    return `${this.location.prepareExternalUrl(this.router.url.split(/[?#]/)[0])}#main`;
  }

  protected isOpen(group: string): boolean {
    return this.openGroups().has(group);
  }

  protected onToggle(group: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.openGroups.update((groups) => {
      const next = new Set(groups);
      if (open) next.add(group);
      else next.delete(group);
      return next;
    });
  }

  private activeGroup(): string {
    const path = this.router.url.split(/[?#]/)[0].replace(/^\/|\/$/g, '');
    return DOCS_PAGES.find((page) => page.path === path)?.group ?? DOCS_GROUPS[0];
  }
}
