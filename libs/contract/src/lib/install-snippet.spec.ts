import {
  DEFAULT_SDK_BUILDS_KEPT,
  INIT_SNIPPET_COMMENT,
  installSnippet,
  npmSnippet,
  pinnedSdkScriptTag,
  SDK_CACHE_SECONDS,
  SDK_PINNED_CACHE_SECONDS,
  sdkScriptTag,
  TEST_PAGE_KEY_PARAM,
  testPageLink,
  ZONE_KEY_PLACEHOLDER,
  zoneElement,
} from './core';

const info = {
  apiUrl: 'https://api.example.com',
  sdkUrl: 'https://api.example.com/sdk/v1/taleart.js',
  sdkPinnedUrl: null,
  sdkIntegrity: null,
  testPageUrl: 'https://api.example.com/sdk/v1/test-page',
};

describe('install snippet and test page link (zone keys)', () => {
  it('loads the SDK as a module, shows the optional init line, then the zone element with its key', () => {
    expect(installSnippet(info, 'tak_abc-_123')).toBe(
      '<script type="module" src="https://api.example.com/sdk/v1/taleart.js"></script>\n' +
        '<!-- Optional, once per page: <script>Taleart.init({ locale: "en" })</script> -->\n' +
        '<taleart-view zone-key="tak_abc-_123"></taleart-view>',
    );
  });

  it('is the script tag, the init line and one zone element, so a page with several zones reuses the first two', () => {
    expect(installSnippet(info, 'k')).toBe(`${sdkScriptTag(info)}\n${INIT_SNIPPET_COMMENT}\n${zoneElement('k')}`);
    expect(installSnippet(info, 'k').match(/<script/g)).toHaveLength(2);
  });

  it('says the placeholder without a key', () => {
    expect(zoneElement(null)).toBe(`<taleart-view zone-key="${ZONE_KEY_PLACEHOLDER}"></taleart-view>`);
    expect(zoneElement('')).toContain('zone-key="YOUR_ZONE_KEY"');
    expect(ZONE_KEY_PLACEHOLDER).toBe('YOUR_ZONE_KEY');
  });

  it('shows the npm variant: the install command, the import that gives init, then the element', () => {
    expect(npmSnippet('tak_x')).toBe(
      'npm i @lempert/taleart\n' +
        "import { init } from '@lempert/taleart';\n" +
        '// Optional, once per page: init({ locale: "en" })\n' +
        '<taleart-view zone-key="tak_x"></taleart-view>',
    );
  });

  it('escapes every value for a double-quoted attribute', () => {
    const odd = { sdkUrl: 'https://a.example/s.js?a=1&b="2"' };
    const html = installSnippet(odd, 'tak"<>&');
    expect(html).toBe(
      '<script type="module" src="https://a.example/s.js?a=1&amp;b=&quot;2&quot;"></script>\n' +
        `${INIT_SNIPPET_COMMENT}\n` +
        '<taleart-view zone-key="tak&quot;&lt;&gt;&amp;"></taleart-view>',
    );
    expect(html.match(/<script/g)).toHaveLength(2);
  });

  it('links the test page with the key only in the fragment, and the bare page without a key', () => {
    expect(testPageLink(info, null)).toBe('https://api.example.com/sdk/v1/test-page');
    expect(testPageLink(info, 'tak_a+b/c=')).toBe('https://api.example.com/sdk/v1/test-page#zoneKey=tak_a%2Bb%2Fc%3D');
    expect(TEST_PAGE_KEY_PARAM).toBe('zoneKey');
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
