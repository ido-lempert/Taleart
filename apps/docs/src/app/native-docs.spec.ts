import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes, DOCS_PAGES } from './app.routes';
import {
  ANDROID_VIEW_MEMBERS,
  ANDROID_ZONE_PARAMS,
  CONFIG_FIELDS,
  EVENT_FIELDS,
  IOS_FUNCTIONS,
  IOS_ZONE_MEMBERS,
  LISTENER_HOOKS,
  MAPPING,
  NOT_YET_NATIVE,
  STRING_KEYS,
  TALEART_SDK_MEMBERS,
  XML_ATTRIBUTES,
} from './pages/native-docs-content';

// The native guides and references check their rows against the SDK sources: a public listener
// method, config field, event field, string key or XML attribute added to the SDK fails here until the
// docs name it (epic native SDK docs, story SDK v2 docs).

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

const LISTENER = 'libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/TaleartListener.kt';
const CONFIG = 'libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/TaleartConfig.kt';
const SDK = 'libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/TaleartSdk.kt';
const STRINGS = 'libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/i18n/TaleartStrings.kt';
const ZONE = 'libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/ui/TaleartZone.kt';
const ANDROID_VIEW = 'libs/android-sdk/src/main/kotlin/site/lempert/taleart/sdk/android/TaleartView.kt';
const ATTRS = 'libs/android-sdk/src/main/res/values/attrs.xml';
const IOS_VIEW = 'libs/ios-sdk/src/iosMain/kotlin/site/lempert/taleart/sdk/ios/TaleartViewController.kt';
const IMAGES = join(root, 'apps/docs/public/images');

/** The text between a marker and the first line that closes it (a line that starts with the given close). */
function block(source: string, start: string, close: string): string {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`"${start}" not found`);
  const to = source.indexOf(close, from);
  return source.slice(from, to < 0 ? undefined : to);
}

/** The interface's methods: `    fun onX(` at the interface's indentation (the base class overrides are `override fun`). */
const listenerMethods = () => [...read(LISTENER).matchAll(/^ {4}fun (on\w+)\(/gm)].map((m) => m[1]);
const configFields = () => [...read(CONFIG).matchAll(/^ {4}val (\w+):/gm)].map((m) => m[1]);
const eventFieldNames = () => [...block(read(LISTENER), 'data class TaleartEvent(', '\n)').matchAll(/val (\w+):/g)].map((m) => m[1]);
const stringDefaults = () =>
  new Map(
    [...block(read(STRINGS), 'val DEFAULTS', '\n    )').matchAll(/"([\w.]+)" to "((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], m[2]] as const),
  );
const xmlAttributeNames = () => [...read(ATTRS).matchAll(/<attr name="(\w+)"/g)].map((m) => `app:${m[1]}`);

/** A declaration of the name in the source: `var name`, `val name` or `fun name` (`name(` for functions). */
const declares = (source: string, name: string) => new RegExp(`(var|val|fun) ${name.split('(')[0]}\\b`).test(source);

/** The text of every code element on the page. */
const codes = (page: HTMLElement) => [...page.querySelectorAll('code')].map((c) => c.textContent?.trim() ?? '');

const sorted = (values: readonly string[]) => [...values].sort();

describe('native docs: pages and navigation', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] }).compileComponents();
  });

  it('registers the four native pages in DOCS_PAGES, with their labels', () => {
    const pages = DOCS_PAGES.map((p) => [p.path, p.label]);
    expect(pages).toContainEqual(['android-guide', 'Android guide']);
    expect(pages).toContainEqual(['ios-guide', 'iOS guide']);
    expect(pages).toContainEqual(['reference/android-sdk', 'Android SDK reference']);
    expect(pages).toContainEqual(['reference/ios-sdk', 'iOS SDK reference']);
  });

  it('gives each guide numbered steps, one figure with alt text per step, and an image that exists', async () => {
    const referenced: string[] = [];
    const harness = await RouterTestingHarness.create();
    for (const path of ['/android-guide', '/ios-guide']) {
      await harness.navigateByUrl(path);
      const page = harness.routeNativeElement as HTMLElement;
      expect(page.querySelector('h1')?.textContent).toContain(path === '/android-guide' ? 'Android guide' : 'iOS guide');
      const steps = [...page.querySelectorAll('ol.steps > li')];
      expect(steps.length).toBe(8);
      // The viewer-properties step is text and code only: its states are not screenshotted for native yet.
      for (const step of steps.filter((s) => s.querySelector('h3')?.id !== 'step-properties')) {
        expect(step.querySelectorAll('figure img').length).toBeGreaterThan(0);
      }
      expect(page.querySelector('#step-properties')?.textContent).toContain('Pass viewer properties');
      // The steps hold the setup figures; the feature sections (fallback, frequency, components, answers) hold the
      // screenshots of the new states, outside the steps. So the figure checks run over every figure of the page.
      const imgs = [...page.querySelectorAll('figure img')];
      for (const img of imgs) {
        expect(img.getAttribute('alt')?.length ?? 0).toBeGreaterThan(40);
        const src = img.getAttribute('src') ?? '';
        expect(src).toMatch(path === '/android-guide' ? /^images\/android-/ : /^images\/ios-/);
        expect(existsSync(join(IMAGES, src.replace(/^images\//, '')))).toBe(true);
        referenced.push(src.replace(/^images\//, ''));
      }
      expect(page.textContent).toContain('Backups and the visitor id');
    }
    // Every android-* and ios-* image in the folder is used by a guide, and no guide names a missing one.
    const own = readdirSync(IMAGES).filter((f) => /^(android|ios)-/.test(f));
    expect(sorted(referenced)).toEqual(sorted(own));
  });

  it('says what the native SDK does not do yet, on both guides and both references', async () => {
    const harness = await RouterTestingHarness.create();
    for (const path of ['/android-guide', '/ios-guide', '/reference/android-sdk', '/reference/ios-sdk']) {
      await harness.navigateByUrl(path);
      const page = harness.routeNativeElement as HTMLElement;
      const heading = [...page.querySelectorAll('h2')].find((h) => h.textContent?.includes('Not available natively yet'));
      expect(heading).toBeDefined();
      for (const line of NOT_YET_NATIVE) expect(page.textContent).toContain(line);
      expect(page.textContent).toContain('onGroupImpression');
      // The answers, the external user ID and the tags are sent by the native SDK now: no page says otherwise.
      expect(page.textContent).not.toContain('not rendered by the native SDKs');
      expect(page.textContent).not.toContain('not called by the native SDK');
      expect(page.textContent).not.toContain('stored, not sent');
      expect(page.textContent).not.toContain('not sent with the zone read');
    }
  });
});

describe('native docs: the reference rows match the SDK sources', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] }).compileComponents();
  });

  it('lists every public TaleartListener method, with its payload and whether the native SDK fires it', () => {
    expect(listenerMethods().length).toBe(11);
    expect(sorted(LISTENER_HOOKS.map((h) => h.name))).toEqual(sorted(listenerMethods()));
    const notFiring = LISTENER_HOOKS.filter((h) => !h.native).map((h) => h.name);
    expect(sorted(notFiring)).toEqual([]);
  });

  it('lists every TaleartConfig field', () => {
    expect(configFields().length).toBe(12);
    expect(sorted(CONFIG_FIELDS.map((f) => f.name))).toEqual(sorted(configFields()));
  });

  it('lists every TaleartEvent field', () => {
    expect(sorted(EVENT_FIELDS.map((f) => f.name))).toEqual(sorted(eventFieldNames()));
  });

  it('lists every string key of TaleartStrings.DEFAULTS, with its English text, and no other', () => {
    const defaults = stringDefaults();
    expect(defaults.size).toBeGreaterThan(15);
    expect(sorted(STRING_KEYS.map((s) => s.key))).toEqual(sorted([...defaults.keys()]));
    for (const row of STRING_KEYS) expect(row.english).toBe(defaults.get(row.key));
  });

  it('lists every XML attribute of TaleartView, with its app: prefix', () => {
    expect(sorted(XML_ATTRIBUTES.map((a) => a.name))).toEqual(sorted(xmlAttributeNames()));
  });

  it('names only members the Android sources declare', () => {
    const view = read(ANDROID_VIEW);
    for (const member of ANDROID_VIEW_MEMBERS) expect(declares(view, member.name), member.name).toBe(true);
    const zone = read(ZONE);
    for (const param of ANDROID_ZONE_PARAMS) expect(zone, param.name).toMatch(new RegExp(`\\b${param.name}: `));
    const sdk = read(SDK);
    for (const member of TALEART_SDK_MEMBERS) expect(declares(sdk, member.name), member.name).toBe(true);
  });

  it('names only members the iOS sources declare', () => {
    const view = read(IOS_VIEW);
    for (const member of IOS_ZONE_MEMBERS) expect(declares(view, member.name), member.name).toBe(true);
    for (const fn of IOS_FUNCTIONS) expect(view, fn.name).toContain(`fun ${fn.name.split('(')[0]}(`);
  });
});

