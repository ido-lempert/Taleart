import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes, DOCS_PAGES } from '../app.routes';

describe('the Security and hardening page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/security');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('has a two-factor section with an id', () => {
    const heading = page.querySelector('h2#two-factor');
    expect(heading?.textContent?.trim()).toBe('Two-factor sign-in');
  });

  it('recommends Required, a real secret key, safe recovery codes and the lost-phone path', () => {
    const items = [...page.querySelectorAll('#two-factor + ul > li')].map((li) => li.textContent ?? '');
    expect(items.length).toBe(4);
    expect(items[0]).toContain('Required');
    expect(items[1]).toContain('TALEART_SECRET_KEY');
    expect(items[1]).toContain('.env.docker.example');
    expect(items[2]).toContain('recovery codes');
    expect(items[3]).toContain('no self-service recovery');
  });

  it('links only to pages the docs have', () => {
    const paths = new Set(DOCS_PAGES.map((p) => `/${p.path}`));
    const internal = [...page.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/'));
    expect(internal).toContain('/guides/sign-in-methods');
    for (const href of internal) expect(paths.has(href.split('#')[0]), href).toBe(true);
  });
});
