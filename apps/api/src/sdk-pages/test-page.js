// The TaleArt test page (epic UX rework R13): renders one zone with the Web SDK, as a host page does.
//
// - The zone's slug comes from `?zone=<slug>`; anything that is not a slug places nothing.
// - The site key comes from the URL fragment, `#siteKey=<key>` (a fragment never reaches a server or a
//   Referer), or from the field on the page. The fragment is removed from the address bar and the
//   history at once.
// - The key is never stored (no storage, no cookie) and never sent anywhere but by the SDK, in the
//   Authorization header of its Delivery API request. Text goes on the page with textContent only.
// - The API is where this script is served from, two levels up (`<api>/sdk/v1/test-page.js`), so an
//   API behind a path prefix works too.

// A zone slug (ZONE_SLUG_PATTERN and MAX_ZONE_SLUG_LENGTH in the contract).
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 64;
const KEY_PARAM = 'siteKey';

/** The API's base URL from this script's URL: `<api>/sdk/v1/test-page.js` gives `<api>`, without a trailing slash. */
export function apiBaseUrl(scriptUrl) {
  const base = new URL('../../', scriptUrl);
  base.search = '';
  base.hash = '';
  return base.href.replace(/\/+$/, '');
}

/** The zone slug in a query string, or '' when it is missing or not a slug. */
export function zoneFromSearch(search) {
  const zone = new URLSearchParams(search).get('zone') ?? '';
  return zone.length <= MAX_SLUG && SLUG.test(zone) ? zone : '';
}

/** The site key in a URL fragment (`#siteKey=…`), trimmed; '' when there is none. */
export function keyFromHash(hash) {
  return (new URLSearchParams(hash.replace(/^#/, '')).get(KEY_PARAM) ?? '').trim();
}

/** Builds the page in `doc`: reads the zone and the key, drops the fragment, places the element. */
export function start(doc, loc, hist, scriptUrl) {
  const zone = zoneFromSearch(loc.search);
  const fragmentKey = keyFromHash(loc.hash);
  if (loc.hash) hist.replaceState(null, '', loc.pathname + loc.search);

  const status = doc.getElementById('status');
  const form = doc.getElementById('key-form');
  const input = doc.getElementById('site-key');
  const host = doc.getElementById('zone-host');

  if (!zone) {
    doc.getElementById('no-zone').hidden = false;
    return;
  }
  doc.getElementById('zone-slug').textContent = zone;
  doc.getElementById('zone-line').hidden = false;
  form.hidden = false;

  const view = doc.createElement('taleart-view');
  // The Delivery API answers on the API this page is served by.
  view.setAttribute('api-url', apiBaseUrl(scriptUrl));
  view.setAttribute('zone', zone);
  host.append(view);

  const show = (key, from) => {
    view.setAttribute('site-key', key);
    status.textContent = `Showing zone ${zone} with the site key ${from}. Nothing shows when the key or the zone is refused; the browser console says why.`;
  };

  if (fragmentKey) {
    show(fragmentKey, 'from the link');
  } else {
    status.textContent = 'Paste a site key to show the zone.';
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!key) {
      status.textContent = 'Paste a site key to show the zone.';
      input.focus();
      return;
    }
    // The field keeps no copy of the key once it is in use.
    input.value = '';
    show(key, 'you pasted');
  });
}

// On the test page itself (it has the zone host); a test imports the functions alone.
if (typeof document !== 'undefined' && document.getElementById('zone-host')) {
  start(document, location, history, import.meta.url);
}
