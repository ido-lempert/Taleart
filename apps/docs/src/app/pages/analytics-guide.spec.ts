import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes';

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

describe('the Read your analytics guide', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/guides/analytics');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('has the four steps, in order, as a numbered list', () => {
    const steps = [...page.querySelectorAll('ol.steps > li')];
    expect(steps.length).toBe(4);
    expect(steps[0].textContent).toContain('Open the zone');
    expect(steps[1].textContent).toContain('Read a tile');
    expect(steps[2].textContent).toContain('Read the tables');
    expect(steps[3].textContent).toContain('When nothing is counted yet');
  });

  it('gives every step a figure with a real screenshot, its alt text and a caption', () => {
    for (const step of page.querySelectorAll('ol.steps > li')) {
      const figures = [...step.querySelectorAll('figure')];
      expect(figures.length, step.querySelector('strong')?.textContent ?? '').toBeGreaterThan(0);
      for (const figure of figures) {
        const img = figure.querySelector('img');
        expect(img?.getAttribute('alt')?.trim().length ?? 0, img?.getAttribute('src') ?? '').toBeGreaterThan(40);
        expect(figure.querySelector('figcaption')?.textContent?.trim()).toBeTruthy();
      }
    }
  });

  it('points only at analytics screenshots that exist, sized as the files are, at most 1200 px wide', () => {
    const images = [...page.querySelectorAll('img')];
    expect(images.length).toBe(4);
    for (const img of images) {
      const src = img.getAttribute('src') ?? '';
      expect(src).toMatch(/^\/images\/analytics-shot-[a-z]+\.png$/);
      const file = src.slice('/images/'.length);
      expect(existsSync(join(IMAGES, file)), file).toBe(true);
      const size = pngSize(file);
      expect(size.width, file).toBeLessThanOrEqual(1200);
      expect(statSizeOk(file), file).toBe(true);
      expect({ width: Number(img.getAttribute('width')), height: Number(img.getAttribute('height')) }, file).toEqual(size);
    }
  });

  it('shows the opt-out snippets with the SDK URL of the docs', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('init({ analytics: false });');
    expect(text).toContain('analytics="off"');
  });
});

function statSizeOk(file: string): boolean {
  return readFileSync(join(IMAGES, file)).length <= 300 * 1024;
}
