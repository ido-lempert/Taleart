import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from './app.routes';

/** The guides with numbered steps: each step's title is a heading with an id, so "On this page" lists the steps. */
const GUIDES = ['/guides/web', '/android-guide', '/ios-guide', '/guides/analytics', '/guides/sign-in-methods'];

describe('guide step headings', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
  });

  for (const path of GUIDES) {
    it(`gives every step of ${path} a heading with a kebab-case id, listed in "On this page"`, async () => {
      const harness = await RouterTestingHarness.create(path);
      const page = harness.routeNativeElement as HTMLElement;
      const steps = [...page.querySelectorAll('ol.steps > li')];
      expect(steps.length).toBeGreaterThan(0);
      const ids = steps.map((step) => {
        const heading = step.querySelector(':scope > h2[id], :scope > h3[id]');
        expect(heading, step.textContent?.slice(0, 60)).not.toBeNull();
        expect(heading?.textContent?.trim().length ?? 0).toBeGreaterThan(3);
        return heading?.id ?? '';
      });
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(new Set(ids).size).toBe(ids.length);
      // The page's own headings (with ids) are what "On this page" lists: every step is among them.
      const listed = new Set([...page.querySelectorAll('h2[id], h3[id]')].map((el) => el.id));
      for (const id of ids) expect(listed.has(id), id).toBe(true);
      expect(new Set([...page.querySelectorAll('[id]')].map((el) => el.id)).size).toBe(
        page.querySelectorAll('[id]').length,
      );
    });
  }
});
