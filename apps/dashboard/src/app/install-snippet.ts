import { TEST_PAGE_KEY_PARAM, type InstallInfo } from '@taleart/contract/core';

/** What the snippet says in place of the site key when the key is not at hand (it is shown only once). */
export const SITE_KEY_PLACEHOLDER = 'YOUR_SITE_KEY';

// An HTML attribute value in double quotes: the characters that could end it or start markup.
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The copy-ready HTML that places a zone on a host page (epic UX rework R13): the Web SDK's script tag
 * and a `<taleart-view>` with the API URL, the site key (or {@link SITE_KEY_PLACEHOLDER}) and the
 * zone's slug. Every value is escaped for a double-quoted attribute.
 */
export function installSnippet(info: InstallInfo, zone: string, siteKey: string | null): string {
  return [
    `<script type="module" src="${attr(info.sdkUrl)}"></script>`,
    `<taleart-view api-url="${attr(info.apiUrl)}" site-key="${attr(siteKey || SITE_KEY_PLACEHOLDER)}" zone="${attr(zone)}"></taleart-view>`,
  ].join('\n');
}

/**
 * The test page for a zone: `?zone=<slug>`, and the site key, when given, in the URL fragment
 * (`#siteKey=…`), which the browser never sends to a server or in a Referer. Without a key the
 * page asks for one.
 */
export function testPageLink(info: InstallInfo, zone: string, siteKey: string | null): string {
  const url = `${info.testPageUrl}?zone=${encodeURIComponent(zone)}`;
  return siteKey ? `${url}#${TEST_PAGE_KEY_PARAM}=${encodeURIComponent(siteKey)}` : url;
}
