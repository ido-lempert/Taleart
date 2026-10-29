import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../app.routes';

// The SDK's source is the truth: every option, hook, event, attribute, export and text key is read from
// libs/web-sdk/src at spec time, so a key the SDK gains or loses fails here until the page matches.

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('nx.json not found above ' + process.cwd());
    dir = up;
  }
  return dir;
}

const read = (path: string) => readFileSync(join(workspaceRoot(), path), 'utf8');

/** The text between `start` and the first `end` after it. */
function block(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  if (from < 0) throw new Error(`"${start}" not found`);
  return text.slice(from + start.length, text.indexOf(end, from));
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const i18n = read('libs/web-sdk/src/lib/i18n.ts');
const hooks = read('libs/web-sdk/src/lib/hooks.ts');
const config = read('libs/web-sdk/src/lib/config.ts');
const element = read('libs/web-sdk/src/lib/taleart-element.ts');
const index = read('libs/web-sdk/src/index.ts');

const SOURCE_STRINGS = new Map(
  [...block(i18n, 'export const DEFAULT_STRINGS = {', '} as const').matchAll(/^\s*'([\w.]+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)].map(
    (m) => [m[1], m[2].trim()],
  ),
);
const SOURCE_HOOKS = [...block(hooks, 'export interface TaleartHooks {', '\n}').matchAll(/^\s*(on[A-Z]\w*)\??:/gm)].map((m) => m[1]);
const SOURCE_EVENTS = [...hooks.matchAll(/name: '(\w+)';/g)].map((m) => m[1]);
const SOURCE_OPTIONS = [...block(config, 'export interface TaleartConfig {', '\n}').matchAll(/^  (\w+)\??:/gm)].map((m) => m[1]);
const attributeValues = new Map([...element.matchAll(/const (\w+) = '([^']+)'/g)].map((m) => [m[1], m[2]]));
const SOURCE_ATTRIBUTES = [.../observedAttributes\(\): string\[\] \{\s*return \[([^\]]+)\]/.exec(element)![1].split(',')].map(
  (name) => attributeValues.get(name.trim()),
);
const SOURCE_EXPORTS = [...index.matchAll(/export \{([^}]+)\} from/g)]
  .flatMap((m) => m[1].split(','))
  .map((name) => name.trim())
  .filter(Boolean);

function texts(root: HTMLElement, table: string, column = 1): string[] {
  return [...root.querySelectorAll(`#${table} tbody tr`)].map((tr) => tr.querySelector(`td:nth-child(${column}) code`)?.textContent?.trim() ?? '');
}

describe('the Web SDK reference page', () => {
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    const harness = await RouterTestingHarness.create('/reference/web-sdk');
    page = harness.routeNativeElement as HTMLElement;
  });

  it('has the SDK sources it reads (guards against a moved file)', () => {
    expect(SOURCE_STRINGS.size).toBeGreaterThan(40);
    expect(SOURCE_HOOKS).toEqual(expect.arrayContaining(['onLoaded', 'onActionClicked', 'onEvent']));
    expect(SOURCE_OPTIONS).toEqual(['apiUrl', 'locale', 'strings', 'theme', 'externalUserId', 'tags', 'hooks', 'fallback', 'frequency', 'analytics']);
    expect(SOURCE_ATTRIBUTES).toEqual(['api-url', 'zone-key', 'locale', 'theme', 'fallback', 'frequency', 'analytics']);
  });

  it('lists each element attribute, exactly as the SDK observes it', () => {
    expect(texts(page, 'attributes').sort()).toEqual([...SOURCE_ATTRIBUTES].sort());
  });

  it('lists each Taleart.init option, exactly as the SDK reads it', () => {
    expect(texts(page, 'init-options').sort()).toEqual([...SOURCE_OPTIONS].sort());
  });

  it('lists each export of the module, exactly', () => {
    expect(texts(page, 'functions').sort()).toEqual([...SOURCE_EXPORTS].sort());
  });

  it('lists each text key of the SDK with its English default, exactly', () => {
    const rows = [...page.querySelectorAll('#strings tbody tr')];
    const keys = rows.map((tr) => tr.querySelector('td:nth-child(1) code')?.textContent?.trim());
    const defaults = new Map(rows.map((tr) => [tr.querySelector('td:nth-child(1) code')?.textContent?.trim(), tr.querySelector('td:nth-child(2)')?.textContent?.replace(/\s+/g, ' ').trim()]));
    expect(keys.sort()).toEqual([...SOURCE_STRINGS.keys()].sort());
    for (const [key, value] of SOURCE_STRINGS) {
      expect({ key, english: defaults.get(key) }).toEqual({ key, english: value });
    }
  });

  it('lists each hook, exactly', () => {
    expect(texts(page, 'hooks').sort()).toEqual([...SOURCE_HOOKS].sort());
  });

  it('lists each DOM event, exactly, under the name the SDK dispatches it with', () => {
    expect(texts(page, 'dom-events').sort()).toEqual(SOURCE_EVENTS.map((name) => `taleart:${kebab(name)}`).sort());
  });

  it('names the hook each DOM event comes from', () => {
    const pairs = [...page.querySelectorAll('#dom-events tbody tr')].map((tr) => [
      tr.querySelector('td:nth-child(1) code')?.textContent?.trim(),
      tr.querySelector('td:nth-child(2) code')?.textContent?.trim(),
    ]);
    expect(pairs.map(([event, hook]) => `${event}=${hook}`).sort()).toEqual(
      SOURCE_EVENTS.map((name) => `taleart:${kebab(name)}=on${name[0].toUpperCase()}${name.slice(1)}`).sort(),
    );
  });

  it('says that only action clicked can be canceled, as the SDK does', () => {
    const cancelable = [...page.querySelectorAll('#dom-events tbody tr')]
      .filter((tr) => tr.querySelector('td:nth-child(3)')?.textContent?.trim() === 'Yes')
      .map((tr) => tr.querySelector('code')?.textContent);
    expect(cancelable).toEqual(['taleart:action-clicked']);
    expect(read('libs/web-sdk/README.md')).toContain('Only `taleart:action-clicked` is cancelable.');
  });

  it('captions every table and labels its scroll region', () => {
    for (const table of page.querySelectorAll('table')) {
      const caption = table.querySelector('caption');
      expect(caption?.textContent?.trim()).toBeTruthy();
      const wrap = table.closest('.table-wrap');
      expect(wrap?.getAttribute('tabindex')).toBe('0');
      expect(wrap?.getAttribute('role')).toBe('region');
      expect(wrap?.getAttribute('aria-labelledby')).toBe(caption?.id);
      for (const th of table.querySelectorAll('thead th')) expect(th.getAttribute('scope')).toBe('col');
    }
  });

  it('names the error behaviour the SDK logs', () => {
    const text = page.textContent ?? '';
    expect(text).toContain('one console error');
    expect(text).toContain('one console warning');
    expect(text).toContain('console.error');
  });
});
