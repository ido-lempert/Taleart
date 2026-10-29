import {
  installSnippet,
  npmSnippet,
  SDK_BUNDLE_PATH,
  SDK_CACHE_SECONDS,
  SDK_PINNED_CACHE_SECONDS,
  SDK_TEST_PAGE_PATH,
  sdkScriptTag,
  testPageLink,
  ZONE_KEY_PLACEHOLDER,
  zoneElement,
} from '@taleart/contract/core';

/** The API origin the docs use in examples. A real page uses the URL its zone page's Install tab shows. */
export const EXAMPLE_API_URL = 'https://api.example.com';

/** The zone slug the docs use in examples. */
export const EXAMPLE_ZONE = 'home-top';

/** What `GET /api/v1/install` answers for {@link EXAMPLE_API_URL}: the URLs the Install tab builds its snippet from. */
export const EXAMPLE_INSTALL = {
  apiUrl: EXAMPLE_API_URL,
  sdkUrl: `${EXAMPLE_API_URL}${SDK_BUNDLE_PATH}`,
  testPageUrl: `${EXAMPLE_API_URL}${SDK_TEST_PAGE_PATH}`,
} as const;

/**
 * The snippet the docs show: exactly what the zone page's Install tab gives for the example zone,
 * built by the same contract function (`installSnippet`), with the zone key placeholder.
 */
export const DOCS_SNIPPET = installSnippet(EXAMPLE_INSTALL, null);

/** The npm variant of the snippet, with the zone key placeholder. */
export const DOCS_NPM_SNIPPET = npmSnippet(null);

/** Two zones on one page: the script once, one element per zone, each with its own zone key. */
export const DOCS_TWO_ZONES_SNIPPET = [
  sdkScriptTag(EXAMPLE_INSTALL),
  zoneElement(`${ZONE_KEY_PLACEHOLDER}_HOME_TOP`),
  zoneElement(`${ZONE_KEY_PLACEHOLDER}_HOME_PROMO`),
].join('\n');

/** How long browsers keep the SDK at its stable URL, in words (from the API's own constant). */
export const SDK_CACHE_TEXT = SDK_CACHE_SECONDS === 300 ? 'five minutes' : `${SDK_CACHE_SECONDS} seconds`;

/** How long browsers keep the SDK at its pinned URL, in words (from the API's own constant). */
export const SDK_PINNED_CACHE_TEXT = SDK_PINNED_CACHE_SECONDS === 365 * 24 * 3600 ? 'a year' : `${SDK_PINNED_CACHE_SECONDS} seconds`;

/** The test page link, without a key (the page asks for one). */
export const DOCS_TEST_PAGE = testPageLink(EXAMPLE_INSTALL, null);

/** The test page link with a key: the key travels only in the URL fragment. */
export const DOCS_TEST_PAGE_WITH_KEY = testPageLink(EXAMPLE_INSTALL, ZONE_KEY_PLACEHOLDER);

/** The SDK at a URL pinned to its content, with Subresource Integrity. */
export const DOCS_PINNED_SCRIPT =
  `<script type="module" src="${EXAMPLE_API_URL}/sdk/v1/taleart.<hash>.js" integrity="sha384-…" crossorigin="anonymous"></script>`;

/**
 * A theme override for one zone, by its slug. `configureZone` is imported from exactly the URL of the
 * page's script tag (the pinned one, when the page pins it): another URL would load a second copy of
 * the SDK, whose settings the elements never read.
 */
export const DOCS_THEME_SCRIPT = [
  sdkScriptTag(EXAMPLE_INSTALL),
  '<script type="module">',
  `  import { configureZone } from '${EXAMPLE_INSTALL.sdkUrl}';`,
  '',
  `  // Every <taleart-view> that shows the zone with slug "${EXAMPLE_ZONE}"; other zones keep the project's theme.`,
  `  configureZone('${EXAMPLE_ZONE}', { theme: { ringStyle: 'solid', ringColors: ['#0055ff'] } });`,
  '</script>',
].join('\n');

/** The viewer's targeting tags (epic targeting R2), imported from the URL of the page's script tag. */
export const DOCS_TAGS_SCRIPT = [
  '<script type="module">',
  `  import { setTags } from '${EXAMPLE_INSTALL.sdkUrl}';`,
  '',
  "  setTags(['summer', 'vip']);",
  '</script>',
].join('\n');

