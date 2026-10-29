// The TaleArt test page (epic UX rework R13): renders one zone with the Web SDK, as a host page does.
//
// - The zone key comes from the URL fragment, `#zoneKey=<key>` (a fragment never reaches a server or a
//   Referer), or from the field on the page. The key names the zone. The fragment is removed from the
//   address bar and the history at once.
// - The key is never stored (no storage, no cookie) and never sent anywhere but by the SDK, in the
//   Authorization header of its Delivery API request. Text goes on the page with textContent only.
// - The API is where this script is served from, two levels up (`<api>/sdk/v1/test-page.js`), so an
//   API behind a path prefix works too.

const KEY_PARAM = 'zoneKey';

/** The API's base URL from this script's URL: `<api>/sdk/v1/test-page.js` gives `<api>`, without a trailing slash. */
export function apiBaseUrl(scriptUrl) {
  const base = new URL('../../', scriptUrl);
  base.search = '';
  base.hash = '';
  return base.href.replace(/\/+$/, '');
}

/** The zone key in a URL fragment (`#zoneKey=…`), trimmed; '' when there is none. */
export function keyFromHash(hash) {
  return (new URLSearchParams(hash.replace(/^#/, '')).get(KEY_PARAM) ?? '').trim();
}

/** Builds the page in `doc`: reads the key, drops the fragment, places the element. */
export function start(doc, loc, hist, scriptUrl) {
  const fragmentKey = keyFromHash(loc.hash);
  if (loc.hash) hist.replaceState(null, '', loc.pathname + loc.search);

  const status = doc.getElementById('status');
  const form = doc.getElementById('key-form');
  const input = doc.getElementById('zone-key');
  const host = doc.getElementById('zone-host');

  const view = doc.createElement('taleart-view');
  // The Delivery API answers on the API this page is served by.
  view.setAttribute('api-url', apiBaseUrl(scriptUrl));
  host.append(view);

  const show = (key, from) => {
    view.setAttribute('zone-key', key);
    status.textContent = `Showing the zone with the zone key ${from}. Nothing shows when the key is refused; the browser console says why.`;
  };

  if (fragmentKey) {
    show(fragmentKey, 'from the link');
  } else {
    status.textContent = 'Paste a zone key to show the zone.';
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = input.value.trim();
    if (!key) {
      status.textContent = 'Paste a zone key to show the zone.';
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
