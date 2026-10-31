// The zone data of the "Use without a backend" page: the same objects are shown as JSON, fed to the live examples and
// checked against the SDK's validateZone by no-backend.spec.ts. The pictures are original artwork (apps/docs/scripts/
// no-backend-assets.mjs), page-relative like a host page's own images.

const art = (name: string) => ({ kind: 'image', contentType: 'image/jpeg', url: `images/no-backend/art-${name}.jpg` }) as const;

const text = (id: string, value: string, y: number) => ({
  id,
  type: 'text',
  box: { x: 0.1, y, w: 0.8, h: 0.14, rotation: 0 },
  a11y: {},
  props: { text: value, size: 0.06, weight: 'bold', color: '#ffffff', align: 'center' },
});

const solid = (color: string) => ({ background: { type: 'color', color } });

/** The smallest useful zone: one bar, one group, two tales (a picture, and a colour with a line of text). */
export const MINIMAL_ZONE = {
  frame: { type: 'bar', settings: { layout: 'ring', size: 'large' } },
  taleGroups: [
    {
      id: 'spring',
      name: 'Spring',
      tales: [
        { id: 'spring-1', title: 'Hills at dawn', media: art('hills') },
        {
          id: 'spring-2',
          title: 'A line of text',
          document: { canvas: solid('#2b829f'), elements: [text('hello', 'Hello from a page with no backend', 0.42)] },
        },
      ],
    },
  ],
};

/** The live bar: three groups, one with a poll that answers on the device. */
export const BAR_ZONE = {
  id: 'docs-bar',
  name: 'Docs bar',
  slug: 'docs-bar',
  frame: { type: 'bar', settings: { layout: 'ring', size: 'large', gap: 14 } },
  taleGroups: [
    {
      id: 'dawn',
      name: 'Dawn',
      tales: [
        { id: 'dawn-1', title: 'Hills at dawn', media: art('hills') },
        { id: 'dawn-2', title: 'Meadow', media: art('meadow') },
      ],
    },
    {
      id: 'night',
      name: 'Night',
      tales: [
        { id: 'night-1', title: 'The city', media: art('city') },
        {
          id: 'night-2',
          title: 'A vote',
          media: null,
          document: {
            canvas: solid('#1d2a4a'),
            elements: [
              {
                id: 'night-poll',
                type: 'poll',
                box: { x: 0.08, y: 0.3, w: 0.84, h: 0.34, rotation: 0 },
                a11y: {},
                props: {
                  question: 'Day or night?',
                  options: [
                    { id: 'day', label: 'Day' },
                    { id: 'night', label: 'Night' },
                  ],
                  theme: 'dark',
                  view: 'embed',
                },
              },
            ],
          },
        },
      ],
    },
    { id: 'sea', name: 'Sea', tales: [{ id: 'sea-1', title: 'The sea', media: art('sea') }] },
  ],
};

/** The live banner: the same pictures as slides. It does not rotate by itself, so a screenshot is steady. */
export const BANNER_ZONE = {
  id: 'docs-banner',
  name: 'Docs banner',
  slug: 'docs-banner',
  frame: { type: 'banner', settings: { variant: 'carousel', aspectRatio: '16:9', autoplay: false, showDots: true } },
  taleGroups: [
    { id: 'b-hills', name: 'Hills at dawn', tales: [{ id: 'b-hills-1', title: 'Hills at dawn', media: art('hills') }] },
    { id: 'b-sea', name: 'The sea', tales: [{ id: 'b-sea-1', title: 'The sea', media: art('sea') }] },
    { id: 'b-meadow', name: 'Meadow', tales: [{ id: 'b-meadow-1', title: 'Meadow', media: art('meadow') }] },
  ],
};

/** Pretty JSON, as the page shows it and the editor starts with. */
export const json = (value: unknown): string => JSON.stringify(value, null, 2);
