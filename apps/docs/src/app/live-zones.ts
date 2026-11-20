// Hard-coded zone data for the docs' live examples: the JSON a page passes to the Web SDK instead of a zone key (see
// the "Use without a backend" guide). Every zone here is one `GET /delivery/v1/zone` body, so each one can be copied
// into a page as it is. The pictures are the docs' own artwork (apps/docs/scripts/no-backend-assets.mjs), page-relative.
// live-zones.spec.ts checks every zone with the SDK's own validateZone.

const art = (name: string) => ({ kind: 'image', contentType: 'image/jpeg', url: `images/no-backend/art-${name}.jpg` }) as const;

const solid = (color: string) => ({ background: { type: 'color', color } });

const box = (y: number, h: number) => ({ x: 0.08, y, w: 0.84, h, rotation: 0 });

const text = (id: string, value: string, y: number, props: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  box: { x: 0.1, y, w: 0.8, h: 0.14, rotation: 0 },
  a11y: {},
  props: { text: value, size: 0.06, weight: 'bold', color: '#ffffff', align: 'center', ...props },
});

/** A tale whose canvas is a colour with one element on it: interactive, so it has no picture. */
const interactiveTale = (id: string, title: string, color: string, elements: unknown[]) => ({
  id,
  title,
  media: null,
  document: { canvas: solid(color), elements },
});

const pictureTale = (id: string, title: string, name: string) => ({ id, title, media: art(name) });

const group = (id: string, name: string, tales: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  name,
  tales,
  ...extra,
});

/** A stories bar: the default ring layout, large covers, with the zone's groups. */
const storiesBar = (slug: string, name: string, taleGroups: unknown[]) => ({
  id: slug,
  name,
  slug,
  frame: { type: 'bar', settings: { layout: 'ring', size: 'large', gap: 14 } },
  taleGroups,
});

const questionPoll = (id: string, question: string, options: string[], theme: 'light' | 'dark' = 'dark') => ({
  id,
  type: 'poll',
  box: box(0.3, 0.4),
  a11y: {},
  props: {
    question,
    options: options.map((label, i) => ({ id: `o${i + 1}`, label })),
    theme,
    view: 'embed',
  },
});

/** A poll: one question, two options, answered once per device. */
export const POLL_ZONE = storiesBar('docs-poll', 'Poll', [
  group('poll-try', 'Vote', [
    interactiveTale('poll-tale', 'Your vote', '#1d2a4a', [
      questionPoll('poll-el', 'Day or night?', ['Day', 'Night']),
    ]),
  ]),
  group('poll-more', 'Sea', [pictureTale('poll-sea', 'The sea', 'sea')]),
]);

/** A quiz: four answers, one correct; the viewer sees whether it was right and the percentages. */
export const QUIZ_ZONE = storiesBar('docs-quiz', 'Quiz', [
  group('quiz-try', 'Quiz', [
    interactiveTale('quiz-tale', 'Quick quiz', '#2b829f', [
      {
        id: 'quiz-el',
        type: 'quiz',
        box: box(0.22, 0.56),
        a11y: {},
        props: {
          question: 'Which planet is the hottest?',
          answers: [
            { id: 'a', label: 'Mercury' },
            { id: 'b', label: 'Venus' },
            { id: 'c', label: 'Mars' },
            { id: 'd', label: 'Jupiter' },
          ],
          correctAnswerId: 'b',
          theme: 'light',
        },
      },
    ]),
  ]),
  group('quiz-more', 'Meadow', [pictureTale('quiz-meadow', 'Meadow', 'meadow')]),
]);

/** A rating: a slider with an emoji as its thumb, from 0 to 100. */
export const RATING_ZONE = storiesBar('docs-rating', 'Rating', [
  group('rating-try', 'Rate it', [
    interactiveTale('rating-tale', 'Rate the spring', '#7a3e6b', [
      {
        id: 'rating-el',
        type: 'rating',
        box: box(0.3, 0.4),
        a11y: {},
        props: { question: 'How was the spring sale?', emoji: '⭐', theme: 'dark' },
      },
    ]),
  ]),
  group('rating-more', 'City', [pictureTale('rating-city', 'The city', 'city')]),
]);