/**
 * The viewer's external user ID (epic targeting R4): an opaque ID of the host's own, never an email.
 * `setExternalUserId(null)` sends none again, for example after sign-out.
 */
export const DOCS_EXTERNAL_USER_ID_SCRIPT = [
  '<script type="module">',
  `  import { setExternalUserId } from '${EXAMPLE_INSTALL.sdkUrl}';`,
  '',
  "  // Your own opaque ID for the signed-in user; null after sign-out.",
  "  setExternalUserId('cust-1001');",
  '</script>',
].join('\n');

export interface GlossaryTerm {
  readonly term: string;
  /** The name it replaced, when it had one. */
  readonly was?: string;
  readonly definition: string;
  readonly example: string;
}

/**
 * The migration examples on the "Stages and zone keys" page: what the fold (story 8.5,
 * `libs/server/zones/src/lib/fold.ts`) makes of two zones. They are the expectations of the API's fold
 * tests in `apps/api/src/app.spec.ts` ("folds once when several API instances migrate at the same
 * time" and "turns a zone of two stages…"), which the docs check reads: a zone made from a frame
 * takes the original zone's new slug plus `-<type>-<n>`, `n` counting that zone's frames of the type
 * oldest first, stage frames included.
 */
export const FOLD_EXAMPLES = [
  {
    before: '"Home" with stages Top (a bar, key top) and Hero (a banner, key hero), and a second bar no stage showed',
    after: [
      { name: 'Top', slug: 'top', note: 'the original zone, with the Top bar' },
      { name: 'Hero', slug: 'hero', note: 'the banner' },
      { name: 'Home – Bar 2', slug: 'top-bar-2', note: 'the second bar' },
    ],
  },
  {
    before: '"Shop" with a bar and a banner, and no stages',
    after: [
      { name: 'Shop', slug: 'shop', note: 'the original zone, with the bar' },
      { name: 'Shop – Banner 1', slug: 'shop-banner-1', note: 'the banner' },
    ],
  },
] as const;

/** The product's terms, as the UX review of 2026-10-23 defines them (its glossary, section 3). */
export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    term: 'Project',
    definition: 'Your app or site. Holds everything below, plus the theme, the fonts and the site key (the server-side key).',
    example: 'Acme Shop',
  },
  {
    term: 'Zone',
    definition:
      'One spot in your app or site where tales appear. A page can have several zones, and a zone can appear on several pages. A page shows a zone with the zone’s key; the slug names it in the dashboard and the API.',
    example: 'Home – top (slug home-top)',
  },
  {
    term: 'Display',
    was: 'frame',
    definition:
      'How a zone looks: a Stories bar or a Banner, plus its settings. Exactly one per zone, and you can change it at any time.',
    example: 'Bar, circles, medium',
  },
  {
    term: 'Template',
    definition:
      'A starting preset you pick when you create a zone: Stories bar, Promo banner or Blank. It sets the display once; nothing links the zone to it afterwards.',
    example: 'Stories bar',
  },
  {
    term: 'Tale group',
    definition:
      'A set of tales shown as one item: one circle in a bar or one slide in a banner. It can show in several zones, and has one On / Off switch.',
    example: 'Summer sale',
  },
  {
    term: 'Tale',
    definition: 'One full-screen page of a group: media plus layers, made in Tale Studio. Each tale is Shown or Hidden.',
    example: 'Opening',
  },
  {
    term: 'Theme',
    definition: 'Colours, rings and fonts for every zone of the project. A host page can override it for one zone.',
    example: '–',
  },
  {
    term: 'Zone key',
    definition:
      'The key a host page uses to show one zone (tak_…). One active key per zone; an admin issues it on the zone’s Install tab and it is shown once. It sits in page HTML, so it can show only that zone.',
    example: 'tak_…',
  },
  {
    term: 'Site key',
    definition:
      'The project’s key for server-side or legacy Delivery API calls (tas_…), sent with the zone’s slug as ?zone=. A web page uses a zone key instead, never the site key.',
    example: 'tas_…',
  },
];
