import { contrastRatio, DEFAULT_THEME, TEXT_CONTRAST_MIN } from '@taleart/contract/theme';
import { TEXT_BACKGROUNDS, textContrastWarning } from './theme-text-contrast';

describe('textContrastWarning', () => {
  it('is silent for a colour that reads on one background, even when it fails the other', () => {
    // Dark green reads on white; light green reads on the dark background.
    expect(textContrastWarning('#047857')).toEqual([]);
    expect(textContrastWarning('#7fd4a8')).toEqual([]);
    expect(textContrastWarning(DEFAULT_THEME.successColor)).toEqual([]);
    expect(textContrastWarning(DEFAULT_THEME.errorColor)).toEqual([]);
    // Light grey fails on white only, dark grey on the dark background only.
    expect(contrastRatio('#cccccc', '#ffffff')).toBeLessThan(TEXT_CONTRAST_MIN);
    expect(textContrastWarning('#cccccc')).toEqual([]);
    expect(textContrastWarning('#333333')).toEqual([]);
  });

  it('warns, naming both backgrounds, for a colour below 4.5:1 on both', () => {
    // Mid grey: 4.48:1 on white and 4.17:1 on the dark background.
    const warning = textContrastWarning('#777777');
    expect(warning.map((f) => f.background)).toEqual(['white', TEXT_BACKGROUNDS[1].name]);
    for (const failure of warning) {
      expect(failure.minimum).toBe(TEXT_CONTRAST_MIN);
      expect(failure.ratio).toBeLessThan(TEXT_CONTRAST_MIN);
    }
  });

  it('says nothing about a value that is not a colour yet', () => {
    expect(textContrastWarning('#77')).toEqual([]);
    expect(textContrastWarning('red')).toEqual([]);
    expect(textContrastWarning(null)).toEqual([]);
    expect(textContrastWarning(undefined)).toEqual([]);
  });
});
