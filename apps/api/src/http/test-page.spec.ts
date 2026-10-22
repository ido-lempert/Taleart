// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiBaseUrl, keyFromHash, start, zoneFromSearch } from '../sdk-pages/test-page.js';

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

  it('takes only a slug from the query', () => {
    expect(zoneFromSearch('?zone=home-top')).toBe('home-top');
    expect(zoneFromSearch('?zone=Home')).toBe('');
    expect(zoneFromSearch('?zone=%3Cimg%3E')).toBe('');
    expect(zoneFromSearch('?zone=' + 'a'.repeat(65))).toBe('');
    expect(zoneFromSearch('')).toBe('');
  });

  it('reads and trims the key in the fragment', () => {
    expect(keyFromHash('#siteKey=%20tas_abc%20')).toBe('tas_abc');
    expect(keyFromHash('#siteKey=tas_a%2Bb')).toBe('tas_a+b');
    expect(keyFromHash('')).toBe('');
    expect(keyFromHash('#other=1')).toBe('');
  });

  it('places the zone with the key from the fragment, and drops the fragment from the address bar', () => {
    const { view, replaceState, status } = page('https://example.com/api/sdk/v1/test-page?zone=home-top#siteKey=%20tas_abc%20');
    expect(view?.getAttribute('api-url')).toBe('https://example.com/api');
    expect(view?.getAttribute('zone')).toBe('home-top');
    expect(view?.getAttribute('site-key')).toBe('tas_abc');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/api/sdk/v1/test-page?zone=home-top');
    expect(status()).toContain('with the site key from the link');
    expect(document.getElementById('zone-slug')?.textContent).toBe('home-top');
  });

  it('takes a pasted key, trimmed, and empties the field', () => {
    const { view, replaceState, status } = page('https://api.example.com/sdk/v1/test-page?zone=home-top');
    expect(replaceState).not.toHaveBeenCalled();
    expect(view?.hasAttribute('site-key')).toBe(false);
    expect(status()).toBe('Paste a site key to show the zone.');
    const input = document.getElementById('site-key') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.getAttribute('autocomplete')).toBe('off');
    const form = document.getElementById('key-form') as HTMLFormElement;
    input.value = '   ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(view?.hasAttribute('site-key')).toBe(false);
    input.value = '  tas_pasted  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(view?.getAttribute('site-key')).toBe('tas_pasted');
    expect(input.value).toBe('');
    expect(status()).toContain('you pasted');
  });

  it('places nothing without a slug, and puts nothing of the query on the page', () => {
    const { view } = page('https://api.example.com/sdk/v1/test-page?zone=%3Cimg%20src%3Dx%3E#siteKey=tas_abc');
    expect(view).toBeNull();
    expect(document.getElementById('no-zone')?.hidden).toBe(false);
    expect(document.getElementById('key-form')?.hidden).toBe(true);
    expect(document.body.innerHTML).not.toContain('img src');
    expect(document.body.innerHTML).not.toContain('tas_abc');
  });
});
