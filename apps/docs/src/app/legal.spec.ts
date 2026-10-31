import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ANALYTICS_RETENTION_DAYS, CHALLENGE_COOKIE, OAUTH_COOKIE, SESSION_COOKIE } from '@taleart/contract/core';
import { App } from './app';
import { appRoutes, DOCS_PAGES } from './app.routes';

// The legal pages (ticket 17): the three texts, linked from the footer and the navigation, that state what
// the code does. The facts they give are checked against the source, so a change of the code shows here.

const ISSUES = 'https://github.com/ido-lempert/Taleart/issues';
const LEGAL = ['legal/terms', 'legal/privacy', 'legal/accessibility'] as const;

function workspaceFile(path: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    try {
      return readFileSync(join(dir, path), 'utf8');
    } catch {
      dir = join(dir, '..');
    }
  }
  throw new Error(`${path} not found`);
}

describe('legal pages', () => {
  beforeEach(async () => {
    harness = undefined;
    await TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(appRoutes)] }).compileComponents();
  });

  let harness: RouterTestingHarness | undefined;

  async function open(path: string): Promise<{ page: HTMLElement; text: string }> {
    harness ??= await RouterTestingHarness.create();
    await harness.navigateByUrl('/' + path);
    const page = harness.routeNativeElement as HTMLElement;
    return { page, text: (page.textContent ?? '').replace(/\s+/g, ' ') };
  }

  it('lists the three pages in a Legal group of the navigation', () => {
    const pages = DOCS_PAGES.filter((p) => p.group === 'Legal');
    expect(pages.map((p) => [p.path, p.label])).toEqual([
      ['legal/terms', 'Terms of service'],
      ['legal/privacy', 'Privacy policy'],
      ['legal/accessibility', 'Accessibility statement'],
    ]);
  });

  it('links Terms, Privacy, Accessibility and GitHub from a footer on every page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('footer a')];
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Terms', '/legal/terms'],
      ['Privacy', '/legal/privacy'],
      ['Accessibility', '/legal/accessibility'],
      ['GitHub', 'https://github.com/ido-lempert/Taleart'],
    ]);
  });

  for (const path of LEGAL) {
    it(`${path}: one h1, h2 sections with unique ids, a dated version, the issues contact and no personal e-mail or phone`, async () => {
      const { page, text } = await open(path);
      expect(page.querySelectorAll('h1').length).toBe(1);
      const ids = [...page.querySelectorAll('h2')].map((h) => h.id);
      expect(ids.length).toBeGreaterThan(4);
      expect(ids.every((id) => id !== '')).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
      expect(text).toContain('31 October 2026');
      expect([...page.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain(ISSUES);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text).not.toMatch(/\+?\d[\d\s().-]{8,}\d/);
      // In-page links go through the router (a bare "#id" would resolve against the base href "/").
      expect([...page.querySelectorAll('a')].filter((a) => (a.getAttribute('href') ?? '').startsWith('#'))).toEqual([]);
    });
  }

  it('terms: name the owner, the licence, the disclaimers and Israeli law', async () => {
    const { text } = await open('legal/terms');
    for (const part of [
      'Ido Lempert',
      'Apache License, version 2.0',
      'as is',
      'maximum extent permitted by law',
      'invitation',
      'State of Israel',
      'consent',
    ]) {
      expect(text, part).toContain(part);
    }
  });

  it('privacy: names the controller and the roles, the rights, and the three real cookies', async () => {
    const { text } = await open('legal/privacy');
    for (const part of ['Ido Lempert', 'controller', 'processor', 'Protection of Privacy Law', 'Not automated', 'portability']) {
      expect(text, part).toContain(part);
    }
    for (const cookie of [SESSION_COOKIE, CHALLENGE_COOKIE, OAUTH_COOKIE]) expect(text, cookie).toContain(cookie);
    expect(text).toContain(`${ANALYTICS_RETENTION_DAYS} days`);
  });

  it('privacy: lists each storage key the SDKs and the apps use, as the source spells it', async () => {
    const { text } = await open('legal/privacy');
    const sources = {
      'taleart.visitor': 'libs/web-sdk/src/lib/visitor.ts',
      'taleart.seen': 'libs/web-sdk/src/lib/seen.ts',
      'taleart.views': 'libs/web-sdk/src/lib/frequency.ts',
      'taleart.responses': 'libs/web-sdk/src/lib/responses.ts',
      'taleart-docs-theme': 'apps/docs/src/app/theme.ts',
      'taleart-docs:api-reference:api-url': 'apps/docs/src/app/pages/api-reference-spec.ts',
      'taleart.selectedProjectId': 'apps/dashboard/src/app/dashboard.store.ts',
      'taleart-banner-dismissed:': 'libs/web-sdk/src/lib/banner-variants.ts',
    };
    for (const [key, file] of Object.entries(sources)) {
      expect(workspaceFile(file), `${key} in ${file}`).toContain(key);
      expect(text, key).toContain(key);
    }
  });

  it('privacy: sets no cookie in the docs, the dashboard or the SDK code the text says set none', () => {
    for (const file of ['libs/web-sdk/src/lib/visitor.ts', 'libs/web-sdk/src/lib/analytics.ts', 'apps/docs/src/app/theme.ts']) {
      expect(workspaceFile(file), file).not.toMatch(/document\.cookie/);
    }
  });

  it('accessibility: states the WCAG 2.2 AA target, the checks and the known gaps, and a way to report', async () => {
    const { text } = await open('legal/accessibility');
    for (const part of ['WCAG', '2.2', 'axe-core', 'TalkBack', 'VoiceOver', 'Chromium', 'Known gaps', 'Accessibility']) {
      expect(text, part).toContain(part);
    }
  });

  it('never names a competing product', async () => {
    for (const path of LEGAL) {
      const { text } = await open(path);
      expect(text).not.toMatch(/\b(instagram|snapchat|storyly|firebase|mixpanel|google analytics)\b/i);
    }
  });
});