/** A reaction: a row of emoji a viewer taps once; each shows its count. */
export const REACTION_ZONE = storiesBar('docs-reaction', 'Reaction', [
  group('reaction-try', 'React', [
    interactiveTale('reaction-tale', 'Your reaction', '#f3e9d2', [
      {
        id: 'reaction-el',
        type: 'reaction',
        box: box(0.3, 0.4),
        a11y: {},
        props: { question: 'How do you feel?', emojis: ['❤️', '😂', '😮'], theme: 'light' },
      },
    ]),
  ]),
  group('reaction-more', 'Hills', [pictureTale('reaction-hills', 'Hills at dawn', 'hills')]),
]);

/** Ends three days after the page loads, so the countdown always runs. */
export function countdownZone(now: Date = new Date()) {
  const endsAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  return storiesBar('docs-countdown', 'Countdown', [
    group('countdown-try', 'Sale', [
      interactiveTale('countdown-tale', 'Spring sale', '#8a2d2d', [
        {
          id: 'countdown-el',
          type: 'countdown',
          box: box(0.2, 0.6),
          a11y: {},
          props: { title: 'The spring sale ends in', endsAt, endedText: 'The sale is over', theme: 'dark' },
        },
      ]),
    ]),
    group('countdown-more', 'City', [pictureTale('countdown-city', 'The city', 'city')]),
  ]);
}

/** A promo code: a chip with a Copy button; the code is visible to everyone, so it is no secret. */
export const PROMO_ZONE = storiesBar('docs-promo', 'Promo code', [
  group('promo-try', 'Offer', [
    interactiveTale('promo-tale', 'Spring offer', '#2e5d3a', [
      text('promo-title', '10% off the sofas', 0.12),
      {
        id: 'promo-el',
        type: 'promo-code',
        box: box(0.36, 0.3),
        a11y: {},
        props: { code: 'SPRING26', note: 'Valid until the end of April', theme: 'dark' },
      },
    ]),
  ]),
  group('promo-more', 'Meadow', [pictureTale('promo-meadow', 'Meadow', 'meadow')]),
]);

/** The frequency cap: `frequency="once"` on the element hides a group after the viewer has seen it. */
export const FREQUENCY_ZONE = storiesBar('docs-frequency', 'Frequency', [
  group('freq-first', 'Welcome', [pictureTale('freq-hills', 'Hills at dawn', 'hills')]),
  group('freq-second', 'Sea', [pictureTale('freq-sea', 'The sea', 'sea')]),
  group('freq-third', 'City', [pictureTale('freq-city', 'The city', 'city')]),
]);

/** Audience rules: the group for pro viewers shows only when the page passes `plan: 'pro'`. */
export const AUDIENCE_ZONE = storiesBar('docs-audience', 'Audience', [
  group('aud-everyone', 'Everyone', [pictureTale('aud-hills', 'Hills at dawn', 'hills')]),
  group('aud-pro', 'Pro only', [pictureTale('aud-city', 'For pro viewers', 'city')], {
    audience: { match: 'all', conditions: [{ property: 'plan', operator: 'eq', value: 'pro' }] },
  }),
]);

/** Reading direction: a right-to-left page (`dir="rtl"`) turns the bar and its text. */
export const RTL_ZONE = storiesBar('docs-rtl', 'Hebrew', [
  group('rtl-try', 'שלום', [
    interactiveTale('rtl-tale', 'ברוכים הבאים', '#1d2a4a', [
      text('rtl-title', 'ברוכים הבאים לאביב', 0.2),
      questionPoll('rtl-el', 'מה אתם אוהבים יותר?', ['ים', 'הרים']),
    ]),
  ]),
  group('rtl-more', 'הרים', [pictureTale('rtl-hills', 'הרים בשחר', 'hills')]),
]);

/** Theme and locale: the group names, texts and colours here are the zone's; the element sets the rest. */
export const THEME_ZONE = storiesBar('docs-theme', 'Theme', [
  group('theme-one', 'Dawn', [pictureTale('theme-hills', 'Hills at dawn', 'hills')]),
  group('theme-two', 'Night', [pictureTale('theme-city', 'The city', 'city')]),
  group('theme-three', 'Sea', [pictureTale('theme-sea', 'The sea', 'sea')]),
]);

