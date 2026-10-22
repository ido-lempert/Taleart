import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { installSnippet, SDK_BUNDLE_PATH, SDK_TEST_PAGE_PATH, testPageLink } from '@taleart/contract/core';
import { App } from './app';
import { appRoutes, DOCS_PAGES } from './app.routes';

const api = 'https://api.example.com';
const info = { apiUrl: api, sdkUrl: api + SDK_BUNDLE_PATH, testPageUrl: api + SDK_TEST_PAGE_PATH };

describe('docs app', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(appRoutes)],
    }).compileComponents();
  });

  it('links every page from the navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav[aria-label="Docs"] a')];
    expect(links.map((a) => a.textContent?.trim())).toEqual(DOCS_PAGES.map((page) => page.label));
  });

  it('opens on Getting started with the snippet', async () => {
    const harness = await RouterTestingHarness.create('/');
    const text = harness.routeNativeElement?.textContent ?? '';
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Getting started');
    expect(text).toContain(installSnippet(info, 'home-top', null));
  });

  it('shows the Install tab snippet, the hosted and pinned SDK and the test page on Install a zone', async () => {
    const harness = await RouterTestingHarness.create('/install');
    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('#docs-snippet')?.textContent).toBe(installSnippet(info, 'home-top', null));
    expect(page.textContent).toContain(`${api}/sdk/v1/taleart.js`);
    expect(page.textContent).toContain('integrity="sha384-…"');
    expect(page.textContent).toContain(testPageLink(info, 'home-top', 'YOUR_SITE_KEY'));
    expect(page.textContent).toContain("configureZone('home-top'");
  });

  it('lists the glossary on Concepts', async () => {
    const harness = await RouterTestingHarness.create('/concepts');
    const terms = [...(harness.routeNativeElement as HTMLElement).querySelectorAll('#glossary tbody th')].map((th) =>
      th.childNodes[0].textContent?.trim(),
    );
    expect(terms).toEqual(['Project', 'Zone', 'Display', 'Template', 'Tale group', 'Tale', 'Theme', 'Site key']);
  });

  it('says that zone keys and stage were removed, and how to move', async () => {
    const harness = await RouterTestingHarness.create('/moving-from-stages');
    const text = (harness.routeNativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Zone keys and the stage attribute were removed');
    expect(text).toContain('Home – Bar 2');
    expect(text).toContain('top-bar-2');
    expect(text).toContain(installSnippet(info, 'home-top', null));
  });

  it('shows a not-found page for an unknown path', async () => {
    const harness = await RouterTestingHarness.create('/no-such-page');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Page not found');
  });

  it('labels every code block and table scroll region and keeps it focusable', async () => {
    const harness = await RouterTestingHarness.create();
    for (const page of ['/', '/concepts', '/install', '/moving-from-stages']) {
      await harness.navigateByUrl(page);
      const regions = [...(harness.routeNativeElement as HTMLElement).querySelectorAll('pre, .table-wrap')];
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region.getAttribute('tabindex')).toBe('0');
        expect(region.getAttribute('role')).toBe('region');
        expect(region.getAttribute('aria-label') || region.getAttribute('aria-labelledby')).toBeTruthy();
      }
    }
  });

  it('captions the attribute table', async () => {
    const harness = await RouterTestingHarness.create('/install');
    expect((harness.routeNativeElement as HTMLElement).querySelector('#attributes caption')?.textContent).toContain(
      'Attributes',
    );
  });

  it('focuses the new page heading after a navigation', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    await router.navigateByUrl('/concepts');
    await fixture.whenStable();
    await new Promise((done) => setTimeout(done));
    expect(document.activeElement?.textContent).toBe('Concepts');
  });
});
