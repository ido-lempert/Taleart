// The shipped schema the API serves from GET /frame-types (story 6's banner fields): a data file
// of the contract, read as is in this test only.
// eslint-disable-next-line @nx/enforce-module-boundaries
import bannerSchema from '../../../../libs/contract/frame-types/banner.schema.json';
import { describeSettings, humanize, initialSettings, settingsFields } from './settings-form';

describe('settings form schema reading', () => {
  const schema = {
    type: 'object',
    properties: {
      shape: { type: 'string', enum: ['circle', 'rounded-square'], default: 'circle' },
      showTitles: { type: 'boolean', default: true },
      gap: { title: 'Gap', description: 'In px.', type: 'integer', minimum: 4, maximum: 24, default: 12 },
      ratio: { type: 'number' },
      colors: { type: 'array', items: { type: 'string' }, default: ['#fff'] },
    },
  };

  it('humanizes keys and values for labels', () => {
    expect(humanize('rounded-square')).toBe('Rounded square');
    expect(humanize('showTitles')).toBe('Show titles');
    expect(humanize('center')).toBe('Center');
  });

  it('turns enums into choices, booleans into toggles and numbers into ranged inputs, skipping the rest', () => {
    expect(settingsFields(schema)).toEqual([
      {
        key: 'shape',
        label: 'Shape',
        hint: '',
        default: 'circle',
        kind: 'choice',
        choices: [
          { value: 'circle', label: 'Circle' },
          { value: 'rounded-square', label: 'Rounded square' },
        ],
      },
      { key: 'showTitles', label: 'Show titles', hint: '', default: true, kind: 'toggle' },
      { key: 'gap', label: 'Gap', hint: 'In px.', default: 12, kind: 'number', min: 4, max: 24, step: 1 },
      { key: 'ratio', label: 'Ratio', hint: '', default: undefined, kind: 'number', min: undefined, max: undefined, step: 0.1 },
    ]);
  });

  it('reads a schema without properties as no fields', () => {
    expect(settingsFields({ type: 'object' })).toEqual([]);
    expect(settingsFields(undefined)).toEqual([]);
  });

  it('fills unset editable fields with defaults and keeps stored values, other fields included', () => {
    expect(initialSettings(schema, { gap: 20, colors: ['#000'] })).toEqual({
      shape: 'circle',
      showTitles: true,
      gap: 20,
      colors: ['#000'],
    });
    expect(initialSettings(schema, null)).toEqual({ shape: 'circle', showTitles: true, gap: 12 });
  });

  it('reads stored values outside a field choices, range or type as missing', () => {
    expect(initialSettings(schema, { shape: 'star', showTitles: 'yes', gap: 40 })).toEqual({
      shape: 'circle',
      showTitles: true,
      gap: 12,
    });
    expect(initialSettings(schema, { gap: 3 })['gap']).toBe(12);
    expect(initialSettings(schema, { gap: 12.5 })['gap']).toBe(12);
    expect(initialSettings(schema, { gap: '20' })['gap']).toBe(12);
    // A field without a default is left out instead.
    expect(initialSettings(schema, { ratio: 'wide' })).not.toHaveProperty('ratio');
    expect(initialSettings(schema, { ratio: 1.5 })['ratio']).toBe(1.5);
  });

  it('builds the banner form from the shipped banner schema, with no banner-specific code', () => {
    expect(settingsFields(bannerSchema)).toEqual([
      {
        key: 'variant',
        label: 'Variant',
        hint: expect.any(String),
        default: 'carousel',
        kind: 'choice',
        choices: [
          { value: 'carousel', label: 'Carousel' },
          { value: 'coverflow', label: 'Coverflow' },
          { value: 'peek', label: 'Peek' },
          { value: 'deck', label: 'Deck' },
          { value: 'sticky', label: 'Sticky' },
          { value: 'strip', label: 'Strip' },
        ],
      },
      {
        key: 'aspectRatio',
        label: 'Aspect ratio',
        hint: expect.any(String),
        default: '16:9',
        kind: 'choice',
        choices: [
          { value: '16:9', label: '16:9' },
          { value: '3:1', label: '3:1' },
          { value: '1:1', label: '1:1' },
        ],
      },
      { key: 'autoplay', label: 'Autoplay', hint: expect.any(String), default: true, kind: 'toggle' },
      { key: 'intervalSeconds', label: 'Interval', hint: expect.any(String), default: 5, kind: 'number', min: 3, max: 15, step: 1 },
      { key: 'showDots', label: 'Show dots', hint: expect.any(String), default: true, kind: 'toggle' },
      { key: 'loop', label: 'Loop', hint: expect.any(String), default: true, kind: 'toggle' },
    ]);
    expect(initialSettings(bannerSchema, {})).toEqual({
      variant: 'carousel',
      aspectRatio: '16:9',
      autoplay: true,
      intervalSeconds: 5,
      showDots: true,
      loop: true,
    });
    expect(initialSettings(bannerSchema, { intervalSeconds: 40, aspectRatio: '4:3' })).toMatchObject({
      aspectRatio: '16:9',
      intervalSeconds: 5,
    });
  });

  it('describes settings read-only, labelled by the schema, in schema order', () => {
    expect(
      describeSettings(bannerSchema, { loop: true, aspectRatio: '3:1', autoplay: false, intervalSeconds: 5, extra: 'x-y' }),
    ).toEqual([
      { label: 'Aspect ratio', value: '3:1' },
      { label: 'Autoplay', value: 'Off' },
      { label: 'Interval', value: '5' },
      { label: 'Loop', value: 'On' },
      { label: 'Extra', value: 'X y' },
    ]);
    expect(describeSettings(undefined, { showTitles: true, shape: 'rounded-square' })).toEqual([
      { label: 'Show titles', value: 'On' },
      { label: 'Shape', value: 'Rounded square' },
    ]);
  });
});
