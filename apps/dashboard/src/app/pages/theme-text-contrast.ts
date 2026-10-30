import { contrastRatio, isThemeColor, TEXT_CONTRAST_MIN } from '@taleart/contract/theme';

/**
 * The backgrounds a text colour of the theme is read on: white (the light colour scheme) and the
 * dashboard's dark background (the dark colour scheme).
 */
export const TEXT_BACKGROUNDS: readonly { name: string; color: string }[] = [
  { name: 'white', color: '#ffffff' },
  { name: 'the dark background (#12111f)', color: '#12111f' },
];

/** A background a text colour falls short of: its name, the ratio reached, and the ratio needed. */
export interface TextContrastFailure {
  background: string;
  ratio: number;
  minimum: number;
}

/**
 * The warning for a text colour such as the quiz's correct or wrong answer colour: the backgrounds it
 * is below 4.5:1 on, but only when it is below 4.5:1 on every one of them (so it is unreadable in both
 * colour schemes). No single colour reaches 4.5:1 on both white and the dark background (the best is
 * about 4.3:1), so a colour that passes on one of them is not warned about. Empty when it passes on at
 * least one background, and when `color` is not a `#rrggbb` colour yet (still being typed).
 */
export function textContrastWarning(color: unknown): TextContrastFailure[] {
  if (!isThemeColor(color)) return [];
  const failures = TEXT_BACKGROUNDS.map(({ name, color: background }) => ({
    background: name,
    ratio: contrastRatio(color, background),
    minimum: TEXT_CONTRAST_MIN,
  }));
  return failures.every((failure) => failure.ratio < TEXT_CONTRAST_MIN) ? failures : [];
}