describe('native docs: the reference pages show every row', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] }).compileComponents();
  });

  for (const path of ['/reference/android-sdk', '/reference/ios-sdk']) {
    it(`${path} names every listener method, config field, event field and string key in its code and tables`, async () => {
      const harness = await RouterTestingHarness.create(path);
      const page = harness.routeNativeElement as HTMLElement;
      const shown = codes(page);
      for (const name of [...listenerMethods(), ...configFields(), ...eventFieldNames(), ...stringDefaults().keys()]) {
        expect(shown, `${path} ${name}`).toContain(name);
      }
      for (const name of ['app:taleartZoneKey', 'app:taleartApiUrl']) {
        if (path === '/reference/android-sdk') expect(shown, name).toContain(name);
      }
      expect(shown.length).toBeGreaterThan(40);
    });

    it(`${path} has the web, Android and iOS side-by-side table with a row per topic`, async () => {
      const harness = await RouterTestingHarness.create(path);
      const page = harness.routeNativeElement as HTMLElement;
      const table = page.querySelector('table#mapping');
      expect(table?.querySelector('caption')?.textContent?.trim()).toBe('Web, Android and iOS side by side');
      expect([...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim())).toEqual([
        'Topic',
        'Web',
        'Android',
        'iOS',
      ]);
      expect(table?.querySelectorAll('tbody tr').length).toBe(MAPPING.length);
      for (const topic of ['Init', 'Zone key', 'Locale', 'Strings', 'Hooks', 'Action override']) {
        expect(page.textContent).toContain(topic);
      }
    });

    it(`${path} labels every table and code block, and keeps each focusable`, async () => {
      const harness = await RouterTestingHarness.create(path);
      const page = harness.routeNativeElement as HTMLElement;
      const regions = [...page.querySelectorAll('pre, .table-wrap')];
      expect(regions.length).toBeGreaterThan(3);
      for (const region of regions) {
        expect(region.getAttribute('tabindex')).toBe('0');
        expect(region.getAttribute('role')).toBe('region');
        const labelledBy = region.getAttribute('aria-labelledby');
        if (labelledBy) expect(page.querySelector(`#${labelledBy}`)?.tagName).toBe('CAPTION');
        else expect(region.getAttribute('aria-label')).toBeTruthy();
      }
    });
  }
});
