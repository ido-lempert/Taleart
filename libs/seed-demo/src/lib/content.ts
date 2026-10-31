import type { BarSettings } from '@taleart/contract/core';
import type { ThemeSettings } from '@taleart/contract/theme';
import type { AssetName } from './assets';
import type { ElementBuilder, InkName } from './documents';

/** The demo project's name, which is also how a second run finds it. */
export const DEMO_PROJECT_NAME = 'Spring Campaign';

/** The brand the demo stands for. Every name here is made up. */
export const DEMO_BRAND = 'Nordic Home';

const SHOP = 'https://example.com/shop';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The project theme: warm sand and terracotta rings, a serif font, light colour scheme. */
export const DEMO_THEME: ThemeSettings = {
  ringStyle: 'gradient',
  ringColors: ['#c2674a', '#e0a458', '#3f5d4a'],
  seenRingColor: '#b8b0a4',
  ringWidth: 3,
  cornerRadius: 16,
  fontFamily: 'Georgia, "Times New Roman", serif',
  titleColor: '#27364a',
  backgroundColor: '#faf7f2',
  accentColor: '#ffffff',
  colorScheme: 'light',
  liveColor: '#c2674a',
};

export type ZoneKey = 'stories' | 'banner' | 'posters';

export interface ZoneSpec {
  key: ZoneKey;
  name: string;
  /** A template that sets the display; `blank` plus `frame` otherwise. */
  template: 'stories-bar' | 'promo-banner' | 'blank';
  frame?: { type: 'bar'; settings: BarSettings };
}

/** Three zones with three different displays: a ring bar, a rotating banner and a poster bar. */
export const DEMO_ZONES: readonly ZoneSpec[] = [
  { key: 'stories', name: 'Home stories', template: 'stories-bar' },
  { key: 'banner', name: 'Sale banner', template: 'promo-banner' },
  {
    key: 'posters',
    name: 'Collection posters',
    template: 'blank',
    frame: { type: 'bar', settings: { layout: 'poster', shape: 'rounded-square', size: 'large', showTitles: true, alignment: 'start', gap: 12 } },
  },
];

export interface TaleSpec {
  title: string;
  /** The tale's picture (its own media) and the ink its text is drawn in. */
  picture: AssetName;
  ink: InkName;
  /** Puts the tale's elements on the builder. */
  compose(builder: ElementBuilder, now: Date): void;
  /** Hidden from the site (status paused), a draft nobody sees yet. The draft is saved but not published. */
  hidden?: boolean;
  /** Shown from `startsInDays` days from now for `lastsDays` days (so it reads Scheduled until then). */
  schedule?: { startsInDays: number; lastsDays: number };
}

export interface GroupSpec {
  name: string;
  cover: AssetName;
  tags: readonly string[];
  /** The zones that place the group; the first creates it. */
  zones: readonly ZoneKey[];
  /** A window for the whole group: it reads Scheduled until it opens. */
  schedule?: { startsInDays: number };
  tales: readonly TaleSpec[];
}

const inDays = (now: Date, days: number): string => new Date(now.getTime() + days * DAY_MS).toISOString();

