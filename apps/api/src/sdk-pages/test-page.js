// The TaleArt test page (epic UX rework R13): renders one zone with the Web SDK, as a host page does.
//
// - The zone's slug comes from `?zone=<slug>`; anything that is not a slug places nothing.
// - The site key comes from the URL fragment, `#siteKey=<key>` (a fragment never reaches a server or a
//   Referer), or from the field on the page. The fragment is removed from the address bar and the
//   history at once.
// - The key is never stored (no storage, no cookie) and never sent anywhere but by the SDK, in the
//   Authorization header of its Delivery API request. Text goes on the page with textContent only.

// A zone slug (ZONE_SLUG_PATTERN and MAX_ZONE_SLUG_LENGTH in the contract).
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 64;
const KEY_PARAM = 'siteKey';

const params = new URLSearchParams(location.search);
const zone = params.get('zone') ?? '';
const fragment = new URLSearchParams(location.hash.slice(1));
const fragmentKey = (fragment.get(KEY_PARAM) ?? '').trim();
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const status = document.getElementById('status');
const form = document.getElementById('key-form');
const input = document.getElementById('site-key');
const host = document.getElementById('zone-host');

if (zone.length > MAX_SLUG || !SLUG.test(zone)) {
  document.getElementById('no-zone').hidden = false;
} else {
  document.getElementById('zone-slug').textContent = zone;
  document.getElementById('zone-line').hidden = false;
  form.hidden = false;

  const view = document.createElement('taleart-view');
  // The Delivery API answers on this page's own origin: this page is served by the TaleArt API.
  view.setAttribute('api-url', location.origin);
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
