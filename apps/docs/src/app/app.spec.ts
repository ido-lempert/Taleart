import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { installSnippet, SDK_BUNDLE_PATH, SDK_TEST_PAGE_PATH, testPageLink } from '@taleart/contract/core';
import { App } from './app';
import { AGENT_SESSION } from './agent-session';
import { appRoutes, DOCS_PAGES } from './app.routes';
import { SKILL_DOWNLOAD_BASE, SKILL_FILES } from './skill-files';

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

  it('shows the agent skill on AI agents: install, the token, a session and every skill file (story 10.4)', async () => {
    const harness = await RouterTestingHarness.create('/ai-agents');
    const page = harness.routeNativeElement as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toBe('AI agents');
    expect([...page.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'What the skill does',
      'Safety rules',
      'Install it',
      'Give it a token',
      'An example session',
      'The skill',
    ]);
    const text = page.textContent ?? '';
    expect(text).toContain('taleart skill install --project');
    expect(text).toContain('~/.claude/skills/taleart');
    expect(text).toContain('TALEART_TOKEN');
    // Every skill file, whole, and a download link to it.
    const blocks = [...page.querySelectorAll('details pre')].map((pre) => pre.textContent);
    expect(blocks).toEqual(SKILL_FILES.map((f) => f.content));
    expect(SKILL_FILES[0].content).toMatch(/^---\nname: taleart\n/);
    const links = [...page.querySelectorAll<HTMLAnchorElement>('.downloads a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(SKILL_FILES.map((f) => SKILL_DOWNLOAD_BASE + f.path));
    // The session: every turn, its commands, and no credential.
    for (const turn of AGENT_SESSION) expect(text).toContain(turn.text);
    expect(text).toContain('$ taleart groups on Summer --project "Shop" --json');
    expect(text).not.toMatch(/tat_[A-Za-z0-9_-]{7,}|tas_[A-Za-z0-9_-]{7,}(?!…\[REDACTED\])/);
  });

  it('links AI agents from API tokens and API reference', async () => {
    const harness = await RouterTestingHarness.create();
    for (const path of ['/api-tokens', '/api-reference']) {
      await harness.navigateByUrl(path);
      const hrefs = [...(harness.routeNativeElement as HTMLElement).querySelectorAll('a')].map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/ai-agents');
    }
  });

  it('shows a not-found page for an unknown path', async () => {
    const harness = await RouterTestingHarness.create('/no-such-page');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Page not found');
  });

  it('labels every code block and table scroll region and keeps it focusable', async () => {
    const harness = await RouterTestingHarness.create();
    for (const page of ['/', '/concepts', '/install', '/moving-from-stages', '/ai-agents']) {
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
