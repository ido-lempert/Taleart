import { existsSync, readFileSync, statSync } from 'node:fs';
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

describe('the Tale groups and tales guide', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/tale-groups-and-tales');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('explains selecting several groups, with the bar and the other lists', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('Select several tale groups with the checkboxes.');
    expect(text).toContain('Archive, Show in another zone and Copy to zone');
    expect(text).toContain('API tokens, team members, invitations, user lists, tales in a tale group, and fonts.');
  });

  it('shows the selection screenshot, with alt text, a caption and the file at its size', () => {
    const figure = page.querySelector('#select-several ~ figure');
    const img = figure?.querySelector('img');
    const src = img?.getAttribute('src') ?? '';
    expect(src).toBe('images/bulk-shot-tale-groups-selection.png');
    expect(img?.getAttribute('alt')?.trim().length ?? 0).toBeGreaterThan(40);
    expect(figure?.querySelector('figcaption')?.textContent?.trim()).toBeTruthy();
    const file = src.replace(/^images\//, '');
    expect(existsSync(join(IMAGES, file)), file).toBe(true);
    expect(statSync(join(IMAGES, file)).size, file).toBeLessThanOrEqual(300 * 1024);
    const size = pngSize(file);
    expect(String(size.width), file).toBe(img?.getAttribute('width'));
    expect(String(size.height), file).toBe(img?.getAttribute('height'));
  });
});
