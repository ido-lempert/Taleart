import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
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

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    // After a navigation inside the docs (not the first load, id 1), focus the new page's heading, so
    // a screen reader announces it and the keyboard continues from it.
    inject(Router)
      .events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd && event.id > 1),
        takeUntilDestroyed(),
      )
      .subscribe(() => setTimeout(() => host.querySelector<HTMLElement>('main h1')?.focus()));
  }
}
