import { displayOptionSetting, ignoredSettings, selectedOption } from './display-options';

describe('display options (end-user redesign P4, P5)', () => {
  it('names the bar layouts and the banner variants, each with the current look as default', () => {
    expect(displayOptionSetting('bar')?.options.map((o) => o.value)).toEqual(['ring', 'chip', 'poster', 'stack']);
    expect(displayOptionSetting('bar')?.defaultValue).toBe('ring');
    expect(displayOptionSetting('banner')?.options.map((o) => o.value)).toEqual([
      'carousel',
      'coverflow',
      'peek',
      'deck',
      'sticky',
      'strip',
    ]);
    expect(displayOptionSetting('banner')?.defaultValue).toBe('carousel');
    expect(displayOptionSetting('feed')).toBeNull();
  });

  it('chooses the stored option, or the default for a missing or unknown one', () => {
    const bar = displayOptionSetting('bar');
    if (!bar) throw new Error('no bar setting');
    expect(selectedOption(bar, { layout: 'poster' }).value).toBe('poster');
    expect(selectedOption(bar, {}).value).toBe('ring');
    expect(selectedOption(bar, { layout: 'tile' }).value).toBe('ring');
  });

  it('says which settings each option does not use, with the option name', () => {
    expect([...ignoredSettings('bar', { layout: 'ring' }).entries()]).toEqual([]);
    expect([...ignoredSettings('bar', { layout: 'chip' }).entries()]).toEqual([
      ['shape', 'Not used by the Chip layout.'],
    ]);
    expect([...ignoredSettings('bar', { layout: 'poster' }).keys()]).toEqual(['shape', 'size']);
    expect([...ignoredSettings('bar', { layout: 'stack' }).keys()]).toEqual([
      'shape',
      'showTitles',
      'alignment',
      'gap',
    ]);
    expect(ignoredSettings('banner', { variant: 'carousel' }).size).toBe(0);
    expect([...ignoredSettings('banner', { variant: 'sticky' }).entries()]).toEqual([
      ['aspectRatio', 'Not used by the Sticky variant.'],
      ['showDots', 'Not used by the Sticky variant.'],
      ['loop', 'Not used by the Sticky variant.'],
    ]);
    expect(ignoredSettings('banner', { variant: 'strip' }).has('loop')).toBe(true);
    expect(ignoredSettings('banner', { variant: 'strip' }).has('autoplay')).toBe(true);
  });
});
