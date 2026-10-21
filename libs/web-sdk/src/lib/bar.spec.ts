import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeliveryTaleGroup } from '@taleart/contract';
import {
  BAR_CHOICES,
  BAR_DEFAULTS,
  BAR_GAP_RANGE,
  BAR_SIZE_PX,
  BAR_STYLES,
  readBarSettings,
  renderBar,
} from './bar';

const groups: DeliveryTaleGroup[] = [
  { id: 'ga', name: 'Summer', tales: [] },
  { id: 'gb', name: 'Winter', tales: [] },
];

function bar(settings?: unknown): HTMLElement {
  return renderBar(groups, new Set(), settings);
}

describe('bar settings', () => {
  it('match the contract schema: values, range and defaults', () => {
    const schema = JSON.parse(
      readFileSync(join(__dirname, '../../../contract/frame-types/bar.schema.json'), 'utf8'),
    ) as { properties: Record<string, { enum?: string[]; default: unknown; minimum?: number; maximum?: number }> };
    const { properties } = schema;
    expect(BAR_DEFAULTS).toEqual(Object.fromEntries(Object.entries(properties).map(([k, p]) => [k, p.default])));
    expect(BAR_CHOICES.shape).toEqual(properties['shape'].enum);
    expect(BAR_CHOICES.size).toEqual(properties['size'].enum);
    expect(BAR_CHOICES.alignment).toEqual(properties['alignment'].enum);
    expect(BAR_GAP_RANGE).toEqual({ min: properties['gap'].minimum, max: properties['gap'].maximum });
  });

  it('keeps every valid value', () => {
    const settings = { shape: 'rounded-square', size: 'small', showTitles: false, alignment: 'center', gap: 4 };
    expect(readBarSettings(settings)).toEqual(settings);
    expect(readBarSettings({ gap: 24 }).gap).toBe(24);
  });

  it.each([undefined, null, 'bar', [], {}])('reads %j as the defaults', (raw) => {
    expect(readBarSettings(raw)).toEqual(BAR_DEFAULTS);
  });

  it('replaces each invalid value with its default', () => {
    expect(
      readBarSettings({ shape: 'star', size: 9, showTitles: 'no', alignment: 'end', gap: 'x' }),
    ).toEqual(BAR_DEFAULTS);
    for (const gap of [3, 25, 12.5, Number.NaN]) expect(readBarSettings({ gap }).gap).toBe(12);
  });
});

describe('renderBar', () => {
  it('renders the default bar: circle, 64 px, titles shown, start, 12 px gap', () => {
    const list = bar();
    expect(list.dataset).toMatchObject({ shape: 'circle', align: 'start', titles: 'shown' });
    expect(list.style.getPropertyValue('--ta-size')).toBe('64px');
    expect(list.style.gap).toBe('12px');
  });

  it('applies each setting', () => {
    const list = bar({ shape: 'rounded-square', size: 'large', showTitles: false, alignment: 'center', gap: 20 });
    expect(list.dataset).toMatchObject({ shape: 'rounded-square', align: 'center', titles: 'hidden' });
    expect(list.style.getPropertyValue('--ta-size')).toBe('80px');
    expect(list.style.gap).toBe('20px');
  });

  it.each(Object.entries(BAR_SIZE_PX))('sizes %s covers at %i px', (size, px) => {
    expect(bar({ size }).style.getPropertyValue('--ta-size')).toBe(`${px}px`);
  });

  it('keeps the accessible names and the title text when titles are hidden', () => {
    const list = bar({ showTitles: false });
    const buttons = [...list.querySelectorAll('button.item')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Summer', 'Winter']);
    expect(buttons.map((b) => b.querySelector('.title')?.textContent)).toEqual(['Summer', 'Winter']);
  });

  it('has the style rules each setting relies on', () => {
    expect(BAR_STYLES).toContain('.bar[data-titles="hidden"] .title { display: none; }');
    expect(BAR_STYLES).toContain('.bar[data-shape="rounded-square"] .ring');
    // Auto margins centre the row without clipping the first item when it overflows.
    expect(BAR_STYLES).toContain('.bar[data-align="center"] > li:first-child { margin-inline-start: auto; }');
    expect(BAR_STYLES).toContain('.bar[data-align="center"] > li:last-child { margin-inline-end: auto; }');
  });
});