/** A promotion banner: three slides that promote the spring sale, a poll and a promo code. No autoplay. */
export const PROMO_BANNER_ZONE = {
  id: 'docs-promo-banner',
  name: 'Spring promotion',
  slug: 'docs-promo-banner',
  frame: { type: 'banner', settings: { variant: 'carousel', aspectRatio: '16:9', autoplay: false, showDots: true } },
  taleGroups: [
    group('pb-offer', 'Offer', [
      interactiveTale('pb-offer-tale', 'Spring offer', '#2e5d3a', [
        text('pb-offer-title', '10% off the sofas', 0.12),
        {
          id: 'pb-offer-el',
          type: 'promo-code',
          box: box(0.36, 0.3),
          a11y: {},
          props: { code: 'SPRING26', note: 'Valid until the end of April', theme: 'dark' },
        },
      ]),
    ]),
    group('pb-vote', 'Vote', [
      interactiveTale('pb-vote-tale', 'Your vote', '#1d2a4a', [questionPoll('pb-vote-el', 'Day or night?', ['Day', 'Night'])]),
    ]),
    group('pb-meadow', 'Meadow', [pictureTale('pb-meadow-tale', 'Meadow', 'meadow')]),
  ],
};

/** A sale banner with a countdown, the other element that promotes: the last slide, the time left. */
export function countdownBannerZone(now: Date = new Date()) {
  const endsAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: 'docs-countdown-banner',
    name: 'Sale countdown',
    slug: 'docs-countdown-banner',
    frame: { type: 'banner', settings: { variant: 'carousel', aspectRatio: '16:9', autoplay: false, showDots: true } },
    taleGroups: [
      group('cb-sale', 'Sale', [
        interactiveTale('cb-sale-tale', 'Spring sale', '#8a2d2d', [
          {
            id: 'cb-sale-el',
            type: 'countdown',
            box: box(0.2, 0.6),
            a11y: {},
            props: { title: 'The spring sale ends in', endsAt, endedText: 'The sale is over', theme: 'dark' },
          },
        ]),
      ]),
      group('cb-city', 'City', [pictureTale('cb-city-tale', 'The city', 'city')]),
    ],
  };
}

type Group = { id: string; name: string; tales: unknown[]; audience?: unknown; tags?: string[] };

/** The first group of a feature zone, renamed for the landing page's one bar. */
const featureGroup = (zone: { taleGroups: unknown[] }, name: string): Group => ({ ...(zone.taleGroups[0] as Group), name });

/**
 * The landing page's one stories bar: every feature is one group of it, so the page shows a single bar instead of a
 * row of them. The poll, quiz, rating, reaction, countdown, promo code, frequency cap, audience rule, Hebrew text and
 * theme are each one group; the audience group stays hidden for a viewer with no properties.
 */
export function landingZone(now: Date = new Date()) {
  return storiesBar('docs-features', 'Features', [
    featureGroup(POLL_ZONE, 'Poll'),
    featureGroup(QUIZ_ZONE, 'Quiz'),
    featureGroup(RATING_ZONE, 'Rating'),
    featureGroup(REACTION_ZONE, 'Reaction'),
    featureGroup(countdownZone(now), 'Countdown'),
    featureGroup(PROMO_ZONE, 'Promo code'),
    featureGroup(FREQUENCY_ZONE, 'Frequency'),
    AUDIENCE_ZONE.taleGroups[1],
    featureGroup(RTL_ZONE, 'עברית'),
    featureGroup(THEME_ZONE, 'Theme'),
  ]);
}

/** The landing page's one banner: the promotion slides and the countdown slide, one carousel. */
export function landingBannerZone(now: Date = new Date()) {
  return {
    id: 'docs-landing-banner',
    name: 'Spring promotion',
    slug: 'docs-landing-banner',
    frame: { type: 'banner', settings: { variant: 'carousel', aspectRatio: '16:9', autoplay: false, showDots: true } },
    taleGroups: [...PROMO_BANNER_ZONE.taleGroups, ...countdownBannerZone(now).taleGroups],
  };
}

/** Every live zone, by name, for the spec and for pages that list them. */
export const LIVE_ZONES = {
  POLL_ZONE,
  QUIZ_ZONE,
  RATING_ZONE,
  REACTION_ZONE,
  PROMO_ZONE,
  FREQUENCY_ZONE,
  AUDIENCE_ZONE,
  RTL_ZONE,
  THEME_ZONE,
  PROMO_BANNER_ZONE,
};

/** Pretty JSON, as a page shows it. */
export const liveJson = (value: unknown): string => JSON.stringify(value, null, 2);
