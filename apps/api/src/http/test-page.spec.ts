// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiBaseUrl, keyFromHash, start } from '../sdk-pages/test-page.js';

// The test page's script (epic UX rework R13), run on the page's own HTML.
const html = readFileSync(join(import.meta.dirname, '..', 'sdk-pages', 'test-page.html'), 'utf8');

function page(url: string) {
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
  const u = new URL(url);
  const loc = { search: u.search, hash: u.hash, pathname: u.pathname };
  const replaceState = vi.fn();
  start(document, loc, { replaceState }, `${u.origin}${u.pathname.replace(/test-page$/, 'test-page.js')}`);
  const view = document.querySelector('taleart-view');
  return { view, replaceState, status: () => document.getElementById('status')?.textContent ?? '' };
}

describe('test page script', () => {
  it('reads the API from where the script is served, path prefix included, without a trailing slash', () => {
    expect(apiBaseUrl('https://api.example.com/sdk/v1/test-page.js')).toBe('https://api.example.com');
    expect(apiBaseUrl('https://example.com/taleart/api/sdk/v1/test-page.js?v=1#x')).toBe('https://example.com/taleart/api');
    expect(apiBaseUrl('http://localhost:3333/sdk/v1/test-page.js')).toBe('http://localhost:3333');
  });

  it('reads and trims the key in the fragment', () => {
    expect(keyFromHash('#zoneKey=%20tak_abc%20')).toBe('tak_abc');
    expect(keyFromHash('#zoneKey=tak_a%2Bb')).toBe('tak_a+b');
    expect(keyFromHash('')).toBe('');
    expect(keyFromHash('#other=1')).toBe('');
  });

  it('places the zone with the key from the fragment, and drops the fragment from the address bar', () => {
    const { view, replaceState, status } = page('https://example.com/api/sdk/v1/test-page#zoneKey=%20tak_abc%20');
    expect(view?.getAttribute('api-url')).toBe('https://example.com/api');
    expect(view?.getAttribute('zone-key')).toBe('tak_abc');
    expect(view?.hasAttribute('site-key')).toBe(false);
    expect(view?.hasAttribute('zone')).toBe(false);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/api/sdk/v1/test-page');
    expect(status()).toContain('with the zone key from the link');
  });

  it('ignores a key in the query', () => {
    const { view, status } = page('https://example.com/sdk/v1/test-page?zoneKey=tak_abc');
    expect(view?.hasAttribute('zone-key')).toBe(false);
    expect(status()).toBe('Paste a zone key to show the zone.');
  });

  it('takes a pasted key, trimmed, and empties the field', () => {
    const { view, replaceState, status } = page('https://api.example.com/sdk/v1/test-page');
    expect(replaceState).not.toHaveBeenCalled();
    expect(view?.hasAttribute('zone-key')).toBe(false);
    expect(status()).toBe('Paste a zone key to show the zone.');
    const input = document.getElementById('zone-key') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.getAttribute('autocomplete')).toBe('off');
    const form = document.getElementById('key-form') as HTMLFormElement;
    input.value = '   ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(view?.hasAttribute('zone-key')).toBe(false);
    input.value = '  tak_pasted  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(view?.getAttribute('zone-key')).toBe('tak_pasted');
    expect(input.value).toBe('');
    expect(status()).toContain('you pasted');
  });
});
