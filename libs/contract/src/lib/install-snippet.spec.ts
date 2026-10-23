import {
  DEFAULT_SDK_BUILDS_KEPT,
  installSnippet,
  pinnedSdkScriptTag,
  SDK_CACHE_SECONDS,
  SDK_PINNED_CACHE_SECONDS,
  sdkScriptTag,
  SITE_KEY_PLACEHOLDER,
  testPageLink,
  zoneElement,
} from './core';

const info = {
  apiUrl: 'https://api.example.com',
  sdkUrl: 'https://api.example.com/sdk/v1/taleart.js',
  sdkPinnedUrl: null,
  sdkIntegrity: null,
  testPageUrl: 'https://api.example.com/sdk/v1/test-page',
};

describe('install snippet and test page link (epic UX rework R13)', () => {
  it('loads the SDK as a module and places the zone with the API URL, the key and the slug', () => {
    expect(installSnippet(info, 'home-top', 'tas_abc-_123')).toBe(
      '<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>\n' +
        '<taleart-view api-url="https://api.example.com" site-key="tas_abc-_123" zone="home-top"></taleart-view>',
    );
  });

  it('is the script tag and one zone element, so a page with several zones reuses the parts', () => {
    expect(installSnippet(info, 'home-top', 'k')).toBe(`${sdkScriptTag(info)}\n${zoneElement(info, 'home-top', 'k')}`);
  });

  it('keeps the SDK five minutes at its stable URL and a year at its pinned one', () => {
    expect(SDK_CACHE_SECONDS).toBe(5 * 60);
    expect(SDK_PINNED_CACHE_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  it('says the placeholder without a key', () => {
    expect(installSnippet(info, 'home-top', null)).toContain(`site-key="${SITE_KEY_PLACEHOLDER}"`);
    expect(installSnippet(info, 'home-top', '')).toContain('site-key="YOUR_SITE_KEY"');
  });

  it('escapes every value for a double-quoted attribute', () => {
    const odd = { apiUrl: 'https://a.example/"><script>x</script>&', sdkUrl: 'https://a.example/s.js?a=1&b="2"', sdkPinnedUrl: null, sdkIntegrity: null, testPageUrl: '' };
    const html = installSnippet(odd, 'z"<>&', 'k"<>&');
    expect(html).toBe(
      '<script type="module" src="https://a.example/s.js?a=1&amp;b=&quot;2&quot;"></script>\n' +
        '<taleart-view api-url="https://a.example/&quot;&gt;&lt;script&gt;x&lt;/script&gt;&amp;" ' +
        'site-key="k&quot;&lt;&gt;&amp;" zone="z&quot;&lt;&gt;&amp;"></taleart-view>',
    );
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('links the test page with the slug in the query and the key only in the fragment', () => {
    expect(testPageLink(info, 'home-top', null)).toBe('https://api.example.com/sdk/v1/test-page?zone=home-top');
    expect(testPageLink(info, 'home-top', 'tas_a+b/c=')).toBe(
      'https://api.example.com/sdk/v1/test-page?zone=home-top#siteKey=tas_a%2Bb%2Fc%3D',
    );
    expect(testPageLink(info, 'a&b', 'k').split('#')[0]).toBe('https://api.example.com/sdk/v1/test-page?zone=a%26b');
  });
});

describe('the pinned script tag (story 8.21)', () => {
  it('loads one build with its integrity, cross-origin, and is null without a bundle', () => {
    const pinned = {
      sdkPinnedUrl: 'https://api.example.com/sdk/v1/taleart.abcdefghijklmn-_.js',
      sdkIntegrity: 'sha384-AbC+/=',
    };
    expect(pinnedSdkScriptTag(pinned)).toBe(
      '<script type="module" src="https://api.example.com/sdk/v1/taleart.abcdefghijklmn-_.js" ' +
        'integrity="sha384-AbC+/=" crossorigin="anonymous"></script>',
    );
    expect(pinnedSdkScriptTag({ sdkPinnedUrl: null, sdkIntegrity: null })).toBeNull();
    expect(pinnedSdkScriptTag({ ...pinned, sdkIntegrity: null })).toBeNull();
    expect(pinnedSdkScriptTag({ sdkPinnedUrl: 'https://a.example/"><x', sdkIntegrity: 'i"' })).toBe(
      '<script type="module" src="https://a.example/&quot;&gt;&lt;x" integrity="i&quot;" crossorigin="anonymous"></script>',
    );
  });

  it('keeps five builds by default', () => {
    expect(DEFAULT_SDK_BUILDS_KEPT).toBe(5);
  });
});
