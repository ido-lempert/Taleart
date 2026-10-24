import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DOCS_PAGES } from './app.routes';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  selector: 'docs-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly pages = DOCS_PAGES;
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  /**
   * The skip link's target: this page's own URL and `#main`. A bare `#main` resolves against the
   * `<base href>`, so it would open the home page instead (the docs' base is `/`, or `/Taleart/` on
   * GitHub Pages). Prerendered with each page, so it works without JavaScript too.
   */
  protected readonly skipHref = signal(this.mainHref());

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const ends = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      takeUntilDestroyed(),
    );
    ends.subscribe(() => this.skipHref.set(this.mainHref()));
    // After a navigation inside the docs (not the first load, id 1), focus the new page's heading, so
    // a screen reader announces it and the keyboard continues from it.
    ends
      .pipe(filter((event) => event.id > 1))
      .subscribe(() => setTimeout(() => host.querySelector<HTMLElement>('main h1')?.focus()));
  }

  private mainHref(): string {
    return `${this.location.prepareExternalUrl(this.router.url.split(/[?#]/)[0])}#main`;
  }
}
