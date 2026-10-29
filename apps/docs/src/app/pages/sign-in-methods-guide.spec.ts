import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes, DOCS_PAGES } from '../app.routes';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const IMAGES = join(workspaceRoot(), 'apps/docs/public/images');

/** The intrinsic size of a PNG, from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(join(IMAGES, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the Sign-in methods guide', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/guides/sign-in-methods');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('has the ten steps, in order, as a numbered list', () => {
    const steps = [...page.querySelectorAll('ol.steps > li')];
    expect(steps.length).toBe(10);
    const headings = steps.map((step) => step.querySelector('strong')?.textContent?.trim() ?? '');
    expect(headings[0]).toBe('Open Settings > Sign-in methods.');
    expect(headings[1]).toBe('Turn on username and password.');
    expect(headings[2]).toBe('Add Google.');
    expect(headings[3]).toBe('Add a generic OpenID Connect provider.');
    expect(headings[4]).toBe('Add Apple.');
    expect(headings[5]).toBe('See the methods on the sign-in page.');
    expect(headings[6]).toBe('Invite someone to join with a provider or a password.');
    expect(headings[7]).toBe('Let each user manage their own methods.');
    expect(headings[8]).toBe('Issue a one-time reset link for a user who forgot the password.');
    expect(headings[9]).toBe('Turn a method off safely.');
  });

  it('explains the secret key before the steps, with the command that generates it', () => {
    const before = page.querySelector('#before-you-start');
    expect(before).toBeTruthy();
    const text = page.textContent ?? '';
    expect(text).toContain('TALEART_SECRET_KEY');
    expect(text).toContain('openssl rand -base64 32');
    expect(text).toContain('Provider secrets cannot be saved yet');
  });

  it('names the first-admin password variable and its value', () => {
    expect(page.textContent).toContain('TALEART_SETUP_PASSWORD=true');
  });

  it('points at the redirect URI path for a provider, and to the lock-out message', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('/api/v1/auth/callback/');
    expect(text).toContain('That would leave an admin with no way to sign in.');
  });

  it('links only to pages the docs have', () => {
    const paths = new Set(DOCS_PAGES.map((p) => `/${p.path}`));
    const links = [...page.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');
    const internal = links.filter((href) => href.startsWith('/'));
    expect(internal).toContain('/reference/sign-in-methods');
    expect(internal).toContain('/projects-and-team');
    for (const href of internal) expect(paths.has(href.split('#')[0]), href).toBe(true);
  });

  it('gives each step a real screenshot, with alt text and a caption, except step 7, which has none yet', () => {
    // Step 7 (the invitation page) has no screenshot: a fresh /invite/:token page offers only the passkey, so a picture of it would
    // contradict the step. Add its figure when that page loads the sign-in methods.
    const steps = [...page.querySelectorAll('ol.steps > li')];
    steps.forEach((step, index) => {
      const figures = [...step.querySelectorAll('figure')];
      if (index === 6) {
        expect(figures.length).toBe(0);
        return;
      }
      expect(figures.length, step.querySelector('strong')?.textContent ?? '').toBe(1);
      const img = figures[0].querySelector('img');
      const src = img?.getAttribute('src') ?? '';
      expect(img?.getAttribute('alt')?.trim().length ?? 0, src).toBeGreaterThan(40);
      expect(figures[0].querySelector('figcaption')?.textContent?.trim(), src).toBeTruthy();
      const file = src.replace(/^\/images\//, '');
      expect(existsSync(join(IMAGES, file)), file).toBe(true);
      expect(statSync(join(IMAGES, file)).size, file).toBeLessThanOrEqual(300 * 1024);
      const size = pngSize(file);
      expect(size.width, file).toBeLessThanOrEqual(1200);
      expect(String(size.width), file).toBe(img?.getAttribute('width'));
      expect(String(size.height), file).toBe(img?.getAttribute('height'));
    });
  });

  it('does not name any competing product other than the identity providers it configures', () => {
    const text = (page.textContent ?? '').toLowerCase();
    expect(text).not.toContain('another tool');
  });
});
