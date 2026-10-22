import { installSnippet, SITE_KEY_PLACEHOLDER, testPageLink } from './install-snippet';

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
