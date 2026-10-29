import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { DOCS_GROUPS, DOCS_PAGES } from './app.routes';
import { OnThisPage } from './on-this-page';
import { PageOutline } from './page-outline';
import { ThemeService } from './theme';

/** The repository, for the header's GitHub link and the "Edit this page" links. */
const REPO = 'https://github.com/ido-lempert/Taleart';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, OnThisPage],
  selector: 'docs-root',
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly pages = DOCS_PAGES;
  /** The navigation: each subject is a collapsible section, in order. */
  protected readonly groups = DOCS_GROUPS.map((name) => ({
    name,
    pages: DOCS_PAGES.filter((page) => page.group === name),
  }));
  /** The open sections. The current page's section is always open (prerendered too), the rest follow the reader's clicks. */
  private readonly openGroups = signal<ReadonlySet<string>>(new Set());
  /** On narrow screens the navigation is hidden until the reader opens it with the Menu button. */
  protected readonly menuOpen = signal(false);
  protected readonly theme = inject(ThemeService);
  /** Built after each navigation: the "On this page" list, the heading links and the scroll-spy. */
  private readonly outline = inject(PageOutline);
  protected readonly repo = REPO;
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly nav = viewChild.required<ElementRef<HTMLElement>>('nav');
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');
  /** The address of the current page, as the router reports it after each navigation. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** The docs page shown, or null (the not-found page). */
  protected readonly page = computed(() => {
    const path = this.url()
      .split(/[?#]/)[0]
      .replace(/^\/|\/$/g, '');
    return DOCS_PAGES.find((page) => page.path === path) ?? null;
  });
  /** The pages before and after the current one, in navigation order. */
  protected readonly neighbours = computed(() => {
    const page = this.page();
    const index = page ? DOCS_PAGES.indexOf(page) : -1;
    return {
      previous: index > 0 ? DOCS_PAGES[index - 1] : null,
      next: index >= 0 && index < DOCS_PAGES.length - 1 ? DOCS_PAGES[index + 1] : null,
    };
  });
  /** The page's source on GitHub, for "Edit this page". */
  protected readonly editUrl = computed(() => {
    const page = this.page();
    return page ? `${REPO}/edit/main/apps/docs/src/app/pages/${page.file}.ts` : null;
  });
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
      this.menuOpen.set(false);
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

  /** The Menu button: opens the navigation (focus moves into it) or closes it (focus returns to the button). */
  protected toggleMenu(): void {
    if (this.menuOpen()) this.closeMenu(true);
    else this.openMenu();
  }

  /** Closes the navigation; with `restoreFocus`, the keyboard goes back to the Menu button. */
  protected closeMenu(restoreFocus = false): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    if (restoreFocus) afterNextRender(() => this.menuButton().nativeElement.focus(), { injector: this.injector });
  }

  private openMenu(): void {
    this.menuOpen.set(true);
    // The panel is visible only after this render; its first link takes the focus then.
    afterNextRender(() => setTimeout(() => this.focusables()[0]?.focus()), { injector: this.injector });
  }

  /** Escape closes the open navigation; Tab stays inside it, since the page behind it is inert. */
  @HostListener('document:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    if (!this.menuOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu(true);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first) return;
    const nav = this.nav().nativeElement;
    const active = nav.ownerDocument.activeElement;
    if (!nav.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }

  /** The navigation's controls the keyboard can reach: rendered ones (a closed section's links are not). */
  private focusables(): HTMLElement[] {
    return [
      ...this.nav().nativeElement.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary'),
    ].filter((el) => el.getClientRects().length > 0);
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
