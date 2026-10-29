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

/** The intrinsic size of a PNG (from its IHDR chunk) or an SVG (from its viewBox). */
function intrinsicSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(join(IMAGES, file));
  if (file.endsWith('.png')) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  const [, , , width, height] = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(bytes.toString('utf8'))!.map(Number);
  return { width, height };
}

describe('the Web guide page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/guides/web');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('has the eleven steps, in order, as a numbered list', () => {
    const steps = [...page.querySelectorAll('ol.steps > li')];
    expect(steps.length).toBe(11);
    expect(steps[0].textContent).toContain('Issue the zone key');
    expect(steps[1].textContent).toContain('Add the script once per page');
    expect(steps[2].textContent).toContain('Place the zone');
    expect(steps[3].textContent).toContain('Optional: set options once for the page');
    expect(steps[4].textContent).toContain('Listen to the hooks');
    expect(steps[5].textContent).toContain('Verify with the test page');
    expect(steps[6].textContent).toContain("Show a placeholder when stories can't load");
    expect(steps[7].textContent).toContain('Limit how often a group shows');
    expect(steps[8].textContent).toContain('Add a countdown or a promo code');
    expect(steps[9].textContent).toContain('Listen for component events');
    expect(steps[10].textContent).toContain('Add a reaction');
  });

  it('gives every step a figure with an image, its alt text, its size and a caption', () => {
    for (const step of page.querySelectorAll('ol.steps > li')) {
      const figures = [...step.querySelectorAll('figure')];
      expect(figures.length, step.querySelector('strong')?.textContent ?? '').toBeGreaterThan(0);
      for (const figure of figures) {
        const img = figure.querySelector('img');
        expect(img?.getAttribute('alt')?.trim().length ?? 0, img?.getAttribute('src') ?? '').toBeGreaterThan(20);
        expect(figure.querySelector('figcaption')?.textContent?.trim()).toBeTruthy();
        expect(img?.getAttribute('width')).toMatch(/^\d+$/);
        expect(img?.getAttribute('height')).toMatch(/^\d+$/);
      }
    }
  });

  it('points only at images that exist, sized as the files are', () => {
    for (const img of page.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? '';
      expect(src.startsWith('/images/web-')).toBe(true);
      const file = src.slice('/images/'.length);
      expect(existsSync(join(IMAGES, file)), file).toBe(true);
      expect({ file, width: Number(img.getAttribute('width')), height: Number(img.getAttribute('height')) }).toEqual({
        file,
        ...(() => {
          const { width, height } = intrinsicSize(file);
          return { width: Math.round(width), height: Math.round(height) };
        })(),
      });
    }
  });

  it('shows the same element markup as the docs snippet, with the zone key placeholder', () => {
    expect(page.textContent).toContain('<taleart-view zone-key="YOUR_ZONE_KEY"></taleart-view>');
  });
});
