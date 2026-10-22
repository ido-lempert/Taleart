import {
  installSnippet,
  SDK_BUNDLE_PATH,
  SITE_KEY_PLACEHOLDER,
  SDK_TEST_PAGE_PATH,
  testPageLink,
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
 * built by the same contract function (`installSnippet`), with the site key placeholder.
 */
export const DOCS_SNIPPET = installSnippet(EXAMPLE_INSTALL, EXAMPLE_ZONE, null);

/** Two zones of one project on one page: the script once, one element per zone, one site key. */
export const DOCS_TWO_ZONES_SNIPPET = [
  DOCS_SNIPPET,
  installSnippet(EXAMPLE_INSTALL, 'home-promo', null).split('\n')[1],
].join('\n');

/** The test page link for the example zone, without a key (the page asks for one). */
export const DOCS_TEST_PAGE = testPageLink(EXAMPLE_INSTALL, EXAMPLE_ZONE, null);

/** The test page link with a key: the key travels only in the URL fragment. */
export const DOCS_TEST_PAGE_WITH_KEY = testPageLink(EXAMPLE_INSTALL, EXAMPLE_ZONE, SITE_KEY_PLACEHOLDER);

/** The SDK at a URL pinned to its content, with Subresource Integrity. */
export const DOCS_PINNED_SCRIPT =
  `<script type="module" src="${EXAMPLE_API_URL}/sdk/v1/taleart.<hash>.js" integrity="sha384-…" crossorigin="anonymous"></script>`;

/** A theme override for one zone, by its slug. */
export const DOCS_THEME_SCRIPT = [
  '<script type="module">',
  `  import { configureZone } from '${EXAMPLE_INSTALL.sdkUrl}';`,
  '',
  `  // Every <taleart-view> with zone="${EXAMPLE_ZONE}"; other zones keep the project's theme.`,
  `  configureZone('${EXAMPLE_ZONE}', { theme: { ringStyle: 'solid', ringColors: ['#0055ff'] } });`,
  '</script>',
].join('\n');

export interface GlossaryTerm {
  readonly term: string;
  /** The name it replaced, when it had one. */
  readonly was?: string;
  readonly definition: string;
  readonly example: string;
}

/** The product's terms, as the UX review of 2026-10-23 defines them (its glossary, section 3). */
export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    term: 'Project',
    definition: 'Your app or site. Holds everything below, plus the theme, the fonts and the site key.',
    example: 'Acme Shop',
  },
  {
    term: 'Zone',
    definition:
      'One spot in your app or site where tales appear. A page can have several zones, and a zone can appear on several pages. A page names a zone by its slug.',
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
    was: 'playbook',
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
    term: 'Site key',
    definition:
      'The project’s one key for host pages (tas_…). Every zone of the project is placed with it and the zone’s slug. It sits in page HTML, so it is not a secret.',
    example: 'tas_…',
  },
];
