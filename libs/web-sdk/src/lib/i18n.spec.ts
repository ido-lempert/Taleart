import { createTranslate, DEFAULT_STRINGS, defaultTranslate } from './i18n';

describe('createTranslate', () => {
  it('looks up the full locale first', () => {
    const t = createTranslate('he-IL', { 'he-IL': { 'viewer.close': 'סגור (he-IL)' }, he: { 'viewer.close': 'סגור (he)' } });
    expect(t('viewer.close')).toBe('סגור (he-IL)');
  });

  it('then the language of the locale', () => {
    const t = createTranslate('he-IL', { he: { 'viewer.close': 'סגור (he)' } });
    expect(t('viewer.close')).toBe('סגור (he)');
  });

  it('then flat overrides, which apply to every locale', () => {
    const t = createTranslate('he-IL', { 'viewer.close': 'Flat close' });
    expect(t('viewer.close')).toBe('Flat close');
  });

  it('then English for a string the locale does not override', () => {
    const t = createTranslate('he-IL', { he: { 'viewer.close': 'סגור' } });
    expect(t('viewer.play')).toBe('Play');
    expect(createTranslate('fr', { he: { 'viewer.close': 'סגור' } })('viewer.close')).toBe('Close');
  });

  it('uses English for an empty locale and when nothing is configured', () => {
    expect(createTranslate('', undefined)('viewer.close')).toBe('Close');
    expect(defaultTranslate('viewer.previousTale')).toBe('Previous tale');
  });

  it('fills the {name} placeholders it is given and keeps the ones it is not', () => {
    const t = createTranslate('en', undefined);
    expect(t('bar.seen', { name: 'Summer' })).toBe('Summer, seen');
    expect(t('banner.slideOf', { index: 2, count: 3 })).toBe('2 of 3');
    expect(t('bar.seen')).toBe('{name}, seen');
    expect(t('bar.seen', { other: 'x' })).toBe('{name}, seen');
    expect(t('banner.slideOf', { index: 2 })).toBe('2 of {count}');
  });

  it('keeps every default string English and free of an empty value', () => {
    for (const [key, value] of Object.entries(DEFAULT_STRINGS)) {
      expect(value, key).toEqual(expect.any(String));
      expect(value.trim() === '' && value !== ' (opens in a new tab)' && value !== ' correct answer' && value !== ' wrong', key).toBe(false);
    }
  });
});
