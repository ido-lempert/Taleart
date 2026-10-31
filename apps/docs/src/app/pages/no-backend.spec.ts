import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import Ajv2020 from 'ajv/dist/2020';
import { appRoutes, DOCS_PAGES } from '../app.routes';
// The SDK's own checker (no imports of its own), so the page's examples are held to the real validateZone.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { validateZone } from '../../../../../libs/web-sdk/src/lib/validate-zone';
import { DOCS_SDK_PATH } from './no-backend';
import { BANNER_ZONE, BAR_ZONE, MINIMAL_ZONE } from './no-backend-data';

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const root = workspaceRoot();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const ZONES = { MINIMAL_ZONE, BAR_ZONE, BANNER_ZONE };

describe('the "Use without a backend" page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/guides/no-backend');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('is in the navigation, under the SDK guides', () => {
    const entry = DOCS_PAGES.find((p) => p.path === 'guides/no-backend');
    expect(entry).toMatchObject({ label: 'Use without a backend', group: 'SDK guides', file: 'no-backend' });
  });

  it('explains when to use it, the JSON, the three calls, what is active, how to get the JSON, debugging and frameworks', () => {
    const headings = [...page.querySelectorAll('h2[id]')].map((h) => h.id);
    expect(headings).toEqual([
      'when',
      'json-shape',
      'three-apis',
      'live-bar',
      'live-banner',
      'live-editor',
      'what-works',
      'get-the-json',
      'validate',
      'frameworks',
      'mobile',
      'screenshots',
      'see-also',
    ]);
    expect(new Set([...page.querySelectorAll('[id]')].map((e) => e.id)).size).toBe(page.querySelectorAll('[id]').length);
  });

  it('names the three calls and the property exactly as the SDK exports them', () => {
    const index = read('libs/web-sdk/src/index.ts');
    const element = read('libs/web-sdk/src/lib/taleart-element.ts');
    expect(index).toMatch(/export \{[^}]*setZoneData[^}]*\} from/);
    expect(index).toMatch(/export \{ validateZone \} from/);
    expect(index).toMatch(/setZoneData,\n {2}validateZone,/);
    expect(element).toMatch(/set data\(value: unknown\)/);
    const text = page.textContent ?? '';
    for (const name of ['element.data', 'Taleart.setZoneData', 'Taleart.validateZone', 'zoneKeyPrefix', 'localStorage', 'loadFailed']) {
      expect(text).toContain(name);
    }
  });

  it('shows the smallest zone: one group with two tales', () => {
    expect(MINIMAL_ZONE.taleGroups).toHaveLength(1);
    expect(MINIMAL_ZONE.taleGroups[0].tales).toHaveLength(2);
    const shown = page.querySelector('pre[aria-label="The smallest zone"] code')?.textContent ?? '';
    expect(JSON.parse(shown)).toEqual(JSON.parse(JSON.stringify(MINIMAL_ZONE)));
  });

  it('has the places the live examples render into, and an editor labelled for screen readers', () => {
    for (const selector of ['#live-bar .live__host', '#live-banner .live__host', '#zone-json', '#zone-verdict', '#zone-errors']) {
      expect(page.querySelector(selector) ?? page.querySelector(selector.replace(/^#[\w-]+ /, ''))).not.toBeNull();
    }
    expect(page.querySelector('label[for="zone-json"]')).not.toBeNull();
    expect(page.querySelector('#zone-verdict')?.getAttribute('role')).toBe('status');
  });

  it('captions every table and labels its scroll region', () => {
    for (const table of page.querySelectorAll('table')) {
      const caption = table.querySelector('caption');
      expect(caption?.textContent?.trim()).toBeTruthy();
      const wrap = table.closest('.table-wrap');
      expect(wrap?.getAttribute('aria-labelledby')).toBe(caption?.id);
      for (const th of table.querySelectorAll('thead th')) expect(th.getAttribute('scope')).toBe('col');
    }
  });

  it('keeps the screenshots it shows', () => {
    for (const img of page.querySelectorAll('img')) {
      const src = img.getAttribute('src') ?? '';
      expect(existsSync(join(root, 'apps/docs/public', src)), src).toBe(true);
      expect(img.getAttribute('alt')?.length ?? 0).toBeGreaterThan(20);
    }
  });
});

describe('the zone data of the page', () => {
  const schema = JSON.parse(read('libs/contract/src/generated/zone.schema.json'));

  it.each(Object.entries(ZONES))('%s is valid for the SDK (validateZone) and for the published JSON Schema', (_name, zone) => {
    expect(validateZone(zone)).toEqual({ ok: true });
    expect(validateZone(JSON.stringify(zone))).toEqual({ ok: true });
    const ajv = new Ajv2020({ strict: false });
    const valid = ajv.validate(schema, JSON.parse(JSON.stringify(zone)));
    expect(ajv.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('points every picture at a file in apps/docs/public (page-relative, as a host page would)', () => {
    const urls = [...JSON.stringify(ZONES).matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) {
      expect(url.startsWith('images/no-backend/')).toBe(true);
      expect(existsSync(join(root, 'apps/docs/public', url)), url).toBe(true);
    }
  });

  it('is rejected by the schema and by validateZone when it is broken', () => {
    const broken = { frame: null, taleGroups: [{ id: 'g', tales: [] }] };
    expect(validateZone(broken)).toEqual({ ok: false, errors: ['taleGroups[0].name: is missing (it must be text)'] });
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.validate(schema, broken)).toBe(false);
  });
});

describe('how the docs site serves the SDK and the schema', () => {
  const project = JSON.parse(read('apps/docs/project.json'));
  const assets: { glob: string; input: string; output?: string }[] = project.targets.build.options.assets;

  it('copies the built Web SDK to the folder the page loads it from', () => {
    expect(DOCS_SDK_PATH).toBe('sdk/web/index.js');
    expect(assets).toContainEqual({ glob: '*.js', input: 'dist/libs/web-sdk', output: 'sdk/web' });
    expect(JSON.stringify(project.targets.build.dependsOn)).toContain('"web-sdk"');
  });

  it('publishes the zone JSON Schema at schemas/zone.schema.json', () => {
    expect(assets).toContainEqual({ glob: 'zone.schema.json', input: 'libs/contract/src/generated', output: 'schemas' });
    expect(existsSync(join(root, 'libs/contract/src/generated/zone.schema.json'))).toBe(true);
  });

  it('is described in the Web SDK README', () => {
    const readme = read('libs/web-sdk/README.md');
    expect(readme).toContain('## Without a backend');
    expect(readme).toContain('/schemas/zone.schema.json');
  });
});