/** Five tale groups with thirteen tales: images, text, buttons and the interactive components. */
export const DEMO_GROUPS: readonly GroupSpec[] = [
  {
    name: 'New arrivals',
    cover: 'c-new-arrivals',
    tags: ['new'],
    zones: ['stories', 'banner'],
    tales: [
      {
        title: 'Meet the Fjord sofa',
        picture: 's01-fjord-sofa',
        ink: 'sand',
        compose: (b) =>
          b
            .heading('Meet Fjord')
            .body('A deep three-seater in washed linen. Soft on Sunday mornings, tough on every other day.')
            .button('Shop sofas', `${SHOP}/sofas`),
      },
      {
        title: 'Lumi armchair',
        picture: 's02-lumi-armchair',
        ink: 'sage',
        compose: (b) =>
          b
            .heading('Meet Lumi', 0.54, 0.075)
            .body('Rounded back, oak legs, made for a blanket and a book.', 0.62, 0.075)
            .reaction('Reaction', 'Love Lumi?', ['😍', '👍', '🤔'], 0.7),
      },
      {
        title: 'Aura floor lamp',
        picture: 's03-aura-lamp',
        ink: 'blush',
        compose: (b) =>
          b
            .heading('Aura brings the glow')
            .body('Warm light at the touch of a dimmer. It pairs with every sofa we make.')
            .swipeUp('See the lamp', `${SHOP}/lamps`),
      },
    ],
  },
  {
    name: 'Spring sale',
    cover: 'c-spring-sale',
    tags: ['sale', 'spring'],
    zones: ['banner', 'stories'],
    tales: [
      {
        title: 'Spring sale: up to 40% off',
        picture: 's04-spring-sale',
        ink: 'sun',
        compose: (b, now) =>
          b
            .heading('Up to 40% off', 0.54, 0.075)
            .countdown('Sale ends in', inDays(now, 7), 'The sale has ended', 0.62)
            .button('Shop the sale', `${SHOP}/sale`, 0.78),
      },
      {
        title: 'Your spring code',
        picture: 's05-promo-code',
        ink: 'mist',
        schedule: { startsInDays: 2, lastsDays: 7 },
        compose: (b) =>
          b
            .heading('A little extra', 0.54, 0.075)
            .promoCode('Spring code', 'SPRING25', '25% off your first order over 200', 0.62)
            .button('Use it at checkout', `${SHOP}/checkout`, 0.78),
      },
      {
        title: 'Sofa or armchair?',
        picture: 's06-sofa-duel',
        ink: 'sand',
        compose: (b) =>
          b.poll('Poll', 'Sofa or chair?', [
            ['sofa', 'A big sofa'],
            ['chair', 'A cosy chair'],
          ], 0.56),
      },
    ],
  },
  {
    name: 'Living room',
    cover: 'c-living-room',
    tags: ['living-room'],
    zones: ['stories', 'posters'],
    tales: [
      {
        title: 'Build a cosy corner',
        picture: 's07-cosy-corner',
        ink: 'blush',
        compose: (b) =>
          b
            .heading('Build a cosy corner')
            .body('One armchair, one lamp, one rug. Add a plant and the room is done.')
            .button('Shop the look', `${SHOP}/living-room`),
      },
      {
        title: 'Which wood is warmest?',
        picture: 's08-wood-quiz',
        ink: 'sage',
        compose: (b) =>
          b.quiz(
            'Quick quiz',
            'Warmest wood?',
            [
              ['oak', 'Oak'],
              ['pine', 'Pine'],
              ['birch', 'Birch'],
            ],
            'oak',
            0.55,
          ),
      },
      {
        title: 'Rate the room',
        picture: 's09-rate-room',
        ink: 'sun',
        compose: (b) => b.rating('Rating', 'How cosy?', '😍', 0.62),
      },
    ],
  },
  {
    name: 'Care tips',
    cover: 'c-care-tips',
    tags: ['care'],
    zones: ['stories', 'posters'],
    tales: [
      {
        title: 'Oil your oak table',
        picture: 's10-oak-care',
        ink: 'sand',
        compose: (b) =>
          b
            .heading('Oil your oak table')
            .body('Once a season: sand lightly, wipe on a thin coat of oil, wait ten minutes, buff dry.')
            .button('Read the full guide', `${SHOP}/care/oak`),
      },
      {
        title: 'Keep linen fresh',
        picture: 's11-linen-care',
        ink: 'mist',
        hidden: true,
        compose: (b) =>
          b
            .heading('Keep linen fresh')
            .body('Wash cool, dry flat and skip the softener. Linen gets softer with every wash.'),
      },
    ],
  },
  {
    name: 'Meet the makers',
    cover: 'c-makers',
    tags: ['brand'],
    zones: ['stories', 'posters'],
    schedule: { startsInDays: 3 },
    tales: [
      {
        title: 'From forest to table',
        picture: 's12-forest-table',
        ink: 'night',
        compose: (b) =>
          b
            .heading('From forest to table')
            .body('Every Tuva table starts as oak from a certified forest less than 200 km from our workshop.'),
      },
      {
        title: 'Inside the workshop',
        picture: 's13-workshop',
        ink: 'sun',
        compose: (b) =>
          b
            .heading('Inside the workshop')
            .body('Eleven makers, one bench, one rule: nothing leaves unless we would keep it ourselves.')
            .button('Meet the team', `${SHOP}/about`),
      },
    ],
  },
];

/** Tags the groups use, in the order they are created. */
export const DEMO_TAGS: readonly string[] = ['new', 'sale', 'spring', 'living-room', 'care', 'brand'];

/** A list of external user IDs, such as the newsletter subscribers a site knows by id. */
export const DEMO_USER_LIST = {
  name: 'Newsletter subscribers',
  ids: Array.from({ length: 25 }, (_, i) => `subscriber-${String(i + 1).padStart(3, '0')}`),
} as const;

/** The team the API adds beside the first admin (the access module's functions; no token can do it). */
export const DEMO_TEAM = {
  members: [
    { name: 'Pia Publisher', email: 'pia.publisher@example.com', role: 'publisher', expiresInDays: null },
    { name: 'Elin Editor', email: 'elin.editor@example.com', role: 'editor', expiresInDays: null },
    { name: 'Viktor Viewer', email: 'viktor.viewer@example.com', role: 'viewer', expiresInDays: 14 },
    { name: 'Olle Former', email: 'olle.former@example.com', role: 'editor', expiresInDays: -3 },
  ],
  invitations: [
    { role: 'publisher', accessExpiresInDays: null },
    { role: 'viewer', accessExpiresInDays: 30 },
  ],
} as const;

/** How many things a seed makes, for `--dry-run` and the result. */
export function demoCounts() {
  return {
    zones: DEMO_ZONES.length,
    taleGroups: DEMO_GROUPS.length,
    tales: DEMO_GROUPS.reduce((n, g) => n + g.tales.length, 0),
    tags: DEMO_TAGS.length,
    userLists: 1,
  };
}
